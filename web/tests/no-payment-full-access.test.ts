import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const source = (p:string) => readFileSync(path.join(process.cwd(),p),'utf8');
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(),'campus-self-service-')),'test.sqlite3');
delete process.env.DATABASE_URL;
process.env.ACCESS_CYCLE='Fall 2027';
process.env.DEMO_OWNER_EMAIL='admin@example.com';
let A:typeof import('../lib/db/accounts');
let S:typeof import('../lib/db/self-service-access');
let C:typeof import('../lib/db/client');
let P:typeof import('../lib/auth/product-access');
let V:typeof import('../lib/db/college-coverage');
let R:typeof import('../lib/db/requests');
let F:typeof import('../lib/db/feedback');

before(async()=>{
  A=await import('../lib/db/accounts');S=await import('../lib/db/self-service-access');C=await import('../lib/db/client');
  P=await import('../lib/auth/product-access');V=await import('../lib/db/college-coverage');R=await import('../lib/db/requests');F=await import('../lib/db/feedback');
});

describe('no-payment full-access release',()=>{
  it('renders no commercial price, old CTA, or historical pricing component on marketing routes',()=>{
    const paths=['web/components/CampusPassageLanding.tsx','web/components/SamplePlan.tsx','web/components/HeaderNav.tsx','web/components/MarketingHeader.tsx','web/components/MarketingFooter.tsx','web/app/layout.tsx','web/app/request-access/page.tsx','web/app/request-access/layout.tsx','web/app/login/page.tsx'];
    const publicSource=paths.map(p=>source(p.slice(4))).join('\n');
    assert.doesNotMatch(publicSource,/\$\d|founding.family|Request [Aa]ccess|#pricing|id="pricing"|<ArchivedPricing|from ['"]@\/components\/ArchivedPricing/i);
    assert.match(source('components/CampusPassageLanding.tsx'),/Your College Journey Tracker/);
    for(const page of ['components/CampusPassageLanding.tsx','components/SamplePlan.tsx','components/HeaderNav.tsx','components/MarketingFooter.tsx']){
      const text=source(page);assert.match(text,/href="\/login\?next=%2Fonboarding"[^>]*>Start Now/);
    }
    assert.match(source('app/request-access/page.tsx'),/redirect\('\/login\?next=%2Fonboarding'\)/);
    assert.match(source('components/ArchivedPricing.tsx'),/Standard price <s>\$199<\/s>/);
  });

  it('only grants an empty verified-user household after onboarding, without an order or invite',async()=>{
    const ctx=await A.provisionAccount({authUserId:'self-a',email:'first@example.com'});
    const identity={id:'self-a',email:'first@example.com'};
    assert.equal(await S.canSelfServiceOnboard(ctx),true);
    assert.equal(await P.hasProductAccess(identity,ctx.household.id),false);
    await assert.rejects(()=>S.completeSelfServiceOnboarding(ctx,{role:'parent',students:[{name:'Wrong',enteringTerm:'Fall 2028'}],purchaserAttested:true}),/cycle/);
    assert.equal(await P.hasProductAccess(identity,ctx.household.id),false);
    await S.completeSelfServiceOnboarding(ctx,{role:'parent',students:[{name:'First',enteringTerm:'Fall 2027'},{name:'Second',enteringTerm:'Fall 2027'}],purchaserAttested:true});
    assert.equal(await P.hasProductAccess(identity,ctx.household.id),true);
    assert.equal(await P.hasProductAccess({id:'other',email:'other@example.com'},ctx.household.id),false);
    assert.equal(Number((await C.queryOne<any>('SELECT COUNT(*) AS n FROM students WHERE household_id=$1',[ctx.household.id]))?.n),2);
    assert.equal(await S.canSelfServiceOnboard(ctx),false);
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM cycle_orders WHERE household_id=$1',[ctx.household.id]),null);
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM beta_access_invites WHERE accepted_household_id=$1',[ctx.household.id]),null);
    assert.equal(await S.assertSelfServiceAccessCycle(ctx.household.id,'Fall 2027'),true);
    await assert.rejects(()=>S.assertSelfServiceAccessCycle(ctx.household.id,'Fall 2028'),/original admissions cycle/);
    const second=await A.provisionAccount({authUserId:'self-b',email:'second@example.com'});
    assert.equal(await P.hasProductAccess(identity,second.household.id),false);
    assert.equal(await P.hasProductAccess({id:'self-b',email:'second@example.com'},ctx.household.id),false);
    await C.exec('UPDATE self_service_access SET revoked_at=$1 WHERE household_id=$2',[new Date().toISOString(),ctx.household.id]);
    assert.equal(await P.hasProductAccess(identity,ctx.household.id),false);
    await assert.rejects(()=>S.completeSelfServiceOnboarding(ctx,{role:'parent',students:[{name:'Repeat',enteringTerm:'Fall 2027'}],purchaserAttested:true}),/not eligible/);
  });

  it('enforces exactly ten household-cycle colleges and three new research requests per calendar month',async()=>{
    const ctx=await A.provisionAccount({authUserId:'coverage-user',email:'coverage@example.com'});
    await S.completeSelfServiceOnboarding(ctx,{role:'parent',students:[{name:'S',enteringTerm:'Fall 2027'}],purchaserAttested:true});
    const ids=Array.from({length:11},(_,i)=>String(780000+i));
    for(const id of ids) await R.upsertDirectorySchool({unitid:id,name:`School ${id}`});
    for(const id of ids.slice(0,10)) {
      const res=await V.reserveCollegeCoverage({householdId:ctx.household.id,cycle:'Fall 2027',collegeId:id},true);
      assert.equal(res.status,'covered');
    }
    const duplicate=await V.reserveCollegeCoverage({householdId:ctx.household.id,cycle:'Fall 2027',collegeId:ids[0]},true);
    assert.equal(duplicate.status,'covered'); if(duplicate.status==='covered')assert.equal(duplicate.consumedUnit,false);
    const blocked=await V.reserveCollegeCoverage({householdId:ctx.household.id,cycle:'Fall 2027',collegeId:ids[10]},true);
    assert.deepEqual(blocked,{status:'blocked',reason:'capacity_exhausted'});
    const summary=await V.getCollegeCoverageSummary(ctx.household.id,'Fall 2027');
    assert.equal(summary.coveredUnits,10);assert.equal(summary.remainingUnits,0);
    for(const id of ids.slice(0,3))assert.equal((await R.createSchoolRequest({householdId:ctx.household.id,unitid:id,term:'Fall 2027'})).created,true);
    await assert.rejects(()=>R.createSchoolRequest({householdId:ctx.household.id,unitid:ids[3],term:'Fall 2027'}),/up to three new schools/);
    assert.equal((await R.createSchoolRequest({householdId:ctx.household.id,unitid:ids[0],term:'Fall 2027'})).created,false);
    assert.equal((await V.getCollegeCoverageSummary(ctx.household.id,'Fall 2027')).coveredUnits,10);
  });

  it('stores exact feedback and independent opt-ins, rejects invalid content and isolates household attribution',async()=>{
    const ctx=await A.provisionAccount({authUserId:'feedback-user',email:'feedback@example.com'});
    await S.completeSelfServiceOnboarding(ctx,{role:'parent',students:[{name:'Student',enteringTerm:'Fall 2027'}],purchaserAttested:true});
    for(const rating of [0,6,1.5,'',null])assert.equal(F.feedbackSchema.safeParse({rating,feedbackText:'Valid',followUpConsent:false,testimonialConsent:false}).success,false);
    assert.equal(F.feedbackSchema.safeParse({rating:4,feedbackText:'   ',followUpConsent:false,testimonialConsent:false}).success,false);
    assert.equal(F.feedbackSchema.safeParse({rating:4,feedbackText:'x'.repeat(4001),followUpConsent:false,testimonialConsent:false}).success,false);
    const text='  Useful plan\nwith details  ';
    const id=await F.submitFeedback(ctx,{rating:5,feedbackText:text,followUpConsent:false,testimonialConsent:true});
    const stored=await C.queryOne<any>('SELECT * FROM household_feedback WHERE id=$1',[id]);
    assert.equal(stored.household_id,ctx.household.id);assert.equal(stored.auth_user_id,ctx.authUserId);
    assert.equal(stored.feedback_text,text);assert.equal(Number(stored.rating),5);
    assert.equal(Number(stored.follow_up_consent),0);assert.equal(Number(stored.testimonial_consent),1);
    assert.ok(stored.created_at);
    const other=await A.provisionAccount({authUserId:'feedback-other',email:'other-feedback@example.com'});
    await assert.rejects(()=>F.submitFeedback({...ctx,authUserId:other.authUserId},{rating:1,feedbackText:'spoof',followUpConsent:false,testimonialConsent:false}),/membership/);
    assert.match(source('app/feedback/actions.ts'),/formData.get\('followUpConsent'\) === 'yes'/);
    assert.match(source('app/feedback/actions.ts'),/formData.get\('testimonialConsent'\) === 'yes'/);
    const admin=source('app/admin/feedback/page.tsx');
    assert.match(admin,/requireDemoOwner\(\)/);assert.match(admin,/listFeedbackForAdmin\(admin, 30\)/);
    await assert.rejects(()=>F.listFeedbackForAdmin({id:'feedback-user',email:'feedback@example.com'}),/administrator authorization/);
    await assert.rejects(()=>F.listFeedbackForAdmin({id:'missing-owner',email:'admin@example.com'}),/administrator authorization/);
    const adminCtx=await A.provisionAccount({authUserId:'admin-auth',email:'admin@example.com'});
    assert.equal((await F.listFeedbackForAdmin({id:adminCtx.authUserId,email:'admin@example.com'})).some(r=>r.id===id),true);
    assert.doesNotMatch(admin,/<form|publishFeedback|mailto:/i);
    assert.match(source('app/dashboard/page.tsx'),/href="\/feedback"/);
  });

  it('hard-disables payment endpoints and retains same-browser PKCE confirmation guidance',()=>{
    for(const p of ['app/api/stripe/webhook/route.ts','app/api/stripe/addon-webhook/route.ts'])assert.match(source(p),/status:503/);
    assert.doesNotMatch(source('app/request/page.tsx'),/Stripe|addon|checkout|payment/i);
    assert.match(source('app/account/access-actions.ts'),/Checkout disabled/);
    assert.match(source('lib/auth/session.ts'),/auth\.getUser\(\)/);
    assert.match(source('lib/auth/session.ts'),/auth\.email_confirmed_at/);
    assert.match(source('app/auth/callback/route.ts'),/exchangeCodeForSession\(code\)/);
    assert.match(source('app/auth/callback/route.ts'),/isNoCodeSignupReturn\(searchParams\)/);
    assert.match(source('lib/auth/callback.ts'),/safeNext\(next\)/);
    assert.match(source('app/login/page.tsx'),/This link did not sign you in/);
  });
});
