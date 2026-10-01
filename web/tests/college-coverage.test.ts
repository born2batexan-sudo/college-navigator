import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  addonTestModeConfigured, collegeCoverageEnforced, decideAddonRefund, decideReservation, isVerifiedAddonPayment,
  quoteAddonUnits, verifyAddonCheckoutEvent, REFUND_COVERAGE_POLICY, type AddonPurchaseRecord, type CoverageAccount,
} from '../lib/payments/college-coverage';

// Fictional data only. No provider, network, or real database is used.
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'campus-coverage-')), 'coverage.sqlite3');
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL = 'owner@example.com';
process.env.REQUEST_ACCESS_HASH_SECRET = 'local-test-secret';
process.env.ACCESS_CYCLE = 'Fall 2027';
const STAGING: Record<string, string> = {
  PAYMENTS_TEST_MODE_ENABLED: '1', PAYMENTS_DEPLOYMENT_ENV: 'staging', VERCEL_ENV: 'preview',
  STRIPE_REVIEW_ENABLED: '1', STRIPE_EXPECT_LIVEMODE: '0', STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_ID: 'price_base', STRIPE_EXPECTED_AMOUNT_CENTS: '19900',
  APP_ORIGIN: 'https://staging.example.com', STRIPE_ADDON_PRICE_ID: 'price_addon', STRIPE_ADDON_UNIT_AMOUNT_CENTS: '1900',
  COLLEGE_COVERAGE_ENFORCEMENT: '1',
};
Object.assign(process.env, STAGING);

const acct = (o: Partial<CoverageAccount> = {}): CoverageAccount => ({ includedUnits: 10, purchasedUnits: 0, coveredUnits: 0, addonHold: false, ...o });
const CYCLE = 'Fall 2027';

describe('pure coverage decisions', () => {
  it('already-covered colleges never consume a unit, even at capacity or without access', () => {
    for (const a of [acct({ coveredUnits: 10 }), acct({ coveredUnits: 10, addonHold: true })]) {
      assert.deepEqual(decideReservation({ account: a, alreadyCovered: true, entitlementActive: false }), { outcome: 'already_covered', consumesUnit: false });
    }
  });
  it('consumes included units first, then purchased units, then blocks', () => {
    assert.equal(decideReservation({ account: acct({ coveredUnits: 9 }), alreadyCovered: false, entitlementActive: true }).outcome, 'consume_included');
    assert.equal(decideReservation({ account: acct({ coveredUnits: 10, purchasedUnits: 2 }), alreadyCovered: false, entitlementActive: true }).outcome, 'consume_addon');
    assert.deepEqual(decideReservation({ account: acct({ coveredUnits: 10 }), alreadyCovered: false, entitlementActive: true }), { outcome: 'blocked', consumesUnit: false, reason: 'capacity_exhausted' });
    assert.deepEqual(decideReservation({ account: acct({ coveredUnits: 12, purchasedUnits: 2 }), alreadyCovered: false, entitlementActive: true }), { outcome: 'blocked', consumesUnit: false, reason: 'capacity_exhausted' });
    assert.equal((decideReservation({ account: acct(), alreadyCovered: false, entitlementActive: false }) as any).reason, 'no_active_entitlement');
  });
  it('a refund hold freezes purchased capacity but not included capacity', () => {
    assert.equal(decideReservation({ account: acct({ coveredUnits: 5, addonHold: true }), alreadyCovered: false, entitlementActive: true }).outcome, 'consume_included');
    assert.equal((decideReservation({ account: acct({ coveredUnits: 10, purchasedUnits: 3, addonHold: true }), alreadyCovered: false, entitlementActive: true }) as any).reason, 'addon_refund_review');
  });
  it('quotes add-on units from server state, using slack first, $19 each', () => {
    const q = quoteAddonUnits(acct({ coveredUnits: 10 }), Array.from({ length: 10 }, (_, i) => `c${i}`), ['c1', 'n1', 'n2', 'n2']);
    assert.deepEqual([q.unitsToBuy, q.amountCents, q.slack, q.uncoveredCollegeIds.length], [2, 3800, 0, 2]);
    assert.equal(quoteAddonUnits(acct({ coveredUnits: 10, purchasedUnits: 1 }), [], ['x']).unitsToBuy, 0);
    assert.equal(quoteAddonUnits(acct({ coveredUnits: 8 }), [], ['a', 'b']).unitsToBuy, 0);
    assert.throws(() => quoteAddonUnits(acct(), [], ['../bad']));
    assert.throws(() => quoteAddonUnits(acct({ coveredUnits: 10 }), [], Array.from({ length: 60 }, (_, i) => `n${i}`)), /per-purchase/);
  });
  it('enforcement and add-on switches are staging/test only and fail closed', () => {
    assert.equal(collegeCoverageEnforced({}), false);
    assert.equal(collegeCoverageEnforced(STAGING), true);
    for (const [k, v] of [['COLLEGE_COVERAGE_ENFORCEMENT', '0'], ['PAYMENTS_TEST_MODE_ENABLED', '0'], ['PAYMENTS_DEPLOYMENT_ENV', 'production'], ['VERCEL_ENV', 'production']])
      assert.equal(collegeCoverageEnforced({ ...STAGING, [k]: v }), false, k);
    assert.equal(addonTestModeConfigured(STAGING), true);
    for (const k of Object.keys(STAGING).filter(k => !['VERCEL_ENV', 'COLLEGE_COVERAGE_ENFORCEMENT'].includes(k))) {
      const w = { ...STAGING }; delete w[k];
      assert.equal(addonTestModeConfigured(w), false, `accepted missing ${k}`);
    }
    for (const [k, v] of [['STRIPE_ADDON_PRICE_ID', 'price_base'], ['STRIPE_ADDON_UNIT_AMOUNT_CENTS', '2000'], ['STRIPE_SECRET_KEY', 'sk_live_x']])
      assert.equal(addonTestModeConfigured({ ...STAGING, [k]: v }), false, k);
  });
});

