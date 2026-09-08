import { NextRequest, NextResponse } from "next/server";
import { getContextForUrl } from "@/lib/companion";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Talks to the database on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/**
 * GET ?url=<current tab URL> — called by the browser companion's side
 * panel / background worker (not the Institutional Research Agent — this
 * is the browser-facing counterpart, unauthenticated in this single-
 * household MVP; see lib/companion.ts's scope note).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400, headers: CORS_HEADERS });
  return NextResponse.json(await getContextForUrl(url), { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
