import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { getInstitutionBySlug, getRuleByCode, upsertGuidance } from "@/lib/db/repo";

/**
 * POST — the Guidance Generation Agent's write path. Turns a verified Rule
 * into household-facing WHAT/WHEN/WHY/HOW/CONSEQUENCE copy.
 * Body: { institutionSlug, checkpointCode, what, when, why, how,
 *   consequence, deepLink? }
 *
 * Deliberately does not accept essay/personal-statement content in any
 * field — this endpoint is guidance about process and logistics only,
 * per the protected admissions-content boundary (brief Section 15).
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const { institutionSlug, checkpointCode, what, when, why, how, consequence } = body ?? {};
  if (!institutionSlug || !checkpointCode || !what || !when || !why || !how || !consequence) {
    return NextResponse.json(
      { error: "institutionSlug, checkpointCode, what, when, why, how, and consequence are all required" },
      { status: 400 }
    );
  }

  const institution = getInstitutionBySlug(institutionSlug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${institutionSlug}` }, { status: 404 });

  const rule = getRuleByCode(institution.id, checkpointCode);
  if (!rule) return NextResponse.json({ error: `No rule ${checkpointCode} for ${institutionSlug} yet — file the rule first via /api/agent/rules` }, { status: 404 });
  if (rule.status !== "verified") {
    return NextResponse.json({ error: `Rule ${checkpointCode} is not verified yet; guidance should only be generated from verified rules` }, { status: 409 });
  }

  const guidance = upsertGuidance({ ruleId: rule.id, what, when, why, how, consequence, deepLink: body.deepLink, generatedBy: "guidance_agent" });
  return NextResponse.json({ guidance });
}