const purchase = (o: Partial<AddonPurchaseRecord> = {}): AddonPurchaseRecord => ({ id: 'addon_1', householdId: 'hh_1', cycle: CYCLE, units: 2, amountCents: 3800,
  priceId: 'price_addon', status: 'pending', providerSessionId: null, providerPaymentId: null, ...o });
const event = (o: any = {}, obj: any = {}) => ({ id: 'evt_1', type: 'checkout.session.completed', livemode: false, data: { object: {
  id: 'cs_1', mode: 'payment', livemode: false, payment_status: 'paid', currency: 'usd', amount_total: 3800, payment_intent: 'pi_1',
  metadata: { addon_purchase_id: 'addon_1', household_id: 'hh_1', cycle: CYCLE }, ...obj } }, ...o });

describe('verified add-on evidence (pure)', () => {
  it('accepts only a fully matching paid test-mode event and brands the evidence', () => {
    const r = verifyAddonCheckoutEvent(event(), purchase(), STAGING);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(isVerifiedAddonPayment(r.evidence), true); assert.equal(r.evidence.units, 2); assert.equal(Object.isFrozen(r.evidence), true); }
    assert.equal(isVerifiedAddonPayment({ ...(r as any).evidence }), false, 'a copied/forged object is not accepted');
  });
  it('refuses every mismatch, redirect-like, unpaid, live, or replayed-state input', () => {
    const cases: [string, any, Partial<AddonPurchaseRecord> | null, string][] = [
      ['unknown purchase', event(), null, 'unknown_purchase'],
      ['not a success event', event({ type: 'checkout.session.expired' }), {}, 'not_success_event'],
      ['live event', event({ livemode: true }), {}, 'live_event_refused'],
      ['unpaid session', event({}, { payment_status: 'unpaid' }), {}, 'payment_not_verified'],
      ['wrong currency', event({}, { currency: 'eur' }), {}, 'payment_not_verified'],
      ['wrong mode', event({}, { mode: 'subscription' }), {}, 'payment_not_verified'],
      ['client-influenced amount', event({}, { amount_total: 1900 }), {}, 'amount_mismatch'],
      ['metadata household', event({}, { metadata: { addon_purchase_id: 'addon_1', household_id: 'hh_2', cycle: CYCLE } }), {}, 'metadata_mismatch'],
      ['metadata cycle', event({}, { metadata: { addon_purchase_id: 'addon_1', household_id: 'hh_1', cycle: 'Fall 2028' } }), {}, 'metadata_mismatch'],
      ['price changed', event(), { priceId: 'price_other' }, 'price_mismatch'],
      ['amount not units*$19', event(), { amountCents: 3700 }, 'amount_invalid'],
      ['session differs', event(), { providerSessionId: 'cs_other' }, 'session_mismatch'],
      ['missing payment intent', event({}, { payment_intent: null }), {}, 'payment_intent_missing'],
      ['exception purchase', event(), { status: 'exception' }, 'purchase_state_conflict'],
      ['deleted household', event(), { householdId: null }, 'household_missing'],
    ];
    for (const [name, ev, p, code] of cases) {
      const r = verifyAddonCheckoutEvent(ev, p === null ? null : purchase(p), STAGING);
      assert.deepEqual(r, { ok: false, code }, name);
    }
    assert.deepEqual(verifyAddonCheckoutEvent(event(), purchase(), { ...STAGING, PAYMENTS_DEPLOYMENT_ENV: 'production' }), { ok: false, code: 'addon_disabled' });
  });
});

