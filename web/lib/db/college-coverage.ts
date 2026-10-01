// Review-only, test-mode-only durable college coverage. Portable SQL (Postgres + local SQLite).
// Deliberately imports only ./client and ../payments/* so requests.ts can use it without an
// import cycle (accounts -> requests). No provider/network calls anywhere in this file.
import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from './client';
import { ADDITIONAL_UNIQUE_COLLEGE_CENTS, INCLUDED_UNIQUE_COLLEGES } from '../payments/contract';
import {
  addonTestModeConfigured, blockMessage, collegeCoverageEnforced, decideAddonRefund, decideReservation,
  isCanonicalCollegeId, isCoverageCycle, isVerifiedAddonPayment, quoteAddonUnits,
  type BlockReason, type CoverageAccount, type VerifiedAddonPayment,
} from '../payments/college-coverage';
import { isAdministratorEmail } from '../auth/admin';

type Env = Record<string, string | undefined>;
const lock = usingPostgres ? ' FOR UPDATE' : '';

export class CollegeCoverageBlockedError extends Error {
  constructor(readonly reason: BlockReason) { super(blockMessage(reason)); this.name = 'CollegeCoverageBlockedError'; }
}

export type ReserveResult =
  | { status: 'covered'; consumedUnit: boolean; source: 'existing' | 'included' | 'addon'; coveredUnits: number; remainingUnits: number }
  | { status: 'blocked'; reason: BlockReason };

const toAccount = (r: any): CoverageAccount => ({
  includedUnits: Number(r.included_units), purchasedUnits: Number(r.purchased_units),
  coveredUnits: Number(r.covered_units), addonHold: Number(r.addon_hold) === 1,
});

async function eligibleHousehold(householdId: string): Promise<boolean> {
  if (!householdId || !await queryOne('SELECT 1 AS ok FROM households WHERE id=$1', [householdId])) return false;
  if (householdId === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim()) return false;
  return !await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1', [householdId]);
}
async function activeEntitlement(householdId: string, cycle: string, paidOnly = false) {
  const now = nowIso();
  return queryOne<any>(`SELECT order_id,kind FROM cycle_entitlements WHERE household_id=$1 AND cycle=$2 AND revoked_at IS NULL AND starts_at<=$3 AND expires_at>$4${paidOnly ? " AND kind='paid'" : ''}`, [householdId, cycle, now, now]);
}
/** Creates the account row if needed and (Postgres) takes its row lock. Must be inside a transaction. */
async function lockedAccount(householdId: string, cycle: string): Promise<CoverageAccount> {
  const now = nowIso();
  if (usingPostgres) await exec('SELECT pg_advisory_xact_lock(hashtext($1))', [`college-coverage:${householdId}:${cycle}`]);
  await exec('INSERT INTO college_coverage_accounts(household_id,cycle,created_at,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(household_id,cycle) DO NOTHING', [householdId, cycle, now, now]);
  const row = await queryOne<any>(`SELECT * FROM college_coverage_accounts WHERE household_id=$1 AND cycle=$2${lock}`, [householdId, cycle]);
  if (!row) throw new Error('Coverage account unavailable');
  return toAccount(row);
}
/** Single conditional statement: the capacity limit is re-asserted here, atomically, so a stale
 * in-memory decision can never over-grant. Returns the new covered count, or null if no capacity.
 * Exported only so tests can prove the invariant; call it inside the reservation transaction. */
export async function claimCoverageUnit(householdId: string, cycle: string, includedOnly = false): Promise<number | null> {
  const row = await queryOne<any>(`UPDATE college_coverage_accounts SET covered_units=covered_units+1,updated_at=$1
    WHERE household_id=$2 AND cycle=$3 AND covered_units<included_units+purchased_units
    AND ($4=0 OR covered_units<included_units)
    AND (covered_units<included_units OR addon_hold=0) RETURNING covered_units`, [nowIso(), householdId, cycle, includedOnly ? 1 : 0]);
  return row ? Number(row.covered_units) : null;
}

/** Idempotent, race-safe reservation of one canonical college for a household-cycle.
 * - Already covered (including after the college was removed, or by another student): no new unit.
 * - New college: consumes exactly one unit, or is blocked. Never partially applied. */
