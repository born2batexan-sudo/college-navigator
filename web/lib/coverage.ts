import { ALL_CHECKPOINTS } from "./checkpoints";
import { listRulesForInstitution } from "./db/repo";
import { exec, nowIso, queryOne } from "./db/client";

export type CoverageResult = { pct: number; status: "certified" | "beta" | "research" | "unsupported"; criticalGaps: number; researchTerm: string };

/** Coverage is computed only from evidence-valid records for one term. */
export async function recomputeCoverage(institutionId: string, researchTerm = "Fall 2027"): Promise<CoverageResult> {
  const rules = await listRulesForInstitution(institutionId, researchTerm);
  const evidenceValid = (r: (typeof rules)[number]) => !!r.sourceId && !!r.evidenceQuote && r.cycleState !== "prior";
  const verified = rules.filter((r) => r.status === "verified" && evidenceValid(r));
  const criticalGaps = rules.filter((r) => r.critical && !(r.status === "verified" && evidenceValid(r)) &&
    !(r.applicability === "not_yet_published" && evidenceValid(r))).length;
  const pct = Math.round((verified.length / ALL_CHECKPOINTS.length) * 1000) / 10;
  let status: CoverageResult["status"];
  // A percentage is not certification: all-subject state, contradictory evidence,
  // independent review and live-school benchmarking are required. Quarantine
  // the old 90% gate until a separately reviewed certification protocol exists.
  if (pct >= 75) status = "beta";
  else if (pct >= 50) status = "research";
  else status = "unsupported";
  const now = nowIso();
  const certifiedAt = null; // No percentage-based automated certification.
  await exec(`INSERT INTO research_versions (institution_id,research_term,coverage_status,coverage_pct,critical_gaps,certified_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (institution_id,research_term) DO UPDATE SET coverage_status=$8,coverage_pct=$9,critical_gaps=$10,certified_at=$11,updated_at=$12`,
    [institutionId,researchTerm,status,pct,criticalGaps,certifiedAt,now,status,pct,criticalGaps,certifiedAt,now]);
  return { pct, status, criticalGaps, researchTerm };
}

export async function getCoverageVersion(institutionId: string, researchTerm: string): Promise<CoverageResult | null> {
  const row = await queryOne<any>("SELECT * FROM research_versions WHERE institution_id=$1 AND research_term=$2", [institutionId, researchTerm]);
  return row ? { pct: Number(row.coverage_pct), status: row.coverage_status, criticalGaps: Number(row.critical_gaps), researchTerm } : null;
}
