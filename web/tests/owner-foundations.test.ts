import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
const dir=mkdtempSync(path.join(tmpdir(),'owner-foundations-'));
process.env.DB_PATH=path.join(dir,'db.sqlite3'); delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL='owner@example.com'; process.env.ACCESS_CYCLE='Fall 2027';
process.env.MAIL_TOKEN_ENCRYPTION_KEY='ab'.repeat(32);
let A:typeof import('../lib/db/accounts'), C:typeof import('../lib/db/client'), X:typeof import('../lib/db/cycle-access'), S:typeof import('../lib/db/stripe-review'), M:typeof import('../lib/db/connected-mail'), Q:typeof import('../lib/db/ask-campus');
let admin:any, family:any;
const actor={id:'admin-auth',email:'owner@example.com'};
describe('owner review foundations',()=>{
 before(async()=>{
  A=await import('../lib/db/accounts');C=await import('../lib/db/client');X=await import('../lib/db/cycle-access');S=await import('../lib/db/stripe-review');M=await import('../lib/db/connected-mail');Q=await import('../lib/db/ask-campus');
  admin=await A.provisionAccount({authUserId:actor.id,email:actor.email});
  family=await A.provisionAccount({authUserId:'family-auth',email:'family@example.com'});
  await A.completeOnboarding(family,{studentName:'Student',role:'parent',enteringTerm:'Fall 2027'});
 });
 it('requires owner; $0 consideration, idempotency and revocation ledger are immutable',async()=>{
  await assert.rejects(X.grantComplimentary({householdId:family.household.id,actor:{id:'impostor',email:'owner@example.com'},reason:'Pilot review',idempotencyKey:'first'}));
  const wrong=await A.provisionAccount({authUserId:'wrong-term',email:'wrong-term@example.com'});
  await A.completeOnboarding(wrong,{studentName:'Student',role:'parent',enteringTerm:'Fall 2028'});
  await assert.rejects(X.grantComplimentary({householdId:wrong.household.id,actor,reason:'Pilot review',idempotencyKey:'wrong'}),/cycle/);
  const id=await X.grantComplimentary({householdId:family.household.id,actor,reason:'Pilot review',idempotencyKey:'first'});
  assert.equal(await X.grantComplimentary({householdId:family.household.id,actor,reason:'Pilot review',idempotencyKey:'first'}),id);
  assert.deepEqual(await X.accountingTotals(id),{payments:0,refunds:0,providerFees:0,netCash:0,discounts:0,complimentary:0});
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM cycle_accounting_events WHERE order_id=$1',[id]))?.n,1);
  assert.equal(await X.revokeComplimentary({householdId:family.household.id,actor,reason:'Owner requested'}),true);
  assert.ok((await C.queryOne<any>('SELECT revoked_at FROM cycle_entitlements WHERE order_id=$1',[id]))?.revoked_at);
 });
 it('caps complimentary households at 25, including reserved invitations; claim is bound and single-use',async()=>{
  const households=[]; let firstToken='';
  for(let i=0;i<24;i++) {
   const ctx=await A.provisionAccount({authUserId:`family-${i}`,email:`family-${i}@example.com`});households.push(ctx);
   await A.completeOnboarding(ctx,{studentName:'Student',role:'parent',enteringTerm:'Fall 2027'});
   const issued=await X.issueComplimentaryInvite({householdId:ctx.household.id,actor,reason:'Founding review',kind:'founding_family'});
   if (i===0) firstToken=issued.token;
  }
  const last=await A.provisionAccount({authUserId:'family-last',email:'last@example.com'});
  await A.completeOnboarding(last,{studentName:'Student',role:'parent',enteringTerm:'Fall 2027'});
  await assert.rejects(X.issueComplimentaryInvite({householdId:last.household.id,actor,reason:'Founding review',kind:'founding_family'}),/cap/i);
  const invitation=await C.queryOne<any>('SELECT id FROM complimentary_invites WHERE household_id=$1',[households[0].household.id]);
  assert.ok(invitation?.id);
  await assert.rejects(X.claimComplimentaryInvite({token:firstToken,householdId:last.household.id,authUserId:'family-last'}));
  const claim=await X.claimComplimentaryInvite({token:firstToken,householdId:households[0].household.id,authUserId:'family-0'});
  assert.equal((await X.accountingTotals(claim)).complimentary,0);
  await assert.rejects(X.claimComplimentaryInvite({token:firstToken,householdId:households[0].household.id,authUserId:'family-0'}));
 });
 it('rejects disabled checkout and unsigned/stale webhook; signed payment is idempotent and refund revokes',async()=>{
  assert.equal(S.stripeReady(),false);
  await assert.rejects(S.createCheckout({householdId:family.household.id,authUserId:'family-auth',idempotencyKey:'eightchars'}));
  const secret='whsec_testsecret';const raw=JSON.stringify({id:'evt_1',type:'irrelevant',data:{object:{}},livemode:false});
  const t=Math.floor(Date.now()/1000),sig=`t=${t},v1=${createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')}`;
  assert.equal(S.verifyStripeEvent(raw,sig,secret).id,'evt_1');
  assert.throws(()=>S.verifyStripeEvent(raw,'t=1,v1=bad',secret));
  assert.throws(()=>S.verifyStripeEvent(raw,sig,secret,Date.now()+400_000));
  process.env.STRIPE_REVIEW_ENABLED='1';process.env.STRIPE_SECRET_KEY='sk_test';process.env.STRIPE_WEBHOOK_SECRET=secret;process.env.STRIPE_PRICE_ID='price_test';process.env.STRIPE_EXPECTED_AMOUNT_CENTS='12000';process.env.APP_ORIGIN='https://example.com';
  const paid=await A.provisionAccount({authUserId:'buyer',email:'buyer@example.com'});
  await A.completeOnboarding(paid,{studentName:'Student',role:'parent',enteringTerm:'Fall 2027'});
  const now=new Date().toISOString(),id='test_order';
  await C.exec("INSERT INTO cycle_orders(id,household_id,cycle,kind,price_id,amount_cents,status,idempotency_key,provider_session_id,created_at,updated_at) VALUES($1,$2,'Fall 2027','paid','price_test',12000,'pending','paid-test','cs_test',$3,$4)",[id,paid.household.id,now,now]);
  function signed(event:any){const body=JSON.stringify(event),stamp=Math.floor(Date.now()/1000);return [body,`t=${stamp},v1=${createHmac('sha256',secret).update(`${stamp}.${body}`).digest('hex')}`] as const;}
  const obj={id:'cs_test',metadata:{order_id:id,household_id:paid.household.id,cycle:'Fall 2027'},payment_status:'paid',currency:'usd',amount_total:12000,payment_intent:'pi_test'};
  let [body,signature]=signed({id:'evt_wrong',type:'checkout.session.completed',data:{object:{...obj,amount_total:999}},livemode:false});
  assert.equal(await S.reconcileStripeWebhook(body,signature),'exception');
  assert.equal((await C.queryOne<any>('SELECT status FROM cycle_orders WHERE id=$1',[id])).status,'pending');
  [body,signature]=signed({id:'evt_paid',type:'checkout.session.completed',data:{object:obj},livemode:false});
  assert.equal(await S.reconcileStripeWebhook(body,signature),'payment_verified');
  assert.equal(await S.reconcileStripeWebhook(body,signature),'duplicate');
  assert.equal((await X.accountingTotals(id)).payments,12000);
  [body,signature]=signed({id:'evt_refund',type:'charge.refunded',data:{object:{payment_intent:'pi_test',currency:'usd',amount_refunded:12000}},livemode:false});
  assert.equal(await S.reconcileStripeWebhook(body,signature),'refund_reconciled');
  assert.equal((await C.queryOne<any>('SELECT revoked_at FROM cycle_entitlements WHERE order_id=$1',[id])).revoked_at!==null,true);
 });
 it('mail consent is owner-scoped, tokens sealed; nonallowlisted messages discarded; revoke and delete purge',async()=>{
  await assert.rejects(M.storeConnectedMail({householdId:family.household.id,actorId:'stranger',provider:'gmail',accountId:'abc',tokens:{accessToken:'token',refreshToken:'refresh'},consentVersion:'connected-mail-2026-09-v1'}));
  const id=await M.storeConnectedMail({householdId:family.household.id,actorId:'family-auth',provider:'gmail',accountId:'abc',tokens:{accessToken:'token',refreshToken:'refresh'},consentVersion:'connected-mail-2026-09-v1'});
  assert.doesNotMatch((await C.queryOne<any>('SELECT encrypted_tokens FROM mail_connections WHERE id=$1',[id])).encrypted_tokens,/token|refresh/);
  assert.deepEqual(await M.syncConnectedMail({householdId:family.household.id,actorId:'family-auth',connectionId:id,adapter:{provider:'gmail',async listMinimalMetadata(){throw new Error('No provider calls expected without allowlist')}}}),{accepted:0,quarantined:0});
  await M.revokeConnectedMail({householdId:family.household.id,actorId:'family-auth',connectionId:id});
  assert.equal((await C.queryOne<any>('SELECT encrypted_tokens FROM mail_connections WHERE id=$1',[id])).encrypted_tokens,'revoked');
  await assert.rejects(M.reconsentConnectedMail({householdId:family.household.id,actorId:'family-auth',connectionId:id,accountId:'wrong',tokens:{accessToken:'new',refreshToken:'new'},consentVersion:'connected-mail-2026-09-v1'}));
  await M.reconsentConnectedMail({householdId:family.household.id,actorId:'family-auth',connectionId:id,accountId:'abc',tokens:{accessToken:'new',refreshToken:'new'},consentVersion:'connected-mail-2026-09-v1'});
  assert.equal((await C.queryOne<any>('SELECT status FROM mail_connections WHERE id=$1',[id])).status,'active');
  await M.deleteConnectedMail({householdId:family.household.id,actorId:'family-auth'});
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM mail_connections WHERE household_id=$1',[family.household.id])).n,0);
 });
 it('assistant refuses unknown, sensitive, and cross-household context without storing prompts',async()=>{
  const student=await C.queryOne<any>('SELECT id FROM students WHERE household_id=$1',[family.household.id]);
  assert.equal((await Q.askCampus({householdId:family.household.id,actorId:'family-auth',studentId:student.id,question:'When is housing due?'})).kind,'unknown');
  assert.equal((await Q.askCampus({householdId:family.household.id,actorId:'family-auth',studentId:student.id,question:'password abc'})).kind,'unknown');
  await assert.rejects(Q.askCampus({householdId:admin.household.id,actorId:actor.id,studentId:student.id,question:'When is housing due?'}));
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM assistant_usage WHERE household_id=$1',[family.household.id])).n,1);
 });
 it('assistant cites only fresh certified official research for the right student',async()=>{
  const student=await C.queryOne<any>('SELECT id FROM students WHERE household_id=$1',[family.household.id]);
  const now=new Date().toISOString();
  await C.exec('INSERT INTO institutions(id,name,slug,created_at) VALUES($1,$2,$3,$4)',['school_cite','Example College','example-college',now]);
  await C.exec('INSERT INTO sources(id,institution_id,url,label,authority_level,last_verified,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',['source_cite','school_cite','https://example.edu/housing','Housing Office','official',now,now]);
  await C.exec('INSERT INTO research_versions(institution_id,research_term,coverage_status,coverage_pct,critical_gaps,certified_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)',['school_cite','Fall 2027','certified',100,0,now,now]);
  await C.exec(`INSERT INTO rules(id,institution_id,checkpoint_code,domain,title,requirement,status,confidence,research_term,cycle_state,applicability,evidence_quote,verified_at,source_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'verified','high','Fall 2027','current','applies',$7,$8,$9,$10,$11)`,['rule_cite','school_cite','HOUSING','housing','Housing application','Review official housing information.','Housing applications open in spring.',now,'source_cite',now,now]);
  await C.exec('INSERT INTO institution_relationships(id,student_id,institution_id,created_at) VALUES($1,$2,$3,$4)',['rel_cite',student.id,'school_cite',now]);
  await C.exec('INSERT INTO action_instances(id,relationship_id,rule_id,applicability_reason,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)',['action_cite','rel_cite','rule_cite','applies',now,now]);
  const fact=await Q.askCampus({householdId:family.household.id,actorId:'family-auth',studentId:student.id,question:'Tell me about housing application'});
  assert.equal(fact.kind,'fact');assert.equal(fact.citations[0].url,'https://example.edu/housing');assert.match(fact.text,/Fall 2027/);
  await C.exec('UPDATE sources SET last_verified=$1 WHERE id=$2',['2020-01-01T00:00:00.000Z','source_cite']);
  assert.equal((await Q.askCampus({householdId:family.household.id,actorId:'family-auth',studentId:student.id,question:'Tell me about housing application'})).kind,'unknown');
 });
 it('mail scope intersects verified source and sender policy; discards unrelated metadata and deduplicates',async()=>{
  const now=new Date().toISOString();
  await C.exec('UPDATE sources SET last_verified=$1 WHERE id=$2',[now,'source_cite']);
  await C.exec('INSERT INTO institution_sender_policies(id,institution_id,sender_domain,curated_by,created_at) VALUES($1,$2,$3,$4,$5)',['policy_cite','school_cite','example.edu',actor.id,now]);
  await C.exec('INSERT INTO verified_mail_senders(id,institution_id,domain,source_id,verified_at) VALUES($1,$2,$3,$4,$5)',['vendor_cite','school_cite','example.edu','source_cite',now]);
  const id=await M.storeConnectedMail({householdId:family.household.id,actorId:'family-auth',provider:'microsoft',accountId:'account',tokens:{accessToken:'access',refreshToken:'refresh'},consentVersion:'connected-mail-2026-09-v1'});
  const adapter={provider:'microsoft' as const,async listMinimalMetadata(scope:any){assert.deepEqual(scope.domains,['example.edu']);return {nextCheckpoint:'cursor1',envelopes:[{id:'m1',senderDomain:'spam.example.com',observedAt:now,authenticated:true},{id:'m2',senderDomain:'example.edu',observedAt:now,authenticated:true}]};}};
  assert.deepEqual(await M.syncConnectedMail({householdId:family.household.id,actorId:'family-auth',connectionId:id,adapter}),{accepted:1,quarantined:0});
  assert.deepEqual(await M.syncConnectedMail({householdId:family.household.id,actorId:'family-auth',connectionId:id,adapter}),{accepted:0,quarantined:0});
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM connected_mail_evidence WHERE connection_id=$1',[id])).n,1);
  await M.revokeConnectedMail({householdId:family.household.id,actorId:'family-auth',connectionId:id});
  assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM connected_mail_evidence WHERE connection_id=$1',[id])).n,0);
 });
 it('household deletion erases access while retaining de-identified cash audit',async()=>{
  const row=await C.queryOne<any>("SELECT household_id FROM cycle_orders WHERE id='test_order'");
  await A.deleteHousehold(row.household_id);
  assert.equal((await C.queryOne<any>("SELECT household_id FROM cycle_orders WHERE id='test_order'")).household_id,null);
  assert.equal((await C.queryOne<any>("SELECT COUNT(*) AS n FROM cycle_entitlements WHERE order_id='test_order'")).n,0);
  assert.equal((await X.accountingTotals('test_order')).payments,12000);
 });
});
