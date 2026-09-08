import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { getInstitutionBySlug, listRulesForInstitution, upsertRule, listRelationshipsForInstitution, getGuidanceForRule } from "@/lib/db/repo";
import { recomputeCoverage } from "@/lib/coverage";
import { materializeActionsForRelationship } from "@/lib/materialize";
import { ALL_CHECKPOINTS } from "@/lib/checkpoints";

// Talks to the database on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/** GET ?institutionSlug=alabama — current state of every rule for an institution. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const slug = req.nextUrl.searchParams.get("institutionSlug");
  if (!slug) return NextResponse.json({ error: "institutionSlug is required" }, { status: 400 });
  const institution = await getInstitutionBySlug(slug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${slug}` }, { status: 404 });

  const rawRules = await listRulesForInstitution(institution.id);
  const rules = await Promise.all(rawRules.map(async (r) => ({ ...r, hasGuidance: !!(await getGuidanceForRule(r.id)) })));
  return NextResponse.json({ rules });
}

/**
 * POST — the Institutional Research Agent's primary write path. Upserts one
 * checkpoint's Rule (keyed on institutionSlug + checkpointCode) and, if a
 * sourceUrl/sourceId is given, links it. Recomputes the institution's
 * 144-point coverage and re-materializes the Action Ledger for every
 * household already tracking this institution, so a household sees new
 * research the moment the agent files it — no separate publish step.
 *
 * Body: { institutionSlug, checkpointCode, requirement, status, confidence,
 *   population?, trigger?, dependsOnCode?, deadlineExpr?, costCents?,
 *   refundable?, consequence?, sourceId?, verifiedAt? }
 * domain/title/critical are looked up from the canonical checkpoint index
 * rather than trusted from the caller, since they're fixed by definition.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const { institutionSlug, checkpointCode, requirement, status, confidence } = body ?? {};
  if (!institutionSlug || !checkpointCode || !requirement || !status || !confidence) {
    return NextResponse.json(
      { error: "institutionSlug, checkpointCode, requirement, status, and confidence are required" },
      { status: 400 }
    );
  }

  const institution = await getInstitutionBySlug(institutionSlug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${institutionSlug}` }, { status: 404 });

  const canonical = ALL_CHECKPOINTS.find((c) => c.code === checkpointCode);
  if (!canonical) return NextResponse.json({ error: `Unknown checkpoint code: ${checkpointCode}` }, { status: 400 });

  const rule = await upsertRule({
    institutionId: institution.id,
    checkpointCode: canonical.code,
    domain: canonical.domain,
    title: canonical.title,
    critical: canonical.critical,
    population: body.population,
    requirement,
    trigger: body.trigger,
    dependsOnCode: body.dependsOnCode,
    deadlineExpr: body.deadlineExpr,
    costCents: body.costCents,
    refundable: body.refundable,
    consequence: body.consequence,
    status,
    confidence,
    verifiedAt: body.verifiedAt ?? (status === "verified" ? new Date().toISOString() : null),
    sourceId: body.sourceId ?? null,
  });

  const coverage = await recomputeCoverage(institution.id);

  const relationships = await listRelationshipsForInstitution(institution.id);
  for (const rel of relationships) {
    await materializeActionsForRelationship(rel.id);
  }

  return NextResponse.json({ rule, coverage, relationshipsUpdated: relationships.length });
}
