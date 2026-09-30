/** Pure, provider-independent domain rules for durable household/cycle college coverage.
 *
 * Review-only and test-mode only. Nothing here calls a database or a payment provider.
 *
 * Model
 * - Coverage is keyed by (household, application cycle, canonical college id). Students are
 *   NOT part of the key: two students in one household sharing a college consume one unit.
 * - A household-cycle has INCLUDED_UNIQUE_COLLEGES units plus purchased add-on units ($19 each).
 * - Coverage is append-only. Removing/withdrawing a college never restores a unit.
 * - Purchased capacity is granted only by `provisionVerifiedCollegeAddon` (db layer) from a
 *   `VerifiedAddonPayment` that can only be produced by `verifyAddonCheckoutEvent` below.
 *   A pending purchase or a browser redirect never grants anything.
 * - Refunds fail safe: they freeze *new* use of purchased capacity for explicit review and never
 *   remove already-covered colleges or already-granted capacity (see REFUND_COVERAGE_POLICY).
 */
import { ADDITIONAL_UNIQUE_COLLEGE_CENTS, INCLUDED_UNIQUE_COLLEGES, PAYMENT_CURRENCY } from './contract';
import { paymentTestModeConfigured } from './test-mode';

export const COVERAGE_CYCLE_PATTERN = /^Fall 20\d\d$/;
export const CANONICAL_COLLEGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const MAX_ADDON_UNITS_PER_PURCHASE = 50;

export function isCoverageCycle(value: unknown): value is string {
  return typeof value === 'string' && COVERAGE_CYCLE_PATTERN.test(value);
}
export function isCanonicalCollegeId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_COLLEGE_ID_PATTERN.test(value);
}

/** Enforcement is opt-in and staging/test-only. In any other environment it is off, so the
 * existing (free beta) request flow is unchanged and no coverage table is touched. */
export function collegeCoverageEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env.COLLEGE_COVERAGE_ENFORCEMENT === '1'
    && env.PAYMENTS_TEST_MODE_ENABLED === '1'
    && env.PAYMENTS_DEPLOYMENT_ENV === 'staging'
    && env.VERCEL_ENV !== 'production';
}

/** Add-on purchase/provisioning additionally needs the full fail-closed test-mode switch plus a
 * server-side add-on price object that is exactly one $19 unit. */
export function addonTestModeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return paymentTestModeConfigured(env)
    && /^price_[A-Za-z0-9]+$/.test(env.STRIPE_ADDON_PRICE_ID ?? '')
    && env.STRIPE_ADDON_PRICE_ID !== env.STRIPE_PRICE_ID
    && env.STRIPE_ADDON_UNIT_AMOUNT_CENTS === String(ADDITIONAL_UNIQUE_COLLEGE_CENTS);
}

export type CoverageAccount = Readonly<{
  includedUnits: number;
  purchasedUnits: number;
  coveredUnits: number;
  /** Set by an add-on refund; freezes NEW use of purchased capacity until explicit review. */
  addonHold: boolean;
}>;

export type BlockReason =
  | 'invalid_college'
  | 'invalid_cycle'
  | 'ineligible_household'
  | 'no_active_entitlement'
  | 'capacity_exhausted'
  | 'addon_refund_review';

export type ReservationDecision =
  | { outcome: 'already_covered'; consumesUnit: false }
  | { outcome: 'consume_included'; consumesUnit: true }
  | { outcome: 'consume_addon'; consumesUnit: true }
  | { outcome: 'blocked'; consumesUnit: false; reason: BlockReason };

export const capacityOf = (a: CoverageAccount): number => a.includedUnits + a.purchasedUnits;
export const remainingUnits = (a: CoverageAccount): number => Math.max(0, capacityOf(a) - a.coveredUnits);

/** Pure decision. `alreadyCovered` must come from the durable coverage set, never from active
 * tracking rows. The db layer re-asserts the same limit in one conditional UPDATE, so a stale
 * decision can never over-grant. */
