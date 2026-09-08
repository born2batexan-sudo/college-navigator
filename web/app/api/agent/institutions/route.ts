import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { listInstitutions, listRulesForInstitution } from "@/lib/db/repo";
import { ALL_CHECKPOINTS } from "@/lib/checkpoints";

/** GET: lets an agent see every institution and which of the universal 144 checkpoints still need research. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const institutions = listInstitutions().map((inst) => {
    const rules = listRulesForInstitution(inst.id);
    const verifiedCodes = new Set(rules.filter((r) => r.status === "verified").map((r) => r.checkpointCode));
    const outstanding = ALL_CHECKPOINTS.filter((cp) => !verifiedCodes.has(cp.code));
    return {
      slug: inst.slug,
      name: inst.name,
      coverageStatus: inst.coverageStatus,
      coveragePct: inst.coveragePct,
      verifiedCount: verifiedCodes.size,
      totalCheckpoints: ALL_CHECKPOINTS.length,
      outstandingCheckpoints: outstanding,
      outstandingCriticalCheckpoints: outstanding.filter((cp) => cp.critical),
    };
  });

  return NextResponse.json({ institutions });
}