export async function reserveCollegeCoverage(input: { householdId: string; cycle: string; collegeId: string; personId?: string | null }, includedOnly = false): Promise<ReserveResult> {
  if (!isCoverageCycle(input.cycle)) return { status: 'blocked', reason: 'invalid_cycle' };
  if (!isCanonicalCollegeId(input.collegeId)) return { status: 'blocked', reason: 'invalid_college' };
  return withTransaction(async (): Promise<ReserveResult> => {
    if (!await eligibleHousehold(input.householdId)) return { status: 'blocked', reason: 'ineligible_household' };
    // The staging migration enforces this membership with a foreign key. Keep the
    // local SQLite path fail-closed for real six-digit federal IDs as well; its
    // fictional short IDs remain available only to unit-test domain rules.
    if (/^\d{6}$/.test(input.collegeId)
      && !await queryOne('SELECT 1 AS ok FROM school_directory WHERE unitid=$1', [input.collegeId])) {
      return { status: 'blocked', reason: 'invalid_college' };
    }
    const account = await lockedAccount(input.householdId, input.cycle);
    // The beta invitation waives payment only; it never buys add-on capacity.
    const usableAccount = includedOnly ? { ...account, purchasedUnits: 0 } : account;
    const alreadyCovered = !!await queryOne('SELECT 1 AS ok FROM college_coverage_colleges WHERE household_id=$1 AND cycle=$2 AND college_id=$3', [input.householdId, input.cycle, input.collegeId]);
    const entitlementActive = alreadyCovered || !!await activeEntitlement(input.householdId, input.cycle) ||
      !!await queryOne('SELECT 1 AS ok FROM self_service_access WHERE household_id=$1 AND cycle=$2 AND revoked_at IS NULL AND starts_at<=$3 AND expires_at>$4', [input.householdId, input.cycle, nowIso(), nowIso()]);
    const decision = decideReservation({ account: usableAccount, alreadyCovered, entitlementActive });
    if (decision.outcome === 'blocked') return { status: 'blocked', reason: decision.reason };
    if (decision.outcome === 'already_covered') return { status: 'covered', consumedUnit: false, source: 'existing', coveredUnits: account.coveredUnits, remainingUnits: Math.max(0, usableAccount.includedUnits + usableAccount.purchasedUnits - account.coveredUnits) };
    const covered = await claimCoverageUnit(input.householdId, input.cycle, includedOnly);
    if (covered === null) return { status: 'blocked', reason: account.addonHold ? 'addon_refund_review' : 'capacity_exhausted' };
    const source = covered <= account.includedUnits ? 'included' : 'addon';
    await exec('INSERT INTO college_coverage_colleges(household_id,cycle,college_id,source,first_person_id,first_covered_at) VALUES($1,$2,$3,$4,$5,$6)', [input.householdId, input.cycle, input.collegeId, source, input.personId ?? null, nowIso()]);
    return { status: 'covered', consumedUnit: true, source, coveredUnits: covered, remainingUnits: Math.max(0, usableAccount.includedUnits + usableAccount.purchasedUnits - covered) };
  });
}

/** Beta's included ten colleges apply independently of the disabled payment experiment.
 * Only a completed, active, household-bound beta $0 order activates this path;
 * accepting a link alone cannot create research access or capacity. */
async function betaGrant(householdId: string) {
  return queryOne<{ cycle: string; revoked_at: string | null; starts_at: string; expires_at: string; request_status: string }>(
    `SELECT e.cycle,e.revoked_at,e.starts_at,e.expires_at,r.status AS request_status FROM cycle_entitlements e
      JOIN cycle_orders o ON o.id=e.order_id AND o.household_id=e.household_id
      JOIN beta_access_invites b ON o.idempotency_key='beta:'||b.id AND b.accepted_household_id=e.household_id
      JOIN demo_access_requests r ON r.id=b.request_id
      WHERE e.household_id=$1 AND e.kind='complimentary'
        AND o.kind='complimentary' AND o.status='complimentary' LIMIT 1`, [householdId]);
}

/** A beta grant is for its approved application cycle, never a new free cycle.
 * Revocation/expiry fails closed even if an authorized request races the owner action. */
