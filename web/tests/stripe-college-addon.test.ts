import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'college-addon-stripe-')), 'addon.sqlite3');
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL = 'owner@example.com';
process.env.REQUEST_ACCESS_HASH_SECRET = 'local-test-secret';
process.env.ACCESS_CYCLE = 'Fall 2027';
const STAGING: Record<string, string> = {
  PAYMENTS_TEST_MODE_ENABLED: '1', PAYMENTS_DEPLOYMENT_ENV: 'staging', VERCEL_ENV: 'preview',
  STRIPE_REVIEW_ENABLED: '1', STRIPE_EXPECT_LIVEMODE: '0', STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_ID: 'price_base', STRIPE_EXPECTED_AMOUNT_CENTS: '19900',
  APP_ORIGIN: 'https://staging.example.com', STRIPE_ADDON_PRICE_ID: 'price_addon', STRIPE_ADDON_UNIT_AMOUNT_CENTS: '1900',
};
Object.assign(process.env, STAGING);

let A: typeof import('../lib/db/accounts');
let C: typeof import('../lib/db/client');
let K: typeof import('../lib/db/college-coverage');
let S: typeof import('../lib/db/stripe-college-addon');
let household: { id: string; authUserId: string };
let purchase: Awaited<ReturnType<typeof K.createPendingAddonPurchase>>;
const secret = STAGING.STRIPE_WEBHOOK_SECRET;

function signed(event: unknown): [string, string] {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return [raw, `t=${timestamp},v1=${digest}`];
}
function checkoutEvent(overrides: Record<string, unknown> = {}, object: Record<string, unknown> = {}) {
  return {
    id: 'evt_addon_success', type: 'checkout.session.completed', livemode: false,
    data: { object: {
      id: 'cs_addon_1', mode: 'payment', livemode: false, payment_status: 'paid', currency: 'usd',
      amount_total: 1900, payment_intent: 'pi_addon_1',
      metadata: { addon_purchase_id: purchase.id, household_id: household.id, cycle: 'Fall 2027' },
      ...object,
    } }, ...overrides,
  };
}

before(async () => {
  A = await import('../lib/db/accounts');
  C = await import('../lib/db/client');
  K = await import('../lib/db/college-coverage');
  S = await import('../lib/db/stripe-college-addon');
  const ctx = await A.provisionAccount({ authUserId: 'addon-family-auth', email: 'family@example.com' });
  await A.completeOnboarding(ctx, { studentName: 'Student', role: 'parent', enteringTerm: 'Fall 2027' });
  household = { id: ctx.household.id, authUserId: 'addon-family-auth' };
  const now = new Date().toISOString();
  await C.exec("INSERT INTO cycle_orders(id,household_id,cycle,kind,price_id,amount_cents,status,idempotency_key,created_at,updated_at) VALUES('addon-base-order',$1,'Fall 2027','paid','price_base',19900,'paid','addon-base-order',$2,$3)", [household.id, now, now]);
  await C.exec("INSERT INTO cycle_entitlements(id,household_id,cycle,order_id,kind,starts_at,expires_at,authorized_by) VALUES('addon-base-entitlement',$1,'Fall 2027','addon-base-order','paid','2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','test')", [household.id]);
  // Fill included capacity so one desired new college requires exactly one $19 unit.
  for (let i = 0; i < 10; i++) await K.reserveCollegeCoverage({ householdId: household.id, cycle: 'Fall 2027', collegeId: `included${i}` });
  purchase = await K.createPendingAddonPurchase({
    householdId: household.id, authUserId: household.authUserId, cycle: 'Fall 2027',
    desiredCollegeIds: ['new-college'], idempotencyKey: 'addon-checkout-key',
  });
});

