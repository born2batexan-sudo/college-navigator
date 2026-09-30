// Disabled-by-default Stripe test-mode boundary for $19 college add-ons.
// A pending purchase is not access: only the signed webhook path below can provision it.
import { addonTestModeConfigured, verifyAddonCheckoutEvent } from '@/lib/payments/college-coverage';
import { ADDITIONAL_UNIQUE_COLLEGE_CENTS } from '@/lib/payments/contract';
import { exec, nowIso, queryOne, withTransaction } from './client';
import {
  getAddonPurchase,
  provisionVerifiedCollegeAddon,
  recordAddonRefundForReview,
  type ProvisionResult,
  type RefundResult,
} from './college-coverage';
import { verifyStripeEvent } from './stripe-review';

const checkoutHost = 'checkout.stripe.com';
const purchaseIdPattern = /^addon_[A-Za-z0-9]+$/;

type Env = Record<string, string | undefined>;

/** Add-on Checkout is enabled only with the complete, staging/test-only payment configuration. */
export function addonStripeReady(env: Env = process.env): boolean {
  return addonTestModeConfigured(env);
}

function siteOrigin(env: Env): string {
  // addonTestModeConfigured validates this exact origin shape. Keep the parser here
  // defensive so this boundary cannot accidentally construct an off-site redirect.
  const raw = env.APP_ORIGIN;
  if (!raw) throw new Error('Checkout origin is not configured');
  const origin = new URL(raw);
  if (origin.origin !== raw || !['https:', 'http:'].includes(origin.protocol)
    || (origin.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw new Error('Invalid checkout origin');
  }
  return origin.origin;
}

function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === checkoutHost;
  } catch {
    return false;
  }
}

function validProviderSession(value: unknown): value is { id: string; url: string } {
  return !!value && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && /^cs_\w+$/.test((value as { id: string }).id)
    && validCheckoutUrl((value as { url?: unknown }).url);
}

/**
 * Creates (or retrieves through Stripe's idempotency key) a hosted add-on Checkout
 * session. The purchase row is created by createPendingAddonPurchase; this function
 * never computes a quantity from the browser and never grants capacity.
 */
export async function createAddonCheckout(input: {
  purchaseId: string;
  householdId: string;
  authUserId: string;
}, env: Env = process.env): Promise<string> {
  if (!addonStripeReady(env)) throw new Error('Add-on checkout is not enabled');
  if (!purchaseIdPattern.test(input.purchaseId) || !input.householdId || !input.authUserId) {
    throw new Error('Invalid add-on checkout request');
  }

  const purchase = await getAddonPurchase(input.purchaseId);
  if (!purchase || purchase.householdId !== input.householdId || purchase.status !== 'pending') {
    throw new Error('Pending add-on purchase required');
  }
  if (!Number.isSafeInteger(purchase.units) || purchase.units < 1
    || purchase.amountCents !== purchase.units * ADDITIONAL_UNIQUE_COLLEGE_CENTS
    || purchase.priceId !== env.STRIPE_ADDON_PRICE_ID) {
    throw new Error('Add-on purchase configuration mismatch');
  }
  const owner = await queryOne(
    'SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2 AND role=$3',
    [input.householdId, input.authUserId, 'owner'],
  );
  if (!owner) throw new Error('Household owner required');
  const now = new Date().toISOString();
  if (!await queryOne(
    "SELECT 1 AS ok FROM cycle_entitlements WHERE household_id=$1 AND cycle=$2 AND kind='paid' AND revoked_at IS NULL AND starts_at<=$3 AND expires_at>$4",
    [input.householdId, purchase.cycle, now, now],
  )) throw new Error('Active paid access required for add-on checkout');
  if (await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1', [input.householdId])
    || input.householdId === env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim()) {
    throw new Error('Eligible household required');
  }

  const origin = siteOrigin(env);
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': purchase.priceId,
    'line_items[0][quantity]': String(purchase.units),
    success_url: `${origin}/account?addon_checkout=return`,
    cancel_url: `${origin}/account?addon_checkout=canceled`,
    'metadata[addon_purchase_id]': purchase.id,
    'metadata[household_id]': purchase.householdId,
    'metadata[cycle]': purchase.cycle,
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // The purchase ID is durable and unique. Stripe returns the original hosted
      // session for retries with this key instead of creating another chargeable session.
      'Idempotency-Key': `campuspassage-addon-${purchase.id}`,
    },
    body: form,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Checkout provider unavailable');

  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('Invalid checkout provider response'); }
  if (!validProviderSession(data)) throw new Error('Invalid checkout provider session');
  if (purchase.providerSessionId && purchase.providerSessionId !== data.id) {
    throw new Error('Checkout provider session conflict');
  }

  await withTransaction(async () => {
    await exec(
      `UPDATE college_addon_purchases SET provider_session_id=$1,updated_at=$2
       WHERE id=$3 AND status='pending' AND (provider_session_id IS NULL OR provider_session_id=$4)`,
      [data.id, nowIso(), purchase.id, data.id],
    );
    const saved = await queryOne<any>('SELECT provider_session_id,status FROM college_addon_purchases WHERE id=$1', [purchase.id]);
    if (!saved || saved.status !== 'pending' || saved.provider_session_id !== data.id) {
      throw new Error('Add-on purchase changed during checkout');
    }
  });
  return data.url;
}

export type AddonWebhookResult =
  | 'addon_provisioned'
  | 'addon_already_provisioned'
  | 'refund_review_recorded'
  | 'refund_already_recorded'
  | 'ignored'
  | 'exception';

/**
 * Verifies a raw, timestamped Stripe signature before interpreting the event. The
 * business checks then bind the event to the server-side pending purchase. Signed
 * mismatches are returned as an exception (rather than retried forever); malformed
 * or unsigned requests throw and the route responds 400.
 */
export async function reconcileAddonStripeWebhook(raw: string, signature: string, env: Env = process.env): Promise<AddonWebhookResult> {
  if (!addonStripeReady(env)) throw new Error('Add-on Stripe integration is disabled');
  const event = verifyStripeEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET!);
  if (event.livemode !== false) return 'exception';

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const purchaseId = event.data?.object?.metadata?.addon_purchase_id;
    const purchase = typeof purchaseId === 'string' ? await getAddonPurchase(purchaseId) : null;
    const verified = verifyAddonCheckoutEvent(event, purchase, env);
    if (!verified.ok) {
      // Keep the result intentionally small: the provider receives an accepted
      // response for a signed event, while the purchase remains unprovisioned.
      return 'exception';
    }
    const result: ProvisionResult = await provisionVerifiedCollegeAddon(verified.evidence, env);
    if (result.status === 'provisioned') return 'addon_provisioned';
    if (result.status === 'already_provisioned') return 'addon_already_provisioned';
    return 'exception';
  }

  if (event.type === 'charge.refunded') {
    const obj = event.data?.object ?? {};
    const result: RefundResult = await recordAddonRefundForReview({
      paymentIntentId: obj.payment_intent,
      refundedCents: obj.amount_refunded,
      currency: obj.currency,
      eventId: event.id,
    }, env);
    if (result.status === 'held_for_review') return 'refund_review_recorded';
    if (result.status === 'no_change') return 'refund_already_recorded';
    return 'exception';
  }
  return 'ignored';
}

// Explicit aliases make the boundary discoverable without duplicating any provider logic.
export const createCollegeAddonCheckout = createAddonCheckout;
export const reconcileCollegeAddonWebhook = reconcileAddonStripeWebhook;