export async function assertBetaAccessCycle(householdId: string, cycle: string): Promise<boolean> {
  const grant = await betaGrant(householdId);
  if (!grant) return false;
  if (cycle !== grant.cycle) throw new CollegeCoverageBlockedError('invalid_cycle');
  const now = nowIso();
  if (grant.revoked_at || grant.request_status !== 'approved' || grant.starts_at > now || grant.expires_at <= now)
    throw new CollegeCoverageBlockedError('no_active_entitlement');
  return true;
}

/** Reserve a trackable college in the same ledger as new research requests.
 * A reviewed one-to-one directory mapping is mandatory: never fall back to
 * an internal institution ID, which would count the same college twice.
 * No research is queued by tracking. Caller wraps this with relationship write. */
export async function requireBetaTrackedCollege(input: { householdId: string; cycle: string; institutionId: string }): Promise<void> {
  const selfService = await queryOne('SELECT 1 AS ok FROM self_service_access WHERE household_id=$1 AND revoked_at IS NULL AND starts_at<=$2 AND expires_at>$3', [input.householdId, nowIso(), nowIso()]);
  if (selfService) {
    if (!await queryOne('SELECT 1 AS ok FROM self_service_access WHERE household_id=$1 AND cycle=$2 AND revoked_at IS NULL', [input.householdId, input.cycle])) throw new CollegeCoverageBlockedError('invalid_cycle');
  } else if (!await assertBetaAccessCycle(input.householdId, input.cycle)) return;
  const directory = await queryRows<{ unitid: string }>('SELECT unitid FROM school_directory WHERE institution_id=$1 ORDER BY unitid LIMIT 2', [input.institutionId]);
  if (directory.length !== 1 || !/^\d{6}$/.test(directory[0].unitid)) throw new CollegeCoverageBlockedError('invalid_college');
  const result = await reserveCollegeCoverage({ householdId: input.householdId, cycle: input.cycle, collegeId: directory[0].unitid }, true);
  if (result.status === 'blocked') throw new CollegeCoverageBlockedError(result.reason);
}

/** Throws CollegeCoverageBlockedError when blocked. Paid coverage remains opt-in and
 * staging/test-only; an active founding-family beta always has only its ten included
 * colleges, even with Stripe and the payment experiment disabled. Call within the
 * request transaction so a later quota/validation failure rolls back the unit. */
export async function requireCollegeCoverage(input: { householdId: string; cycle: string; collegeId: string; personId?: string | null }, env: Env = process.env): Promise<ReserveResult | null> {
  const selfService = !!await queryOne('SELECT 1 AS ok FROM self_service_access WHERE household_id=$1 AND revoked_at IS NULL AND starts_at<=$2 AND expires_at>$3', [input.householdId, nowIso(), nowIso()]);
  if (selfService && !await queryOne('SELECT 1 AS ok FROM self_service_access WHERE household_id=$1 AND cycle=$2 AND revoked_at IS NULL', [input.householdId, input.cycle])) throw new CollegeCoverageBlockedError('invalid_cycle');
  const beta = selfService ? false : await assertBetaAccessCycle(input.householdId, input.cycle);
  if (!beta && !selfService && !collegeCoverageEnforced(env)) return null;
  const result = await reserveCollegeCoverage(input, beta || selfService);
  if (result.status === 'blocked') throw new CollegeCoverageBlockedError(result.reason);
  return result;
}

export type CoverageSummary = {
  cycle: string; includedUnits: number; purchasedUnits: number; coveredUnits: number; remainingUnits: number;
  addonHold: boolean; coveredCollegeIds: string[]; pendingAddonUnits: number;
};
/** Read-only; creates nothing. Pending purchases are reported but never counted as capacity. */
export async function getCollegeCoverageSummary(householdId: string, cycle: string): Promise<CoverageSummary> {
  if (!isCoverageCycle(cycle)) throw new Error('Valid cycle required');
  const acct = await queryOne<any>('SELECT * FROM college_coverage_accounts WHERE household_id=$1 AND cycle=$2', [householdId, cycle]);
  const a: CoverageAccount = acct ? toAccount(acct) : { includedUnits: INCLUDED_UNIQUE_COLLEGES, purchasedUnits: 0, coveredUnits: 0, addonHold: false };
  const ids = await queryRows<any>('SELECT college_id FROM college_coverage_colleges WHERE household_id=$1 AND cycle=$2 ORDER BY college_id', [householdId, cycle]);
  const pend = await queryOne<any>("SELECT COALESCE(SUM(units),0) AS n FROM college_addon_purchases WHERE household_id=$1 AND cycle=$2 AND status='pending'", [householdId, cycle]);
  return { cycle, includedUnits: a.includedUnits, purchasedUnits: a.purchasedUnits, coveredUnits: a.coveredUnits,
    remainingUnits: Math.max(0, a.includedUnits + a.purchasedUnits - a.coveredUnits), addonHold: a.addonHold,
    coveredCollegeIds: ids.map(r => String(r.college_id)), pendingAddonUnits: Number(pend?.n ?? 0) };
}

