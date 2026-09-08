import { ALL_CHECKPOINTS } from "./checkpoints";
import { listRulesForInstitution, updateInstitutionCoverage } from "./db/repo";

/**
 * Recomputes an institution's 144-point coverage percentage and gate
 * status after a rule is added or verified, per the brief's certification
 * gates (Section 8): Certified >=90% with no critical gaps, Beta 75-89% or
 * one critical gap, Research 50-74%, Unsupported below 50%.
 */
export function recomputeCoverage(institutionId: string) {
  const rules = listRulesForInstitution(institutionId);
  const verified = rules.filter((r) => r.status === "verified");
  const criticalGaps = rules.filter((r) => r.critical && r.status !== "verified").length;

  const pct = Math.round((verified.length / ALL_CHECKPOINTS.length) * 1000) / 10;

  let status: "certified" | "beta" | "research" | "unsupported";
  if (pct >= 90 && criticalGaps === 0) status = "certified";
  else if (pct >= 75) status = "beta"; // includes the "one critical workflow incomplete" downgrade case
  else if (pct >= 50) status = "research";
  else status = "unsupported";

  updateInstitutionCoverage(institutionId, pct, status);
  return { pct, status, criticalGaps };
}
