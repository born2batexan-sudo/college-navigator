import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { listInstitutions, listRulesForInstitution, getInstitutionBySlug, upsertInstitution, upsertRule } from "@/lib/db/repo";
import { recomputeCoverage } from "@/lib/coverage";
import { ALL_CHECKPOINTS } from "@/lib/checkpoints";

// Talks to the database on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/** GET: lets an agent see every institution and which of the universal 144 checkpoints still need research. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const institutions = await Promise.all(
    (await listInstitutions()).map(async (inst) => {
      const rules = await listRulesForInstitution(inst.id);
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
    })
  );

  return NextResponse.json({ institutions });
}

/**
 * POST — onboard a new institution in a single call, so scaling past the six
 * pressure-test schools never requires a hand-edited seed script again.
 *
 * Creates the Institution row (or reuses it if the slug already exists) and
 * upserts an explicit "unverified / queued for research" placeholder Rule
 * for all 144 universal checkpoints — the same honest-stub pattern
 * lib/db/seed.ts uses for a freshly-added school — so the institution shows
 * up immediately at 0%/unsupported and is instantly a valid target for
 * agents/research_agent.py (--institution <slug>) to start filling in.
 * Idempotent: re-posting the same slug does not touch or reset any rule
 * that has already been researched (upsertRule only overwrites unverified
 * defaults the first time; once a code is verified, re-running this is a
 * no-op for that code since upsertInstitution short-circuits on existing
 * institutions and this handler only ever seeds codes with no rule yet).
 *
 * Body: { name, slug, domains?: string[], pathway?: string }
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const { name, slug, domains, pathway } = body ?? {};
  if (!name || !slug) {
    return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: "slug must be lowercase letters, digits, and hyphens only" }, { status: 400 });
  }

  const alreadyExisted = !!(await getInstitutionBySlug(slug));

  const institution = await upsertInstitution({
    name,
    slug,
    domains: Array.isArray(domains) ? domains : [],
    pathway: pathway ?? "both",
    coverageStatus: "unsupported",
    coveragePct: 0,
  });

  const existingRules = await listRulesForInstitution(institution.id);
  const existingCodes = new Set(existingRules.map((r) => r.checkpointCode));

  let seeded = 0;
  for (const cp of ALL_CHECKPOINTS) {
    if (existingCodes.has(cp.code)) continue; // never touch a code that already has a rule (researched or not)
    await upsertRule({
      institutionId: institution.id,
      checkpointCode: cp.code,
      domain: cp.domain,
      title: cp.title,
      critical: cp.critical,
      population: "all",
      requirement: "Not yet researched — queued for the Institutional Research Agent.",
      trigger: cp.code.startsWith("ADM") ? null : "admitted",
      status: "unverified",
      confidence: "low",
      refundable: "unknown",
    });
    seeded++;
  }

  const coverage = await recomputeCoverage(institution.id);

  return NextResponse.json({
    institution: { slug: institution.slug, name: institution.name, alreadyExisted },
    checkpointsSeeded: seeded,
    totalCheckpoints: ALL_CHECKPOINTS.length,
    coverage,
  });
}