const toPurchase = (r: any) => ({ id: String(r.id), householdId: (r.household_id ?? null) as string | null, cycle: String(r.cycle), units: Number(r.units),
  amountCents: Number(r.amount_cents), priceId: String(r.price_id), status: r.status as 'pending' | 'provisioned' | 'refund_review' | 'exception',
  providerSessionId: (r.provider_session_id ?? null) as string | null, providerPaymentId: (r.provider_payment_id ?? null) as string | null,
  refundedCents: Number(r.refunded_cents ?? 0) });
export async function getAddonPurchase(id: string) {
  const r = await queryOne<any>('SELECT * FROM college_addon_purchases WHERE id=$1', [id]);
  return r ? toPurchase(r) : null;
}

/** Creates a PENDING purchase record only. It grants nothing and makes no provider call; checkout
 * creation is a later gate. Amount and units are computed here from server-side coverage state. */
export async function createPendingAddonPurchase(input: { householdId: string; authUserId: string; cycle: string; desiredCollegeIds: readonly string[]; idempotencyKey: string }, env: Env = process.env) {
  if (!addonTestModeConfigured(env)) throw new Error('Add-on purchase is not enabled');
  if (!isCoverageCycle(input.cycle) || !/^[\w-]{8,100}$/.test(input.idempotencyKey)) throw new Error('Invalid add-on request');
  return withTransaction(async () => {
    if (!await eligibleHousehold(input.householdId)) throw new Error('Eligible household required');
    if (!await queryOne('SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2 AND role=$3', [input.householdId, input.authUserId, 'owner'])) throw new Error('Household owner required');
    const key = `addon:${input.idempotencyKey}`;
    const prior = await queryOne<any>('SELECT * FROM college_addon_purchases WHERE idempotency_key=$1', [key]);
    if (prior) {
      if (prior.household_id !== input.householdId || prior.cycle !== input.cycle) throw new Error('Idempotency key conflict');
      return toPurchase(prior);
    }
    const ent = await activeEntitlement(input.householdId, input.cycle, true);
    if (!ent) throw new Error('Active paid access required for add-on colleges');
    const account = await lockedAccount(input.householdId, input.cycle);
    if (account.addonHold) throw new Error('Add-on purchases are paused during refund review');
    const covered = (await queryRows<any>('SELECT college_id FROM college_coverage_colleges WHERE household_id=$1 AND cycle=$2', [input.householdId, input.cycle])).map(r => String(r.college_id));
    const quote = quoteAddonUnits(account, covered, input.desiredCollegeIds);
    if (quote.unitsToBuy < 1) throw new Error('No add-on purchase is needed');
    const pending = await queryOne<any>("SELECT * FROM college_addon_purchases WHERE household_id=$1 AND cycle=$2 AND status='pending'", [input.householdId, input.cycle]);
    if (pending) {
      if (Number(pending.units) === quote.unitsToBuy && pending.price_id === env.STRIPE_ADDON_PRICE_ID) return toPurchase(pending);
      throw new Error('A different add-on purchase is already pending; owner review required');
    }
    const id = newId('addon'), now = nowIso();
    await exec(`INSERT INTO college_addon_purchases(id,household_id,cycle,entitlement_order_id,units,amount_cents,price_id,status,idempotency_key,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10)`, [id, input.householdId, input.cycle, ent.order_id, quote.unitsToBuy, quote.unitsToBuy * ADDITIONAL_UNIQUE_COLLEGE_CENTS, env.STRIPE_ADDON_PRICE_ID, key, now, now]);
    return toPurchase((await queryOne<any>('SELECT * FROM college_addon_purchases WHERE id=$1', [id]))!);
  });
}