describe('refund decisions and policy (pure)', () => {
  const p = (o: any = {}) => ({ status: 'provisioned' as const, amountCents: 3800, refundedCents: 0, ...o });
  it('holds for review on any new refund; replays and zero are no-ops; nonsense is an exception', () => {
    assert.deepEqual(decideAddonRefund({ purchase: p(), eventRefundedCents: 1900, currency: 'usd' }), { action: 'hold_for_review', refundedCents: 1900 });
    assert.deepEqual(decideAddonRefund({ purchase: p({ status: 'refund_review', refundedCents: 1900 }), eventRefundedCents: 3800, currency: 'usd' }), { action: 'hold_for_review', refundedCents: 3800 });
    assert.deepEqual(decideAddonRefund({ purchase: p({ refundedCents: 1900 }), eventRefundedCents: 1900, currency: 'usd' }), { action: 'no_change' });
    assert.deepEqual(decideAddonRefund({ purchase: p(), eventRefundedCents: 0, currency: 'usd' }), { action: 'no_change' });
    const bad: [any, any, any, string][] = [[null, 1, 'usd', 'unknown_payment'], [p(), 1, 'eur', 'refund_currency_mismatch'], [p(), 3801, 'usd', 'refund_amount_invalid'],
      [p(), -1, 'usd', 'refund_amount_invalid'], [p(), 1.5, 'usd', 'refund_amount_invalid'], [p({ status: 'pending' }), 100, 'usd', 'refund_state_conflict'],
      [p({ status: 'refund_review', refundedCents: 3800 }), 1900, 'usd', 'refund_regression']];
    for (const [pp, c, cur, code] of bad) assert.deepEqual(decideAddonRefund({ purchase: pp, eventRefundedCents: c, currency: cur }), { action: 'exception', code });
  });
  it('policy never revokes research, coverage or granted capacity automatically', () => {
    assert.deepEqual(REFUND_COVERAGE_POLICY, { revokeStartedResearch: false, removeCoveredColleges: false, reduceGrantedCapacity: false, freezeNewPurchasedCapacityUse: true, requiresExplicitOwnerReview: true });
    assert.equal(Object.isFrozen(REFUND_COVERAGE_POLICY), true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('durable coverage against the local database (fictional households)', () => {
  let A: typeof import('../lib/db/accounts');
  let C: typeof import('../lib/db/client');
  let K: typeof import('../lib/db/college-coverage');
  let Q: typeof import('../lib/db/requests');
  let seq = 0;

  async function household(cycle = CYCLE, opts: { paid?: boolean; entitled?: boolean } = {}) {
    const n = ++seq;
    const ctx = await A.provisionAccount({ authUserId: `u${n}`, email: `family${n}@example.com` });
    await A.completeOnboarding(ctx, { studentName: `Student ${n}`, role: 'parent', enteringTerm: cycle });
    if (opts.entitled !== false) await entitle(ctx.household.id, cycle, opts.paid !== false);
    return { id: ctx.household.id, authUserId: `u${n}`, ctx };
  }
  async function entitle(householdId: string, cycle: string, paid = true) {
    const orderId = `order_${householdId}_${cycle.replace(' ', '')}`, now = new Date().toISOString();
    if (paid) await C.exec("INSERT INTO cycle_orders(id,household_id,cycle,kind,price_id,amount_cents,status,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,'paid','price_base',19900,'paid',$4,$5,$6)", [orderId, householdId, cycle, `k:${orderId}`, now, now]);
    else await C.exec("INSERT INTO cycle_orders(id,household_id,cycle,kind,price_id,amount_cents,status,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,'complimentary',NULL,0,'complimentary',$4,$5,$6)", [orderId, householdId, cycle, `k:${orderId}`, now, now]);
    await C.exec("INSERT INTO cycle_entitlements(id,household_id,cycle,order_id,kind,starts_at,expires_at,authorized_by) VALUES($1,$2,$3,$4,$5,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','test')", [`ent_${orderId}`, householdId, cycle, orderId, paid ? 'paid' : 'complimentary']);
  }
  const reserve = (h: string, college: string, person: string | null = null, cycle = CYCLE) => K.reserveCollegeCoverage({ householdId: h, cycle, collegeId: college, personId: person });
  const fill = async (h: string, n: number, prefix = 'c') => { for (let i = 0; i < n; i++) assert.equal((await reserve(h, `${prefix}${i}`)).status, 'covered'); };
  const summary = (h: string, cycle = CYCLE) => K.getCollegeCoverageSummary(h, cycle);
  async function provision(h: { id: string; authUserId: string }, desired: string[], tag: string, eventId = `evt_${tag}`, pi = `pi_${tag}`) {
    const p = await K.createPendingAddonPurchase({ householdId: h.id, authUserId: h.authUserId, cycle: CYCLE, desiredCollegeIds: desired, idempotencyKey: `idem-${tag}-key` });
    const ev = event({ id: eventId }, { id: `cs_${tag}`, amount_total: p.amountCents, payment_intent: pi, metadata: { addon_purchase_id: p.id, household_id: h.id, cycle: CYCLE } });
    const v = verifyAddonCheckoutEvent(ev, p, STAGING);
    assert.equal(v.ok, true, JSON.stringify(v));
    return { p, ev, evidence: (v as any).evidence };
  }

  before(async () => {
    A = await import('../lib/db/accounts'); C = await import('../lib/db/client');
    K = await import('../lib/db/college-coverage'); Q = await import('../lib/db/requests');
    const owner = await A.provisionAccount({ authUserId: 'owner-auth', email: 'owner@example.com' });
    await A.completeOnboarding(owner, { studentName: 'Template', role: 'parent', enteringTerm: CYCLE });
  });

  it('includes ten unique colleges shared across students; the eleventh is blocked', async () => {
    const h = await household();
    for (let i = 0; i < 10; i++) {
      const r = await reserve(h.id, `col${i}`, i % 2 ? 'student-a' : 'student-b');
      assert.deepEqual([r.status, (r as any).consumedUnit, (r as any).source], ['covered', true, 'included']);
    }
    assert.deepEqual(await reserve(h.id, 'col10', 'student-a'), { status: 'blocked', reason: 'capacity_exhausted' });
    const s = await summary(h.id);
    assert.deepEqual([s.coveredUnits, s.remainingUnits, s.coveredCollegeIds.length], [10, 0, 10]);
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM college_coverage_colleges WHERE household_id=$1 AND college_id=$2', [h.id, 'col10']), null, 'blocked college leaves no coverage row');
  });

  it('re-adding, or another student using an already-covered college, consumes nothing and works at capacity', async () => {
    const h = await household();
    await fill(h.id, 10);
    for (const person of ['student-a', 'student-b', null]) {
      const r = await reserve(h.id, 'c3', person);
      assert.deepEqual([r.status, (r as any).consumedUnit, (r as any).source], ['covered', false, 'existing']);
    }
    assert.equal((await summary(h.id)).coveredUnits, 10);
  });

  it('removing a college after research starts never restores allowance', async () => {
    const h = await household();
    await K.reserveCollegeCoverage({ householdId: h.id, cycle: CYCLE, collegeId: '5000', personId: null });
    await C.exec("INSERT INTO school_directory(unitid,name,search_text,updated_at) VALUES('5000','Removed U','removed u',$1) ON CONFLICT(unitid) DO NOTHING", [new Date().toISOString()]);
    await fill(h.id, 9, 'other');
    // Simulate tracking removal + research already started: request rows and job are gone/complete.
    await C.exec('DELETE FROM school_requests WHERE household_id=$1', [h.id]);
    await C.exec("UPDATE college_coverage_accounts SET updated_at=updated_at WHERE household_id=$1", [h.id]);
    assert.equal((await reserve(h.id, 'brand-new')).status, 'blocked', 'still at 10 covered after removal');
    const back = await reserve(h.id, '5000');
    assert.deepEqual([back.status, (back as any).consumedUnit], ['covered', false]);
    assert.equal((await summary(h.id)).coveredUnits, 10);
  });

  it('simultaneous attempts at uncovered colleges cannot bypass capacity', async () => {
    const h = await household();
    await fill(h.id, 9);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(h.id, `race${i}`)));
    assert.equal(results.filter(r => r.status === 'covered').length, 1);
    assert.equal(results.filter(r => r.status === 'blocked' && (r as any).reason === 'capacity_exhausted').length, 7);
    const wide = await household();
    const many = await Promise.all(Array.from({ length: 25 }, (_, i) => reserve(wide.id, `w${i}`, `p${i % 3}`)));
    assert.equal(many.filter(r => r.status === 'covered').length, 10);
    const s = await summary(wide.id);
    assert.deepEqual([s.coveredUnits, s.coveredCollegeIds.length], [10, 10]);
  });

  it('simultaneous attempts at the SAME college consume exactly one unit', async () => {
    const h = await household();
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve(h.id, 'same', `p${i}`)));
    assert.equal(rs.every(r => r.status === 'covered'), true);
    assert.equal(rs.filter(r => (r as any).consumedUnit).length, 1);
    assert.equal((await summary(h.id)).coveredUnits, 1);
  });

  it('database invariants hold even if a stale application decision were applied', async () => {
    const h = await household();
    await fill(h.id, 9);
    await C.withTransaction(async () => {
      assert.equal(await K.claimCoverageUnit(h.id, CYCLE), 10);
      assert.equal(await K.claimCoverageUnit(h.id, CYCLE), null, 'second stale claim is refused atomically');
    });
    await assert.rejects(() => C.exec('UPDATE college_coverage_accounts SET covered_units=11 WHERE household_id=$1', [h.id]), /CHECK|constraint/i);
    await assert.rejects(() => C.exec('UPDATE college_coverage_accounts SET included_units=11 WHERE household_id=$1', [h.id]), /CHECK|constraint/i);
    await assert.rejects(() => C.exec("INSERT INTO college_coverage_colleges(household_id,cycle,college_id,source,first_covered_at) VALUES($1,$2,'c0','included','x')", [h.id, CYCLE]), /UNIQUE|constraint/i);
    await assert.rejects(() => C.exec("INSERT INTO college_addon_purchases(id,cycle,units,amount_cents,price_id,status,idempotency_key,created_at,updated_at) VALUES('x','Fall 2027',2,1900,'p','pending','k','n','n')"), /CHECK|constraint/i, 'amount must equal units*$19');
    await assert.rejects(() => C.exec("INSERT INTO college_addon_purchases(id,cycle,units,amount_cents,price_id,status,provider_payment_id,idempotency_key,created_at,updated_at) VALUES('y','Fall 2027',1,1900,'p','pending','pi_x','k2','n','n')"), /CHECK|constraint/i, 'pending row may not carry a payment id');
  });

  it('isolates households and cycles', async () => {
    const a = await household(), b = await household();
    await fill(a.id, 10);
    assert.equal((await reserve(a.id, 'zz')).status, 'blocked');
    assert.equal((await reserve(b.id, 'zz')).status, 'covered', 'other household unaffected');
    assert.equal((await reserve(b.id, 'c0')).status, 'covered');
    assert.equal((await summary(b.id)).coveredUnits, 2);
    await entitle(a.id, 'Fall 2028');
    assert.equal((await reserve(a.id, 'zz', null, 'Fall 2028')).status, 'covered', 'another cycle has its own allowance');
    assert.deepEqual([(await summary(a.id, 'Fall 2028')).coveredUnits, (await summary(a.id)).coveredUnits], [1, 10]);
  });

  it('blocks ineligible households, missing entitlement, revoked access, bad ids and cycles without touching state', async () => {
    const none = await household(CYCLE, { entitled: false });
    assert.deepEqual(await reserve(none.id, 'a'), { status: 'blocked', reason: 'no_active_entitlement' });
    assert.deepEqual(await reserve('nope', 'a'), { status: 'blocked', reason: 'ineligible_household' });
    assert.deepEqual(await reserve(none.id, '../x'), { status: 'blocked', reason: 'invalid_college' });
    assert.deepEqual(await reserve(none.id, 'a', null, 'Winter 2028'), { status: 'blocked', reason: 'invalid_cycle' });
    assert.equal((await summary(none.id)).coveredUnits, 0);
    const h = await household();
    await reserve(h.id, 'kept');
    await C.exec("UPDATE cycle_entitlements SET revoked_at='2026-01-01T00:00:00.000Z' WHERE household_id=$1", [h.id]);
    assert.deepEqual(await reserve(h.id, 'fresh'), { status: 'blocked', reason: 'no_active_entitlement' });
    assert.equal((await reserve(h.id, 'kept')).status, 'covered', 'revocation does not erase recorded coverage');
  });

  it('local coverage requires a directory member for six-digit federal IDs', async () => {
    const h = await household();
    await Q.upsertDirectorySchool({ unitid: '999998', name: 'Directory Fixture University', city: 'Testville', state: 'TX', domain: 'fixture.example.edu' });
    assert.deepEqual(await reserve(h.id, '999997'), { status: 'blocked', reason: 'invalid_college' });
    const covered = await reserve(h.id, '999998');
    assert.equal(covered.status, 'covered');
    assert.equal((await summary(h.id)).coveredUnits, 1);
  });

  it('pending purchase and redirect state never grant capacity', async () => {
    const h = await household();
    await fill(h.id, 10);
    const p = await K.createPendingAddonPurchase({ householdId: h.id, authUserId: h.authUserId, cycle: CYCLE, desiredCollegeIds: ['n1', 'n2', 'c0'], idempotencyKey: 'idem-pending-1' });
    assert.deepEqual([p.status, p.units, p.amountCents, p.priceId], ['pending', 2, 3800, 'price_addon']);
    const replay = await K.createPendingAddonPurchase({ householdId: h.id, authUserId: h.authUserId, cycle: CYCLE, desiredCollegeIds: ['n1', 'n2'], idempotencyKey: 'idem-pending-1' });
    assert.equal(replay.id, p.id);
    const s = await summary(h.id);
    assert.deepEqual([s.purchasedUnits, s.pendingAddonUnits, s.remainingUnits], [0, 2, 0]);
    assert.deepEqual(await reserve(h.id, 'n1'), { status: 'blocked', reason: 'capacity_exhausted' });
    // Same owner, a different quantity while one is pending: refused, not stacked.
    await assert.rejects(() => K.createPendingAddonPurchase({ householdId: h.id, authUserId: h.authUserId, cycle: CYCLE, desiredCollegeIds: ['n1'], idempotencyKey: 'idem-pending-2' }), /already pending/);
    // Authorization and eligibility boundaries.
    const other = await household();
    await assert.rejects(() => K.createPendingAddonPurchase({ householdId: h.id, authUserId: other.authUserId, cycle: CYCLE, desiredCollegeIds: ['n1'], idempotencyKey: 'idem-pending-3' }), /owner required/);
    await assert.rejects(() => K.createPendingAddonPurchase({ householdId: h.id, authUserId: h.authUserId, cycle: CYCLE, desiredCollegeIds: ['c0'], idempotencyKey: 'idem-pending-4' }), /idempotency|No add-on|already pending/i);
    const comp = await household(CYCLE, { paid: false });
    await assert.rejects(() => K.createPendingAddonPurchase({ householdId: comp.id, authUserId: comp.authUserId, cycle: CYCLE, desiredCollegeIds: Array.from({ length: 11 }, (_, i) => `x${i}`), idempotencyKey: 'idem-comp-1' }), /paid access/);
    await assert.rejects(() => K.createPendingAddonPurchase({ householdId: h.id, authUserId: h.authUserId, cycle: CYCLE, desiredCollegeIds: ['n1'], idempotencyKey: 'idem-off-1' }, { ...STAGING, STRIPE_ADDON_PRICE_ID: '' }), /not enabled/);
  });

  it('only verified idempotent provisioning grants capacity; replays and duplicates do not duplicate units', async () => {
    const h = await household();
    await fill(h.id, 10);
    const { p, evidence } = await provision(h, ['n1', 'n2'], 'grant1');
    await assert.rejects(() => K.provisionVerifiedCollegeAddon({ ...evidence } as any), /Verified add-on payment evidence required/);
    await assert.rejects(() => K.provisionVerifiedCollegeAddon({ purchaseId: p.id, units: 99 } as any), /Verified/);
    assert.equal((await summary(h.id)).purchasedUnits, 0);
    assert.deepEqual(await K.provisionVerifiedCollegeAddon(evidence, { ...STAGING, PAYMENTS_DEPLOYMENT_ENV: 'production' }), { status: 'exception', code: 'addon_disabled', unitsGranted: 0 });
    assert.equal((await summary(h.id)).purchasedUnits, 0, 'disabled switch grants nothing');
    // Simultaneous duplicate deliveries: exactly one grant.
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => K.provisionVerifiedCollegeAddon(evidence)));
    assert.equal(outcomes.filter(o => o.status === 'provisioned').length, 1);
    assert.equal(outcomes.filter(o => o.status === 'already_provisioned').length, 5);
    assert.equal((await K.provisionVerifiedCollegeAddon(evidence)).status, 'already_provisioned');
    const s = await summary(h.id);
    assert.deepEqual([s.purchasedUnits, s.remainingUnits, s.pendingAddonUnits], [2, 2, 0]);
    const grants = await C.queryRows<any>("SELECT units,amount_cents FROM college_capacity_events WHERE household_id=$1 AND kind='addon_grant'", [h.id]);
    assert.deepEqual(grants.map(g => [g.units, g.amount_cents]), [[2, 3800]]);
    // Purchased capacity is usable exactly to its size.
    assert.equal((await reserve(h.id, 'n1')).status, 'covered');
    assert.equal((await reserve(h.id, 'n2')).status, 'covered');
    assert.deepEqual(await reserve(h.id, 'n3'), { status: 'blocked', reason: 'capacity_exhausted' });
    assert.equal(((await summary(h.id)).coveredUnits), 12);
    assert.equal((await C.queryOne<any>('SELECT source FROM college_coverage_colleges WHERE household_id=$1 AND college_id=$2', [h.id, 'n1']))!.source, 'addon');
  });

  it('refuses a second payment for a provisioned purchase and payment-id reuse across purchases', async () => {
    const h = await household();
    await fill(h.id, 10);
    const first = await provision(h, ['q1'], 'dup1');
    assert.equal((await K.provisionVerifiedCollegeAddon(first.evidence)).status, 'provisioned');
    // A different verified payment intent for the same purchase is a conflict, not extra units.
    const ev2 = event({ id: 'evt_dup1b' }, { id: 'cs_dup1', amount_total: 1900, payment_intent: 'pi_other', metadata: { addon_purchase_id: first.p.id, household_id: h.id, cycle: CYCLE } });
    const bad = verifyAddonCheckoutEvent(ev2, { ...first.p, status: 'provisioned', providerPaymentId: 'pi_dup1' } as any, STAGING);
    assert.equal(bad.ok, true);
    assert.deepEqual(await K.provisionVerifiedCollegeAddon((bad as any).evidence), { status: 'exception', code: 'payment_conflict', unitsGranted: 0 });
    assert.equal((await summary(h.id)).purchasedUnits, 1);
    // Payment intent already bound to another purchase cannot be reused.
    const g = await household(); await fill(g.id, 10);
    const second = await provision(g, ['q2'], 'dup2', 'evt_dup2', 'pi_dup1');
    assert.deepEqual(await K.provisionVerifiedCollegeAddon(second.evidence), { status: 'exception', code: 'payment_reuse', unitsGranted: 0 });
    assert.equal((await summary(g.id)).purchasedUnits, 0);
  });

  it('refunds fail safe: freeze new purchased capacity, keep coverage and granted units, replay-safe, owner-reviewed release', async () => {
    const h = await household();
    await fill(h.id, 10);
    const { p, evidence } = await provision(h, ['n1', 'n2'], 'ref1');
    await K.provisionVerifiedCollegeAddon(evidence);
    assert.equal((await reserve(h.id, 'n1')).status, 'covered');           // one purchased unit used, one unused
    const before = await C.queryRows<any>('SELECT college_id FROM college_coverage_colleges WHERE household_id=$1 ORDER BY college_id', [h.id]);
    const refund = (eventId: string, cents: unknown, pi = 'pi_ref1', currency: unknown = 'usd') => K.recordAddonRefundForReview({ paymentIntentId: pi, refundedCents: cents, currency, eventId });
    assert.deepEqual(await refund('evt_r1', 1900), { status: 'held_for_review', code: 'addon_refund_hold' });
    let s = await summary(h.id);
    assert.deepEqual([s.purchasedUnits, s.coveredUnits, s.addonHold], [2, 11, true], 'no automatic revocation');
    assert.deepEqual(await C.queryRows<any>('SELECT college_id FROM college_coverage_colleges WHERE household_id=$1 ORDER BY college_id', [h.id]), before);
    assert.equal((await reserve(h.id, 'n1')).status, 'covered', 'already-started research stays covered');
    assert.deepEqual(await reserve(h.id, 'n2'), { status: 'blocked', reason: 'addon_refund_review' }, 'unused purchased capacity frozen');
    await assert.rejects(() => K.createPendingAddonPurchase({ householdId: h.id, authUserId: h.authUserId, cycle: CYCLE, desiredCollegeIds: ['zz'], idempotencyKey: 'idem-hold-1' }), /paused/);
    assert.deepEqual(await refund('evt_r1', 1900), { status: 'no_change', code: 'refund_already_recorded' });
    assert.deepEqual(await refund('evt_r2', 1900), { status: 'no_change', code: 'refund_already_recorded' });
    assert.deepEqual(await refund('evt_r3', 3800), { status: 'held_for_review', code: 'addon_refund_hold' });
    assert.equal((await K.getAddonPurchase(p.id))!.status, 'refund_review');
    assert.deepEqual(await refund('evt_r4', 1900), { status: 'exception', code: 'refund_regression' });
    assert.deepEqual(await refund('evt_r5', 100, 'pi_unknown'), { status: 'exception', code: 'unknown_payment' });
    assert.deepEqual(await refund('evt_r6', 9999), { status: 'exception', code: 'refund_amount_invalid' });
    assert.deepEqual(await refund('evt_r7', 100, 'pi_ref1', 'eur'), { status: 'exception', code: 'refund_currency_mismatch' });
    assert.equal((await refund('evt_r8', 100, 'pi_ref1', 'usd').then(r => r.code)), 'refund_regression');
    assert.deepEqual(await K.recordAddonRefundForReview({ paymentIntentId: 'pi_ref1', refundedCents: 3800, currency: 'usd', eventId: 'evt_r3' }, {}), { status: 'exception', code: 'addon_disabled' });
    s = await summary(h.id);
    assert.deepEqual([s.purchasedUnits, s.coveredUnits], [2, 11]);
    // Release requires the owner and an explicit reason; it keeps capacity and research, and a replay of the old refund does not re-freeze.
    const nonOwner = { id: 'u-not-owner', email: 'family1@example.com' };
    await assert.rejects(() => K.releaseAddonRefundHold({ purchaseId: p.id, actor: nonOwner, reason: 'reviewed' }), /Owner authorization/);
    const owner = { id: 'owner-auth', email: 'owner@example.com' };
    await assert.rejects(() => K.releaseAddonRefundHold({ purchaseId: p.id, actor: owner, reason: 'x' }), /reason/i);
    assert.equal(await K.releaseAddonRefundHold({ purchaseId: p.id, actor: owner, reason: 'reviewed: keep started research and capacity' }), true);
    assert.equal(await K.releaseAddonRefundHold({ purchaseId: p.id, actor: owner, reason: 'reviewed: keep started research and capacity' }), false);
    assert.equal((await summary(h.id)).addonHold, false);
    assert.deepEqual(await refund('evt_r9', 3800), { status: 'no_change', code: 'refund_already_recorded' });
    assert.equal((await reserve(h.id, 'n2')).status, 'covered');
  });

  it('a refund before any purchased unit is used still cannot revoke included-capacity coverage', async () => {
    const h = await household();
    await fill(h.id, 4);
    const { evidence } = await provision(h, Array.from({ length: 7 }, (_, i) => `z${i}`), 'ref2');
    await K.provisionVerifiedCollegeAddon(evidence);
    await K.recordAddonRefundForReview({ paymentIntentId: 'pi_ref2', refundedCents: 1900, currency: 'usd', eventId: 'evt_x1' });
    assert.equal((await reserve(h.id, 'incl-still-ok')).status, 'covered', 'included capacity remains usable');
    assert.equal((await summary(h.id)).coveredUnits, 5);
  });

  it('createSchoolRequest is unchanged when enforcement is off and coverage-gated (with rollback) when on', async () => {
    const base = 'Fall 2027';
    const spread = async (h: string) => C.exec("UPDATE school_requests SET created_at='2020-01-01T00:00:00.000Z' WHERE household_id=$1", [h]);
    const dir = async (base: number, n: number) => { for (let i = 0; i < n; i++) await Q.upsertDirectorySchool({ unitid: String(base + i), name: `Coverage College ${base + i}`, domain: `cc${base + i}.edu` }); };
    await dir(700000, 13); await dir(710000, 13);
    const off = await household();
    const offEnv = process.env.COLLEGE_COVERAGE_ENFORCEMENT; process.env.COLLEGE_COVERAGE_ENFORCEMENT = '0';
    try {
      for (let i = 0; i < 12; i++) { await Q.createSchoolRequest({ householdId: off.id, unitid: String(700000 + i), term: base }); await spread(off.id); }
      assert.equal((await summary(off.id)).coveredUnits, 0, 'no coverage state written while enforcement is off');
    } finally { process.env.COLLEGE_COVERAGE_ENFORCEMENT = offEnv; }
    const on = await household();
    for (let i = 0; i < 10; i++) { await Q.createSchoolRequest({ householdId: on.id, personId: on.ctx.person?.id, unitid: String(710000 + i), term: base }); await spread(on.id); }
    await assert.rejects(() => Q.createSchoolRequest({ householdId: on.id, unitid: '710010', term: base }), (e: any) => e instanceof K.CollegeCoverageBlockedError && e.reason === 'capacity_exhausted');
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM school_requests WHERE household_id=$1 AND unitid=$2', [on.id, '710010']), null, 'no request row for blocked college');
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM school_research_jobs WHERE unitid=$1', ['710010']), null, 'no research job queued for blocked college');
    // Duplicate click on a covered college is still a normal no-op; removal + re-request consumes nothing.
    assert.equal((await Q.createSchoolRequest({ householdId: on.id, unitid: '710001', term: base })).created, false);
    await C.exec('DELETE FROM school_requests WHERE household_id=$1 AND unitid=$2', [on.id, '710001']);
    assert.equal((await Q.createSchoolRequest({ householdId: on.id, unitid: '710001', term: base })).created, true);
    assert.equal((await summary(on.id)).coveredUnits, 10);
    // A failure after reservation (monthly limit) rolls the unit back too.
    const lim = await household();
    for (let i = 0; i < 3; i++) await Q.createSchoolRequest({ householdId: lim.id, unitid: String(710000 + i), term: base });
    await assert.rejects(() => Q.createSchoolRequest({ householdId: lim.id, unitid: '710003', term: base }), /three new schools/);
    assert.equal((await summary(lim.id)).coveredUnits, 3, 'failed request did not consume a unit');
  });

  it('requires exactly one reviewed UNITID when tracking and deduplicates a later research request', async () => {
    const h = await household();
    const now = new Date().toISOString();
    await C.exec("INSERT INTO self_service_access(household_id,cycle,auth_user_id,starts_at,expires_at,created_at) VALUES($1,$2,$3,'2020-01-01T00:00:00Z','2099-01-01T00:00:00Z',$4)", [h.id, CYCLE, h.authUserId, now]);
    await C.exec("INSERT INTO institutions(id,name,slug,created_at) VALUES('inst_fixture_unitid','Review Test College','review-test-college',$1)", [now]);
    const tracked = () => K.requireBetaTrackedCollege({ householdId: h.id, cycle: CYCLE, institutionId: 'inst_fixture_unitid' });
    await assert.rejects(tracked, (e: any) => e instanceof K.CollegeCoverageBlockedError && e.reason === 'invalid_college', 'no fallback to internal ID');
    assert.equal((await summary(h.id)).coveredUnits, 0);
    await Q.upsertDirectorySchool({ unitid: '812345', name: 'Review Test College', city: 'Testville', state: 'TX' });
    await C.exec("UPDATE school_directory SET institution_id='inst_fixture_unitid' WHERE unitid='812345'");
    await tracked();
    assert.deepEqual([(await summary(h.id)).coveredUnits, (await summary(h.id)).coveredCollegeIds], [1, ['812345']]);
    await Q.createSchoolRequest({ householdId: h.id, unitid: '812345', term: CYCLE });
    await tracked();
    assert.equal((await summary(h.id)).coveredUnits, 1, 'tracking and research, including repeated tracking, consume one UNITID');
    await Q.upsertDirectorySchool({ unitid: '812346', name: 'Ambiguous Review College' });
    await C.exec("UPDATE school_directory SET institution_id='inst_fixture_unitid' WHERE unitid='812346'");
    await assert.rejects(tracked, (e: any) => e instanceof K.CollegeCoverageBlockedError && e.reason === 'invalid_college', 'ambiguous mappings fail closed');
    assert.equal((await summary(h.id)).coveredUnits, 1);
  });

  it('household deletion removes coverage state but retains de-identified payment records', async () => {
    const h = await household();
    await fill(h.id, 10);
    const { p, evidence } = await provision(h, ['d1'], 'del1');
    await K.provisionVerifiedCollegeAddon(evidence);
    await A.deleteHousehold(h.id);
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM college_coverage_accounts WHERE household_id=$1', [h.id]), null);
    assert.equal(await C.queryOne('SELECT 1 AS ok FROM college_coverage_colleges WHERE household_id=$1', [h.id]), null);
    const kept = await C.queryOne<any>('SELECT household_id,status,provider_payment_id FROM college_addon_purchases WHERE id=$1', [p.id]);
    assert.deepEqual([kept.household_id, kept.status, kept.provider_payment_id], [null, 'provisioned', 'pi_del1']);
  });
});

