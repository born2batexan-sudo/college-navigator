import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'campus-enrollment-')), 'test.sqlite3');
delete process.env.DATABASE_URL;
process.env.ACCESS_CYCLE = 'Fall 2027';
process.env.DEMO_OWNER_EMAIL = 'admin@example.com';
let A: typeof import('../lib/db/accounts');
let S: typeof import('../lib/db/self-service-access');
let C: typeof import('../lib/db/client');
let P: typeof import('../lib/auth/product-access');
let G: typeof import('../lib/db/cycle-access');
const setup = { role: 'parent' as const, students: [{ name: 'River', enteringTerm: 'Fall 2027' }], purchaserAttested: true };

before(async () => {
  A = await import('../lib/db/accounts'); S = await import('../lib/db/self-service-access');
  C = await import('../lib/db/client'); P = await import('../lib/auth/product-access'); G = await import('../lib/db/cycle-access');
});

describe('verified-email self-service household journey (no payment, no owner approval)', () => {
  it('requires live verified Supabase identity and onboarding attestation at the server boundary', () => {
    const session = readFileSync(path.join(process.cwd(), 'lib/auth/session.ts'), 'utf8');
    const action = readFileSync(path.join(process.cwd(), 'app/onboarding/actions.ts'), 'utf8');
    assert.match(session, /supabase\.auth\.getUser\(\)/);
    assert.match(session, /!auth\.email_confirmed_at/);
    assert.match(session, /requireUser\(\{ next: "\/onboarding" \}\)/);
    assert.match(action, /purchaserAttested: z\.literal\("yes"\)/);
    assert.match(action, /canSelfServiceOnboard\(ctx\)/);
  });

  it('provisions one isolated household, grants after onboarding, and lets returning members in without a manual approval', async () => {
    const first = await A.provisionAccount({ authUserId: 'new-user', email: 'new@example.com' });
    const other = await A.provisionAccount({ authUserId: 'other-user', email: 'other@example.com' });
    assert.notEqual(first.household.id, other.household.id);
    assert.equal(await S.canSelfServiceOnboard(first), true);
    assert.equal(await P.hasProductAccess({ id: first.authUserId, email: first.email }, first.household.id), false);
    await assert.rejects(() => S.completeSelfServiceOnboarding(first, { ...setup, purchaserAttested: false }), /cycle/);
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM students WHERE household_id=$1', [first.household.id]), null);
    await S.completeSelfServiceOnboarding(first, setup);
    const returning = await A.provisionAccount({ authUserId: first.authUserId, email: first.email });
    assert.equal(returning.household.id, first.household.id);
    assert.equal(await P.hasProductAccess({ id: first.authUserId, email: first.email }, first.household.id), true);
    assert.equal(await P.hasProductAccess({ id: other.authUserId, email: other.email }, first.household.id), false);
    assert.equal(await P.hasProductAccess({ id: first.authUserId, email: first.email }, other.household.id), false);
    assert.equal(await C.queryOne('SELECT 1 FROM cycle_orders WHERE household_id=$1', [first.household.id]), null);
    assert.equal(await C.queryOne('SELECT 1 FROM beta_access_invites WHERE accepted_household_id=$1', [first.household.id]), null);
    assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM cycle_audit_events WHERE household_id=$1 AND event_type=$2', [first.household.id, 'self_service_granted']))?.n, 1);
  });

  it('serializes duplicate onboarding and duplicate provisioning without multiplying students, grants or audit events', async () => {
    const [one, two] = await Promise.all([
      A.provisionAccount({ authUserId: 'duplicate-user', email: 'dup@example.com' }),
      A.provisionAccount({ authUserId: 'duplicate-user', email: 'dup@example.com' }),
    ]);
    assert.equal(one.household.id, two.household.id);
    await Promise.all([S.completeSelfServiceOnboarding(one, setup), S.completeSelfServiceOnboarding(two, setup)]);
    await S.completeSelfServiceOnboarding(one, setup);
    assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM students WHERE household_id=$1', [one.household.id]))?.n, 1);
    assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM self_service_access WHERE household_id=$1', [one.household.id]))?.n, 1);
    assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM cycle_audit_events WHERE household_id=$1 AND event_type=$2', [one.household.id, 'self_service_granted']))?.n, 1);
    await assert.rejects(() => S.completeSelfServiceOnboarding(one, { ...setup, students: [{ name: 'Other', enteringTerm: 'Fall 2027' }] }), /not eligible/);
    assert.equal((await C.queryOne<any>('SELECT name FROM students WHERE household_id=$1', [one.household.id]))?.name, 'River');
  });

  it('rejects an unlinked/changed email and non-owner identity before a grant is written', async () => {
    const ctx = await A.provisionAccount({ authUserId: 'email-user', email: 'verified@example.com' });
    assert.equal(await S.canSelfServiceOnboard({ ...ctx, email: 'unverified@example.com' }), false);
    await assert.rejects(() => S.completeSelfServiceOnboarding({ ...ctx, email: 'unverified@example.com' }, setup), /not eligible/);
    assert.equal(await S.canSelfServiceOnboard({ ...ctx, authUserId: 'stranger' }), false);
    await assert.rejects(() => S.completeSelfServiceOnboarding({ ...ctx, authUserId: 'stranger' }, setup), /not eligible/);
    assert.equal(await S.canSelfServiceOnboard({ ...ctx, isOwner: false }), false);
    assert.equal(await C.queryOne('SELECT 1 FROM self_service_access WHERE household_id=$1', [ctx.household.id]), null);
  });

  it('exceptional administrator suspension revokes the whole household, cannot be self-repaired, and is audited', async () => {
    const ctx = await A.provisionAccount({ authUserId: 'suspended-user', email: 'suspended@example.com' });
    await S.completeSelfServiceOnboarding(ctx, setup);
    const admin = await A.provisionAccount({ authUserId: 'admin-identity', email: 'admin@example.com' });
    await assert.rejects(() => S.suspendSelfServiceHousehold({ householdId: ctx.household.id, actor: { id: ctx.authUserId, email: ctx.email! }, reason: 'abuse review' }), /Administrator/);
    await assert.rejects(() => S.suspendSelfServiceHousehold({ householdId: ctx.household.id, actor: { id: 'not-linked', email: 'admin@example.com' }, reason: 'abuse review' }), /Administrator/);
    // A legacy grant cannot accidentally bypass a household-wide suspension.
    await G.createComplimentary(ctx.household.id, { id: admin.authUserId, email: admin.email! }, 'legacy exception', 'test:legacy-suspension');
    assert.equal(await S.suspendSelfServiceHousehold({ householdId: ctx.household.id, actor: { id: admin.authUserId, email: admin.email! }, reason: 'Neutral abuse signal review' }), true);
    assert.equal(await S.suspendSelfServiceHousehold({ householdId: ctx.household.id, actor: { id: admin.authUserId, email: admin.email! }, reason: 'Neutral abuse signal review' }), false);
    assert.equal(await P.hasProductAccess({ id: ctx.authUserId, email: ctx.email }, ctx.household.id), false);
    assert.equal(await S.canSelfServiceOnboard(ctx), false);
    await assert.rejects(() => S.completeSelfServiceOnboarding(ctx, setup), /not eligible/);
    const event = await C.queryOne<any>('SELECT actor,detail_code FROM cycle_audit_events WHERE household_id=$1 AND event_type=$2', [ctx.household.id, 'access_revoked']);
    assert.equal(event.actor, admin.authUserId); assert.equal(event.detail_code, 'Neutral abuse signal review');
    assert.equal((await C.queryOne<any>('SELECT COUNT(*) AS n FROM students WHERE household_id=$1', [ctx.household.id]))?.n, 1);
  });
});
