import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { getInstitutionBySlug, createSource, findSourceByUrl, listSourcesForInstitution, updateSourceFingerprint } from "@/lib/db/repo";

// Talks to the database on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/** GET ?institutionSlug=alabama — list known sources, so an agent doesn't refetch/re-create duplicates. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const slug = req.nextUrl.searchParams.get("institutionSlug");
  if (!slug) return NextResponse.json({ error: "institutionSlug is required" }, { status: 400 });
  const institution = await getInstitutionBySlug(slug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${slug}` }, { status: 404 });

  return NextResponse.json({ sources: await listSourcesForInstitution(institution.id) });
}

/**
 * POST — register (or fetch, if it already exists) a Source the research
 * agent is about to cite. Body: { institutionSlug, url, label, owner?,
 * lastVerified? (ISO string) }.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const { institutionSlug, url, label, owner, lastVerified } = body ?? {};
  if (!institutionSlug || !url || !label) {
    return NextResponse.json({ error: "institutionSlug, url, and label are required" }, { status: 400 });
  }

  const institution = await getInstitutionBySlug(institutionSlug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${institutionSlug}` }, { status: 404 });

  const existing = await findSourceByUrl(institution.id, url);
  if (existing) return NextResponse.json({ source: existing, created: false });

  const source = await createSource({ institutionId: institution.id, url, label, owner, lastVerified });
  return NextResponse.json({ source, created: true }, { status: 201 });
}

/**
 * PATCH — set a Source's baseline fingerprint without logging a
 * ChangeEvent. The Monitoring Agent uses this on a source's first check
 * (there's nothing to diff against yet); every check after that goes
 * through POST /api/agent/change-events instead, which always represents
 * an actual detected difference. Body: { institutionSlug, url, fingerprint, content? }.
 */
export async function PATCH(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;

  const { institutionSlug, url, fingerprint, content } = (await req.json()) ?? {};
  if (!institutionSlug || !url || !fingerprint) {
    return NextResponse.json({ error: "institutionSlug, url, and fingerprint are required" }, { status: 400 });
  }
  const institution = await getInstitutionBySlug(institutionSlug);
  if (!institution) return NextResponse.json({ error: `Unknown institution slug: ${institutionSlug}` }, { status: 404 });
  const source = await findSourceByUrl(institution.id, url);
  if (!source) return NextResponse.json({ error: `No known source for ${url} under ${institutionSlug}` }, { status: 404 });

  await updateSourceFingerprint(source.id, fingerprint, new Date().toISOString(), content);
  return NextResponse.json({ ok: true });
}