export function decideReservation(input: { account: CoverageAccount; alreadyCovered: boolean; entitlementActive: boolean }): ReservationDecision {
  const { account, alreadyCovered, entitlementActive } = input;
  if (alreadyCovered) return { outcome: 'already_covered', consumesUnit: false };
  if (!entitlementActive) return { outcome: 'blocked', consumesUnit: false, reason: 'no_active_entitlement' };
  if (account.coveredUnits < account.includedUnits) return { outcome: 'consume_included', consumesUnit: true };
  if (account.addonHold) return { outcome: 'blocked', consumesUnit: false, reason: 'addon_refund_review' };
  if (account.coveredUnits < capacityOf(account)) return { outcome: 'consume_addon', consumesUnit: true };
  return { outcome: 'blocked', consumesUnit: false, reason: 'capacity_exhausted' };
}

export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case 'capacity_exhausted': return `Your household's ${INCLUDED_UNIQUE_COLLEGES} included colleges (plus any verified add-ons) are in use for this cycle. Colleges already covered stay covered; a new college needs a verified add-on.`;
    case 'addon_refund_review': return 'Additional college capacity is paused while a refund is reviewed. Colleges already covered stay covered.';
    case 'no_active_entitlement': return 'This household does not have active access for this admissions cycle.';
    case 'ineligible_household': return 'This household is not eligible for college coverage.';
    case 'invalid_cycle': return 'Choose a valid admissions cycle.';
    default: return 'Choose a valid college.';
  }
}

export type AddonQuote = Readonly<{ unitsToBuy: number; amountCents: number; uncoveredCollegeIds: readonly string[]; slack: number }>;

/** Units to buy so all `desiredIds` could be covered. Slack (already-purchased-but-unused capacity
 * plus unused included capacity) is used first. Amount is server-computed; never client-supplied. */
export function quoteAddonUnits(account: CoverageAccount, coveredIds: readonly string[], desiredIds: readonly string[]): AddonQuote {
  for (const id of [...coveredIds, ...desiredIds]) if (!isCanonicalCollegeId(id)) throw new Error('Canonical college IDs required');
  const covered = new Set(coveredIds);
  const uncoveredCollegeIds = [...new Set(desiredIds)].filter(id => !covered.has(id)).sort();
  const slack = remainingUnits(account);
  const unitsToBuy = Math.max(0, uncoveredCollegeIds.length - slack);
  if (unitsToBuy > MAX_ADDON_UNITS_PER_PURCHASE) throw new Error('Add-on quantity exceeds the per-purchase limit');
  return Object.freeze({ unitsToBuy, amountCents: unitsToBuy * ADDITIONAL_UNIQUE_COLLEGE_CENTS, uncoveredCollegeIds: Object.freeze(uncoveredCollegeIds), slack });
}

// ---------------------------------------------------------------------------------------------
// Verified add-on payment evidence
// ---------------------------------------------------------------------------------------------
export type AddonPurchaseRecord = Readonly<{
  id: string; householdId: string | null; cycle: string; units: number; amountCents: number;
  priceId: string; status: 'pending' | 'provisioned' | 'refund_review' | 'exception';
  providerSessionId: string | null; providerPaymentId: string | null;
}>;

declare const verifiedBrand: unique symbol;
export type VerifiedAddonPayment = Readonly<{
  eventId: string; eventType: string; sessionId: string; paymentIntentId: string;
  purchaseId: string; householdId: string; cycle: string; units: number; amountCents: number; priceId: string;
}> & { readonly [verifiedBrand]: true };

// Runtime unforgeability: only objects issued by verifyAddonCheckoutEvent are members.
const issued = new WeakSet<object>();
export function isVerifiedAddonPayment(value: unknown): value is VerifiedAddonPayment {
  return typeof value === 'object' && value !== null && issued.has(value);
}

export type AddonVerification = { ok: true; evidence: VerifiedAddonPayment } | { ok: false; code: string };

const SUCCESS_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];

/** `event` must already be the output of the signature/timestamp-verifying webhook parser. This
 * function then checks the business facts against the server-side purchase record. It cannot be
 * satisfied by a redirect, a pending row, or client-supplied amounts. */