describe('static guards on the coverage implementation', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf-8');
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const f = path.join(d, n); return n === 'node_modules' || n === '.next' ? [] : statSync(f).isDirectory() ? walk(f) : [f]; });
  it('no source path deletes or rewrites coverage/capacity history', () => {
    const files = [...walk('lib'), ...walk('app')].filter(f => /\.(ts|tsx)$/.test(f));
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      assert.equal(/DELETE\s+FROM\s+college_(coverage_colleges|capacity_events|coverage_accounts|addon_purchases)/i.test(src), false, `${f} deletes coverage state`);
      assert.equal(/UPDATE\s+college_coverage_colleges|UPDATE\s+college_capacity_events/i.test(src), false, `${f} rewrites history`);
      if (f !== path.join('lib', 'db', 'college-coverage.ts')) {
        assert.equal(/purchased_units\s*=|INSERT\s+INTO\s+college_(coverage|addon|capacity)/i.test(src), false, `${f} mutates capacity outside the coverage module`);
      }
    }
  });
  it('purchased capacity is increased in exactly one place and never from a refund or read path', () => {
    const src = read('lib/db/college-coverage.ts');
    assert.equal((src.match(/purchased_units\s*=\s*purchased_units\s*\+/g) ?? []).length, 1);
    assert.equal(/purchased_units\s*=\s*purchased_units\s*-/.test(src), false);
    assert.equal(/fetch\(|api\.stripe\.com|sk_live|process\.env\.STRIPE_SECRET_KEY/.test(src + read('lib/payments/college-coverage.ts')), false, 'no outbound provider calls or secret use');
  });
  it('migration is additive, RLS-locked, and mirrors schema.sql and the RLS table list', () => {
    const mig = read('lib/db/deploy/20260930-college-coverage.sql'), schema = read('lib/db/schema.sql'), accounts = read('lib/db/accounts.ts');
    assert.equal(/DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE\s+\w+\s+(DROP|ALTER\s+COLUMN)|TRUNCATE|DELETE\s+FROM/i.test(mig), false);
    for (const t of ['college_coverage_accounts', 'college_coverage_colleges', 'college_addon_purchases', 'college_capacity_events']) {
      assert.match(mig, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
      assert.match(mig, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
      assert.match(mig, new RegExp(`REVOKE ALL ON TABLE [^;]*\\b${t}\\b[^;]* FROM anon,authenticated`));
      assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
      assert.ok(accounts.includes(`'${t}'`), `${t} missing from ALL_TABLES`);
    }
    const strip = (s: string) => s.slice(s.indexOf('CREATE TABLE IF NOT EXISTS college_coverage_accounts'), s.indexOf('CREATE TABLE IF NOT EXISTS college_capacity_events') + 900).replace(/--[^\n]*\n/g, '').replace(/\s+/g, ' ');
    const schemaBlock = strip(schema).split(' CREATE TABLE IF NOT EXISTS mail_oauth_attempts')[0];
    const migBlock = strip(mig).split(' CREATE OR REPLACE FUNCTION')[0];
    assert.equal(schemaBlock.trim(), migBlock.trim(), 'dev schema and migration table definitions differ');
  });
  it('coverage enforcement stays gated in the request flow', () => {
    const src = read('lib/db/requests.ts');
    assert.match(src, /requireCollegeCoverage\(/);
    const db = read('lib/db/college-coverage.ts');
    assert.match(db, /if \(!beta && !selfService && !collegeCoverageEnforced\(env\)\) return null;/);
    assert.match(db, /JOIN beta_access_invites b ON o\.idempotency_key='beta:'\|\|b\.id/);
    assert.match(db, /const result = await reserveCollegeCoverage\(input, beta \|\| selfService\)/);
  });
});
