import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Fictional SQLite households and test-mode configuration. No provider calls.
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'addon-ui-')), 'test.sqlite3');
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL = 'fixture-owner@example.com';
Object.assign(process.env, {
  PAYMENTS_TEST_MODE_ENABLED: '1', PAYMENTS_DEPLOYMENT_ENV: 'staging', VERCEL_ENV: 'preview',
  STRIPE_REVIEW_ENABLED: '1', STRIPE_EXPECT_LIVEMODE: '0', STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_ID: 'price_base', STRIPE_EXPECTED_AMOUNT_CENTS: '19900',
  APP_ORIGIN: 'https://staging.example.com', STRIPE_ADDON_PRICE_ID: 'price_addon', STRIPE_ADDON_UNIT_AMOUNT_CENTS: '1900',
  COLLEGE_COVERAGE_ENFORCEMENT: '1',
});
const cycle = 'Fall 2027';
let A: typeof import('../lib/db/accounts');
let C: typeof import('../lib/db/client');
let K: typeof import('../lib/db/college-coverage');
let O: typeof import('../lib/db/college-addon-offer');
let Q: typeof import('../lib/db/requests');
let seq = 0;

async function household(paid = true) {
  const id = ++seq;
  const ctx = await A.provisionAccount({ authUserId: `addon-ui-user-${id}`, email: `addon-ui-${id}@example.com` });
  await A.completeOnboarding(ctx, { studentName: 'Student', role: 'parent', enteringTerm: cycle });
  const h = ctx.household.id;
  const now = new Date().toISOString();
  await C.exec("INSERT INTO cycle_orders(id,household_id,cycle,kind,price_id,amount_cents,status,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [`order-ui-${id}`, h, cycle, paid ? 'paid' : 'complimentary', paid ? 'price_base' : null, paid ? 19900 : 0, paid ? 'paid' : 'complimentary', `ui-order-${id}`, now, now]);
  await C.exec("INSERT INTO cycle_entitlements(id,household_id,cycle,order_id,kind,starts_at,expires_at,authorized_by) VALUES($1,$2,$3,$4,$5,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','test')",
    [`ent-ui-${id}`, h, cycle, `order-ui-${id}`, paid ? 'paid' : 'complimentary']);
  for (let n = 0; n < 10; n++) assert.equal((await K.reserveCollegeCoverage({ householdId: h, cycle, collegeId: String(810000 + n) })).status, 'covered');
  return { householdId: h, authUserId: `addon-ui-user-${id}`, isOwner: true, isDemo: false, cycle, unitid: '810010' };
}

before(async () => {
  A = await import('../lib/db/accounts'); C = await import('../lib/db/client');
  K = await import('../lib/db/college-coverage'); O = await import('../lib/db/college-addon-offer');
  Q = await import('../lib/db/requests');
  for (let n = 0; n <= 11; n++) await Q.upsertDirectorySchool({ unitid: String(810000 + n), name: `Fictional College ${n}` });
});

describe('owner-only blocked-request add-on offer', () => {
  it('quotes only a net-new blocked school from server state; pending grants nothing and is reusable', async () => {
    const h = await household();
    assert.equal(O.addonUiReady(), true);
    assert.deepEqual(await O.getCollegeAddonOffer(h), { ownerRequired: false, schoolName: 'Fictional College 10', unitid: '810010', cycle, units: 1, amountCents: 1900, pending: false });
    assert.equal(await O.getCollegeAddonOffer({ ...h, unitid: '810001' }), null, 'already covered never produces offer');
    assert.equal(await O.getCollegeAddonOffer({ ...h, unitid: '999999' }), null, 'unknown directory school');
    assert.equal(await O.getCollegeAddonOffer({ ...h, cycle: 'Winter 2028' }), null);
    const p = await K.createPendingAddonPurchase({ householdId: h.householdId, authUserId: h.authUserId, cycle,
      desiredCollegeIds: [h.unitid], idempotencyKey: 'ui-pending-key-1' });
    assert.equal((await O.getCollegeAddonOffer(h) as { pending: boolean }).pending, true);
    assert.equal(await O.getAddonReturnStatus(h.householdId, p.id), 'pending');
    assert.deepEqual((await K.getCollegeCoverageSummary(h.householdId, cycle)).remainingUnits, 0);
    assert.equal((await K.reserveCollegeCoverage({ householdId: h.householdId, cycle, collegeId: h.unitid })).status, 'blocked');
    const other = await household();
    assert.equal(await O.getAddonReturnStatus(other.householdId, p.id), null, 'another household cannot inspect checkout');
  });
  it('refuses non-owners, demos, complimentary/revoked access, refund holds and monthly-limit nonrequestable schools', async () => {
    const h = await household();
    assert.deepEqual(await O.getCollegeAddonOffer({ ...h, isOwner: false }), { ownerRequired: true });
    assert.deepEqual(await O.getCollegeAddonOffer({ ...h, authUserId: 'impostor' }), { ownerRequired: true });
    assert.equal(await O.getCollegeAddonOffer({ ...h, isDemo: true }), null);
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = h.householdId;
    try { assert.equal(await O.getCollegeAddonOffer(h), null, 'template refused even if caller mislabels it'); }
    finally { delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID; }
    const complimentary = await household(false);
    assert.equal(await O.getCollegeAddonOffer(complimentary), null);
    await C.exec("UPDATE cycle_entitlements SET revoked_at='2026-01-01T00:00:00.000Z' WHERE household_id=$1", [h.householdId]);
    assert.equal(await O.getCollegeAddonOffer(h), null);
    const held = await household();
    await C.exec('UPDATE college_coverage_accounts SET addon_hold=1 WHERE household_id=$1', [held.householdId]);
    assert.equal(await O.getCollegeAddonOffer(held), null);
    const monthly = await household();
    for (let n = 0; n < 3; n++) await Q.createSchoolRequest({ householdId: monthly.householdId, term: cycle, unitid: String(810000 + n) });
    assert.equal(await O.getCollegeAddonOffer(monthly), null, 'buying a unit cannot bypass monthly request cap');
  });
  it('fails closed on incomplete configuration and never grants from return status', async () => {
    const h = await household();
    const old = process.env.STRIPE_ADDON_PRICE_ID;
    try {
      delete process.env.STRIPE_ADDON_PRICE_ID;
      assert.equal(O.addonUiReady(), false);
      assert.equal(await O.getCollegeAddonOffer(h), null);
      assert.equal(await O.getAddonReturnStatus(h.householdId, 'addon_fixture'), null);
    } finally { process.env.STRIPE_ADDON_PRICE_ID = old; }
    const enabled = process.env.COLLEGE_COVERAGE_ENFORCEMENT;
    try { process.env.COLLEGE_COVERAGE_ENFORCEMENT = '0'; assert.equal(O.addonUiReady(), false); }
    finally { process.env.COLLEGE_COVERAGE_ENFORCEMENT = enabled; }
  });
  it('wires explicit POST and safe return URLs, not a provider call during page render', () => {
    const action = readFileSync(path.join(process.cwd(), 'app/request/actions.ts'), 'utf8');
    const page = readFileSync(path.join(process.cwd(), 'app/request/page.tsx'), 'utf8');
    const stripe = readFileSync(path.join(process.cwd(), 'lib/db/stripe-college-addon.ts'), 'utf8');
    assert.match(action, /error\.reason === "capacity_exhausted" && addonUiReady\(\)/);
    assert.match(action, /export async function startCollegeAddon\(formData: FormData\)/);
    assert.match(action, /getCollegeAddonOffer\(/);
    assert.match(action, /createPendingAddonPurchase\(/);
    assert.match(action, /createAddonCheckout\(/);
    assert.match(page, /<form action=\{startCollegeAddon\}/);
    assert.doesNotMatch(page, /createAddonCheckout\(/);
    assert.match(stripe, /success_url: `\$\{origin\}\/request\?addon_checkout=return&purchase=/);
    assert.match(stripe, /cancel_url: `\$\{origin\}\/request\?addon_checkout=canceled&purchase=/);
  });
});