describe('staging-only Stripe college add-on checkout boundary', () => {
  it('uses a server-computed quantity and price, validates hosted URL, and reuses provider idempotency', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({ id: 'cs_addon_1', url: 'https://checkout.stripe.com/c/pay/addon' });
    }) as typeof fetch;
    try {
      assert.equal(await S.createAddonCheckout({ purchaseId: purchase.id, householdId: household.id, authUserId: household.authUserId }), 'https://checkout.stripe.com/c/pay/addon');
      // A retry calls Stripe with the same provider idempotency key; Stripe returns the same session.
      assert.equal(await S.createAddonCheckout({ purchaseId: purchase.id, householdId: household.id, authUserId: household.authUserId }), 'https://checkout.stripe.com/c/pay/addon');
    } finally { globalThis.fetch = originalFetch; }
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal((calls[0].init.headers as Record<string, string>)['Idempotency-Key'], `campuspassage-addon-${purchase.id}`);
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer sk_test_fixture');
    const body = new URLSearchParams(String(calls[0].init.body));
    assert.equal(body.get('line_items[0][price]'), 'price_addon');
    assert.equal(body.get('line_items[0][quantity]'), '1');
    assert.equal(body.get('metadata[addon_purchase_id]'), purchase.id);
    assert.equal(body.get('metadata[household_id]'), household.id);
    assert.equal(body.get('metadata[cycle]'), 'Fall 2027');
    assert.equal(body.get('success_url'), `https://staging.example.com/request?addon_checkout=return&purchase=${purchase.id}`);
    assert.equal(body.get('cancel_url'), `https://staging.example.com/request?addon_checkout=canceled&purchase=${purchase.id}`);
    assert.equal((await K.getAddonPurchase(purchase.id))?.providerSessionId, 'cs_addon_1');
  });

  it('requires signed events, provisions only matching success events, is replay-safe, and holds refunds for review', async () => {
    const [raw, signature] = signed(checkoutEvent());
    await assert.rejects(() => S.reconcileAddonStripeWebhook(raw, 't=1,v1=bad'), /Webhook timestamp|signature invalid/);
    assert.equal(await S.reconcileAddonStripeWebhook(raw, signature), 'addon_provisioned');
    assert.equal((await K.getCollegeCoverageSummary(household.id, 'Fall 2027')).purchasedUnits, 1);
    assert.equal(await S.reconcileAddonStripeWebhook(raw, signature), 'addon_already_provisioned');
    assert.equal((await K.getCollegeCoverageSummary(household.id, 'Fall 2027')).purchasedUnits, 1);

    const [badRaw, badSignature] = signed(checkoutEvent({ id: 'evt_addon_bad' }, { amount_total: 3800 }));
    assert.equal(await S.reconcileAddonStripeWebhook(badRaw, badSignature), 'exception');
    assert.equal((await K.getCollegeCoverageSummary(household.id, 'Fall 2027')).purchasedUnits, 1);

    const refund = { id: 'evt_addon_refund', type: 'charge.refunded', livemode: false, data: { object: {
      payment_intent: 'pi_addon_1', amount_refunded: 1900, currency: 'usd',
    } } };
    const [refundRaw, refundSignature] = signed(refund);
    assert.equal(await S.reconcileAddonStripeWebhook(refundRaw, refundSignature), 'refund_review_recorded');
    assert.equal((await K.getCollegeCoverageSummary(household.id, 'Fall 2027')).addonHold, true);
    assert.equal(await S.reconcileAddonStripeWebhook(refundRaw, refundSignature), 'refund_already_recorded');
    assert.equal((await K.getCollegeCoverageSummary(household.id, 'Fall 2027')).purchasedUnits, 1);
  });

  it('stays disabled unless the full staging test configuration is present', async () => {
    assert.equal(S.addonStripeReady(STAGING), true);
    assert.equal(S.addonStripeReady({ ...STAGING, STRIPE_SECRET_KEY: 'sk_live_bad' }), false);
    assert.equal(S.addonStripeReady({ ...STAGING, STRIPE_ADDON_PRICE_ID: STAGING.STRIPE_PRICE_ID }), false);
    assert.equal(S.addonStripeReady({ ...STAGING, PAYMENTS_DEPLOYMENT_ENV: 'production' }), false);
    await assert.rejects(() => S.createAddonCheckout({ purchaseId: purchase.id, householdId: household.id, authUserId: household.authUserId }, { ...STAGING, STRIPE_ADDON_UNIT_AMOUNT_CENTS: '2000' }), /not enabled/);
  });
});
