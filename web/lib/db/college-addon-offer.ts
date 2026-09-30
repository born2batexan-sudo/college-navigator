// Read-only offer/status boundary. Client input identifies only a directory school;
// household, cycle, quantity and price come from authenticated server state.
import { nowIso, queryOne } from './client';
import { getAddonPurchase, getCollegeCoverageSummary } from './college-coverage';
import { getDirectorySchool, getFamilyRequest, MAX_FAMILY_REQUESTS_PER_MONTH } from './requests';
import { collegeCoverageEnforced, isCoverageCycle, quoteAddonUnits } from '../payments/college-coverage';
import { addonStripeReady } from './stripe-college-addon';

export const addonUiReady = () => collegeCoverageEnforced() && addonStripeReady();

type Input = { householdId: string; authUserId: string; isOwner: boolean; isDemo: boolean; cycle: string | null; unitid: string };
export async function getCollegeAddonOffer(input: Input) {
  if (!addonUiReady() || input.isDemo || !isCoverageCycle(input.cycle) || !/^\d+$/.test(input.unitid)) return null;
  if (input.householdId === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim() ||
    await queryOne('SELECT 1 AS ok FROM demo_households WHERE household_id=$1', [input.householdId])) return null;
  const school = await getDirectorySchool(input.unitid);
  if (!school || await getFamilyRequest(input.householdId, input.unitid, input.cycle)) return null;
  const summary = await getCollegeCoverageSummary(input.householdId, input.cycle);
  if (summary.addonHold || summary.remainingUnits !== 0 || summary.coveredCollegeIds.includes(input.unitid)) return null;
  // A purchased unit would not bypass the independent monthly request limit.
  const month = nowIso().slice(0, 7);
  const count = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM school_requests WHERE household_id=$1 AND substr(created_at,1,7)=$2', [input.householdId, month]);
  if (Number(count?.n ?? 0) >= MAX_FAMILY_REQUESTS_PER_MONTH) return null;
  const now = nowIso();
  if (!await queryOne("SELECT 1 AS ok FROM cycle_entitlements WHERE household_id=$1 AND cycle=$2 AND kind='paid' AND revoked_at IS NULL AND starts_at<=$3 AND expires_at>$4", [input.householdId, input.cycle, now, now])) return null;
  if (!input.isOwner) return { ownerRequired: true as const };
  // Enforce ownership again at the DB boundary; purchase and checkout also recheck it.
  if (!await queryOne('SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2 AND role=$3', [input.householdId, input.authUserId, 'owner'])) return { ownerRequired: true as const };
  if (summary.pendingAddonUnits > 1) return null; // never reuse a different-quantity purchase
  const quote = quoteAddonUnits({ includedUnits: summary.includedUnits, purchasedUnits: summary.purchasedUnits, coveredUnits: summary.coveredUnits, addonHold: summary.addonHold }, summary.coveredCollegeIds, [input.unitid]);
  if (quote.unitsToBuy !== 1) return null;
  return { ownerRequired: false as const, schoolName: school.name, unitid: school.unitid, cycle: input.cycle, units: quote.unitsToBuy, amountCents: quote.amountCents, pending: summary.pendingAddonUnits === 1 };
}

export async function getAddonReturnStatus(householdId: string, purchaseId: string) {
  if (!addonUiReady() || !/^addon_[A-Za-z0-9]+$/.test(purchaseId)) return null;
  const purchase = await getAddonPurchase(purchaseId);
  return purchase?.householdId === householdId ? purchase.status : null;
}