export type ProvisionResult =
  | { status: 'provisioned'; unitsGranted: number }
  | { status: 'already_provisioned'; unitsGranted: 0 }
  | { status: 'exception'; code: string; unitsGranted: 0 };

/** The ONLY function that increases purchased capacity. It requires evidence issued by
 * verifyAddonCheckoutEvent (signature-verified test-mode event matched to the server purchase),
 * re-checks it against the stored purchase, and is idempotent by purchase id, payment intent and
 * a unique capacity-ledger reference. Replays and duplicate events grant nothing more. */
export async function provisionVerifiedCollegeAddon(evidence: VerifiedAddonPayment, env: Env = process.env): Promise<ProvisionResult> {
  const exception = (code: string): ProvisionResult => ({ status: 'exception', code, unitsGranted: 0 });
  if (!isVerifiedAddonPayment(evidence)) throw new Error('Verified add-on payment evidence required');
  if (!addonTestModeConfigured(env)) return exception('addon_disabled');
  return withTransaction(async (): Promise<ProvisionResult> => {
    const row = await queryOne<any>(`SELECT * FROM college_addon_purchases WHERE id=$1${lock}`, [evidence.purchaseId]);
    if (!row) return exception('unknown_purchase');
    const p = toPurchase(row);
    if (!p.householdId || p.householdId !== evidence.householdId || p.cycle !== evidence.cycle || p.units !== evidence.units
      || p.amountCents !== evidence.amountCents || p.priceId !== evidence.priceId || p.priceId !== env.STRIPE_ADDON_PRICE_ID) return exception('evidence_mismatch');
    if (p.status === 'provisioned' || p.status === 'refund_review') {
      return p.providerPaymentId === evidence.paymentIntentId ? { status: 'already_provisioned', unitsGranted: 0 } : exception('payment_conflict');
    }
    if (p.status !== 'pending') return exception('purchase_state_conflict');
    if (await queryOne('SELECT 1 AS ok FROM college_addon_purchases WHERE (provider_payment_id=$1 OR provider_session_id=$2 OR provider_event_id=$3) AND id<>$4', [evidence.paymentIntentId, evidence.sessionId, evidence.eventId, p.id])) return exception('payment_reuse');
    if (!await eligibleHousehold(p.householdId)) return exception('ineligible_household');
    await lockedAccount(p.householdId, p.cycle);
    const now = nowIso();
    const flipped = await queryOne<any>(`UPDATE college_addon_purchases SET status='provisioned',provider_session_id=$1,provider_payment_id=$2,provider_event_id=$3,provisioned_at=$4,updated_at=$5
      WHERE id=$6 AND status='pending' RETURNING id`, [evidence.sessionId, evidence.paymentIntentId, evidence.eventId, now, now, p.id]);
    if (!flipped) return { status: 'already_provisioned', unitsGranted: 0 };
    const ledger = await queryOne<any>(`INSERT INTO college_capacity_events(id,household_id,cycle,kind,purchase_id,units,amount_cents,reference,actor,detail_code,created_at)
      VALUES($1,$2,$3,'addon_grant',$4,$5,$6,$7,'stripe_verified','verified_addon_payment',$8) ON CONFLICT(reference) DO NOTHING RETURNING id`,
      [newId('capacity'), p.householdId, p.cycle, p.id, p.units, p.amountCents, `addon:${p.id}`, now]);
    if (!ledger) throw new Error('Capacity ledger conflict; rolled back'); // never grant without exactly one ledger row
    const granted = await queryOne<any>('UPDATE college_coverage_accounts SET purchased_units=purchased_units+$1,updated_at=$2 WHERE household_id=$3 AND cycle=$4 RETURNING purchased_units', [p.units, now, p.householdId, p.cycle]);
    if (!granted) throw new Error('Coverage account missing; rolled back');
    return { status: 'provisioned', unitsGranted: p.units };
  });
}

export type RefundResult = { status: 'held_for_review' | 'no_change' | 'exception'; code: string };

/** Fail-safe refund handling for a signature-verified refund event on an add-on payment. It
 * freezes NEW use of purchased capacity and flags the purchase for explicit owner review. It never
 * deletes coverage, reduces granted capacity, or touches research (REFUND_COVERAGE_POLICY). */
