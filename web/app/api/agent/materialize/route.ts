import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { getInstitutionBySlug, listRelationshipsForInstitution } from "@/lib/db/repo";
import { materializeActionsForRelationship } from "@/lib/materialize";

/**
 * POST — force a re-materialization pass (Rules -> ActionInstances) for
 * every household tracking an institution. Normally this happens
 * automatically whenever /api/agent/rules writes a rule; this endpoint is
 * for recovery, or for re-running after a lifecycle-state change that
 * didn't go through the app itself.
 * Body: { institutionSlug }
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const { institutionSlug } = (await req.json()) ?? {};
  if (!institutionSlug) return NextResponse.json({ error: "institutionSlug is required" }, { status: 400 });

  const institution = getInstitutionBySlug(institutionSlug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${institutionSlug}` }, { status: 404 });

  const relationships = listRelationshipsForInstitution(institution.id);
  const results = relationships.map((rel) => ({ relationshipId: rel.id, evaluations: materializeActionsForRelationship(rel.id) }));

  return NextResponse.json({ relationshipsUpdated: results.length, results });
}
