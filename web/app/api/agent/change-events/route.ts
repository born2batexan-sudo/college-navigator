import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { findSourceByUrl, getInstitutionBySlug, createChangeEvent, listPendingChangeEvents, updateSourceFingerprint, getSource } from "@/lib/db/repo";

// Talks to the database on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/** GET — the pending review queue: changes the Monitoring Agent has flagged that a human (or the Research Agent) hasn't triaged yet. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ changeEvents: await listPendingChangeEvents() });
}

/**
 * POST — the Monitoring/Change-Detection Agent's write path. Call this
 * after re-fetching a Source and finding its content fingerprint changed.
 * Body: { institutionSlug, sourceUrl, materiality ("material"|"cosmetic"),
 *   oldFingerprint, newFingerprint, newContent?, summary? }
 * Also updates the Source's stored fingerprint (and content, if given) so
 * the next run diffs against this one.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const { institutionSlug, sourceUrl, materiality, oldFingerprint, newFingerprint, newContent, summary } = body ?? {};
  if (!institutionSlug || !sourceUrl || !materiality || !newFingerprint) {
    return NextResponse.json({ error: "institutionSlug, sourceUrl, materiality, and newFingerprint are required" }, { status: 400 });
  }

  const institution = await getInstitutionBySlug(institutionSlug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${institutionSlug}` }, { status: 404 });

  const source = await findSourceByUrl(institution.id, sourceUrl);
  if (!source) return NextResponse.json({ error: `No known source for ${sourceUrl} under ${institutionSlug}` }, { status: 404 });

  const event = await createChangeEvent({ sourceId: source.id, materiality, oldFingerprint: oldFingerprint ?? source.fingerprint, newFingerprint, summary });
  await updateSourceFingerprint(source.id, newFingerprint, new Date().toISOString(), newContent);

  return NextResponse.json({ changeEvent: event, source: await getSource(source.id) }, { status: 201 });
}
