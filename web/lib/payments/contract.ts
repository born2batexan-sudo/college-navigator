/** Review-only commercial contract. Pure and provider-independent; no checkout activation. */
export const HOUSEHOLD_CYCLE_BASE_CENTS = 19_900;
export const INCLUDED_UNIQUE_COLLEGES = 10;
export const ADDITIONAL_UNIQUE_COLLEGE_CENTS = 1_900;
export const PAYMENT_CURRENCY = 'usd' as const;
export const PAYMENT_MODE = 'one_time' as const;

export type CollegeQuote = Readonly<{
  currency: typeof PAYMENT_CURRENCY;
  mode: typeof PAYMENT_MODE;
  baseCents: number;
  includedUniqueColleges: number;
  additionalUniqueColleges: number;
  additionalCents: number;
  totalCents: number;
  uniqueCollegeIds: readonly string[];
}>;

/** IDs are canonical institution IDs, not student relationships or user-supplied prices.
 * Both students sharing a college count once. Historical covered IDs remain covered when
 * a school is removed and re-added; callers must load the durable household-cycle set.
 */
export function quoteHouseholdCycle(collegeIds: readonly string[]): CollegeQuote {
  if (!Array.isArray(collegeIds) || collegeIds.length > 100_000 || collegeIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) {
    throw new Error('Canonical college IDs required');
  }
  const uniqueCollegeIds = [...new Set(collegeIds)].sort();
  const additionalUniqueColleges = Math.max(0, uniqueCollegeIds.length - INCLUDED_UNIQUE_COLLEGES);
  const additionalCents = additionalUniqueColleges * ADDITIONAL_UNIQUE_COLLEGE_CENTS;
  if (!Number.isSafeInteger(additionalCents)) throw new Error('Quote exceeds safe amount');
  return Object.freeze({ currency: PAYMENT_CURRENCY, mode: PAYMENT_MODE, baseCents: HOUSEHOLD_CYCLE_BASE_CENTS,
    includedUniqueColleges: INCLUDED_UNIQUE_COLLEGES, additionalUniqueColleges, additionalCents,
    totalCents: HOUSEHOLD_CYCLE_BASE_CENTS + additionalCents, uniqueCollegeIds: Object.freeze(uniqueCollegeIds) });
}

/** Incremental add-on quote after base access is verified. Previously covered IDs are
 * durable per household-cycle and cannot be recycled by removing a school. No charge
 * for another student tracking an already-covered institution. An actual purchase must
 * reserve IDs atomically and reconcile its signed webhook before access is expanded.
 */
export function quoteAdditionalColleges(coveredIds: readonly string[], desiredIds: readonly string[]): { collegeIds: readonly string[]; amountCents: number } {
  const covered = new Set(quoteHouseholdCycle(coveredIds).uniqueCollegeIds);
  const collegeIds = quoteHouseholdCycle(desiredIds).uniqueCollegeIds.filter(id => !covered.has(id));
  const amountCents = collegeIds.length * ADDITIONAL_UNIQUE_COLLEGE_CENTS;
  if (!Number.isSafeInteger(amountCents)) throw new Error('Quote exceeds safe amount');
  return { collegeIds, amountCents };
}