export async function recordAddonRefundForReview(input: { paymentIntentId: string; refundedCents: unknown; currency: unknown; eventId: string }, env: Env = process.env): Promise<RefundResult> {
  if (!addonTestModeConfigured(env)) return { status: 'exception', code: 'addon_disabled' };
  if (!/^evt_\w+$/.test(input.eventId) || !/^pi_\w+$/.test(input.paymentIntentId)) return { status: 'exception', code: 'refund_event_invalid' };
  return withTransaction(async (): Promise<RefundResult> => {
    const row = await queryOne<any>(`SELECT * FROM college_addon_purchases WHERE provider_payment_id=$1${lock}`, [input.paymentIntentId]);
    const p = row ? toPurchase(row) : null;
    const decision = decideAddonRefund({ purchase: p, eventRefundedCents: input.refundedCents, currency: input.currency });
    if (decision.action === 'exception') return { status: 'exception', code: decision.code };
    if (decision.action === 'no_change' || !p || !p.householdId) return { status: 'no_change', code: 'refund_already_recorded' };
    const now = nowIso();
    const ledger = await queryOne<any>(`INSERT INTO college_capacity_events(id,household_id,cycle,kind,purchase_id,units,amount_cents,reference,actor,detail_code,created_at)
      VALUES($1,$2,$3,'refund_review',$4,0,$5,$6,'stripe_verified','addon_refund_hold',$7) ON CONFLICT(reference) DO NOTHING RETURNING id`,
      [newId('capacity'), p.householdId, p.cycle, p.id, decision.refundedCents, `refund:${input.eventId}`, now]);
    if (!ledger) return { status: 'no_change', code: 'refund_event_replay' };
    await lockedAccount(p.householdId, p.cycle);
    await exec("UPDATE college_addon_purchases SET status='refund_review',refunded_cents=$1,updated_at=$2 WHERE id=$3 AND status IN ('provisioned','refund_review')", [decision.refundedCents, now, p.id]);
    await exec('UPDATE college_coverage_accounts SET addon_hold=1,updated_at=$1 WHERE household_id=$2 AND cycle=$3', [now, p.householdId, p.cycle]);
    return { status: 'held_for_review', code: 'addon_refund_hold' };
  });
}

/** Explicit owner review outcome: keep granted capacity and already-started research, lift the
 * freeze. Revoking unused units is intentionally NOT implemented (needs a reviewed policy). */
export async function releaseAddonRefundHold(input: { purchaseId: string; actor: { id: string; email: string }; reason: string }): Promise<boolean> {
  if (!isAdministratorEmail(input.actor.email) || !await queryOne('SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND role=$2', [input.actor.id, 'owner'])) throw new Error('Owner authorization required');
  const reason = input.reason.trim();
  if (reason.length < 4 || reason.length > 200) throw new Error('Review reason required');
  return withTransaction(async () => {
    const row = await queryOne<any>(`SELECT * FROM college_addon_purchases WHERE id=$1${lock}`, [input.purchaseId]);
    if (!row || row.status !== 'refund_review' || !row.household_id) return false;
    const now = nowIso();
    const ledger = await queryOne<any>(`INSERT INTO college_capacity_events(id,household_id,cycle,kind,purchase_id,units,amount_cents,reference,actor,detail_code,created_at)
      VALUES($1,$2,$3,'review_release',$4,0,$5,$6,$7,$8,$9) ON CONFLICT(reference) DO NOTHING RETURNING id`,
      [newId('capacity'), row.household_id, row.cycle, row.id, Number(row.refunded_cents), `release:${row.id}:${row.refunded_cents}`, input.actor.id, `retain_capacity_and_research:${reason}`, now]);
    if (!ledger) return false;
    await lockedAccount(row.household_id, row.cycle);
    await exec("UPDATE college_addon_purchases SET status='provisioned',updated_at=$1 WHERE id=$2 AND status='refund_review'", [now, row.id]);
    // Hold stays if another purchase for this household-cycle is still under review.
    const other = await queryOne("SELECT 1 AS ok FROM college_addon_purchases WHERE household_id=$1 AND cycle=$2 AND status='refund_review'", [row.household_id, row.cycle]);
    if (!other) await exec('UPDATE college_coverage_accounts SET addon_hold=0,updated_at=$1 WHERE household_id=$2 AND cycle=$3', [now, row.household_id, row.cycle]);
    return true;
  });
}