export function verifyAddonCheckoutEvent(event: any, purchase: AddonPurchaseRecord | null, env: Record<string, string | undefined> = process.env): AddonVerification {
  const fail = (code: string): AddonVerification => ({ ok: false, code });
  if (!addonTestModeConfigured(env)) return fail('addon_disabled');
  if (!event || typeof event.id !== 'string' || !/^evt_\w+$/.test(event.id) || !SUCCESS_EVENTS.includes(event.type)) return fail('not_success_event');
  if (event.livemode !== false) return fail('live_event_refused');
  const obj = event.data?.object;
  if (!obj || typeof obj !== 'object') return fail('malformed_event');
  if (!purchase) return fail('unknown_purchase');
  if (!purchase.householdId) return fail('household_missing');
  if (purchase.status !== 'pending' && purchase.status !== 'provisioned') return fail('purchase_state_conflict');
  const md = obj.metadata ?? {};
  if (md.addon_purchase_id !== purchase.id || md.household_id !== purchase.householdId || md.cycle !== purchase.cycle) return fail('metadata_mismatch');
  if (purchase.priceId !== env.STRIPE_ADDON_PRICE_ID) return fail('price_mismatch');
  if (!Number.isSafeInteger(purchase.units) || purchase.units < 1 || purchase.units > MAX_ADDON_UNITS_PER_PURCHASE) return fail('units_invalid');
  if (purchase.amountCents !== purchase.units * ADDITIONAL_UNIQUE_COLLEGE_CENTS) return fail('amount_invalid');
  if (obj.mode !== 'payment' || obj.livemode !== false || obj.payment_status !== 'paid' || obj.currency !== PAYMENT_CURRENCY) return fail('payment_not_verified');
  if (obj.amount_total !== purchase.amountCents) return fail('amount_mismatch');
  if (typeof obj.id !== 'string' || !obj.id.startsWith('cs_') || (purchase.providerSessionId && purchase.providerSessionId !== obj.id)) return fail('session_mismatch');
  if (typeof obj.payment_intent !== 'string' || !/^pi_\w+$/.test(obj.payment_intent)) return fail('payment_intent_missing');
  const evidence = Object.freeze({
    eventId: event.id, eventType: event.type as string, sessionId: obj.id as string, paymentIntentId: obj.payment_intent as string,
    purchaseId: purchase.id, householdId: purchase.householdId, cycle: purchase.cycle, units: purchase.units,
    amountCents: purchase.amountCents, priceId: purchase.priceId,
  }) as unknown as VerifiedAddonPayment;
  issued.add(evidence);
  return { ok: true, evidence };
}

// ---------------------------------------------------------------------------------------------
// Refund policy (fail safe)
// ---------------------------------------------------------------------------------------------
/** Explicit, reviewable statement of what a refund may and may not do automatically. Changing any
 * `false` below requires a separately reviewed policy decision and migration. */
export const REFUND_COVERAGE_POLICY = Object.freeze({
  revokeStartedResearch: false,
  removeCoveredColleges: false,
  reduceGrantedCapacity: false,
  freezeNewPurchasedCapacityUse: true,
  requiresExplicitOwnerReview: true,
});

export type RefundDecision =
  | { action: 'hold_for_review'; refundedCents: number }
  | { action: 'no_change' }
  | { action: 'exception'; code: string };

/** `eventRefundedCents` is Stripe's cumulative amount_refunded for the charge. */
export function decideAddonRefund(input: { purchase: Pick<AddonPurchaseRecord, 'status' | 'amountCents'> & { refundedCents: number } | null; eventRefundedCents: unknown; currency: unknown }): RefundDecision {
  const { purchase, eventRefundedCents: cents, currency } = input;
  if (!purchase) return { action: 'exception', code: 'unknown_payment' };
  if (currency !== PAYMENT_CURRENCY) return { action: 'exception', code: 'refund_currency_mismatch' };
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 0 || cents > purchase.amountCents) return { action: 'exception', code: 'refund_amount_invalid' };
  if (purchase.status !== 'provisioned' && purchase.status !== 'refund_review') return { action: 'exception', code: 'refund_state_conflict' };
  if (cents < purchase.refundedCents) return { action: 'exception', code: 'refund_regression' };
  // Same cumulative amount = replay of an already-recorded (and possibly already-reviewed) refund.
  if (cents === purchase.refundedCents) return { action: 'no_change' };
  return { action: 'hold_for_review', refundedCents: cents };
}

