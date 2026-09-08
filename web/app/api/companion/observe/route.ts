import { NextRequest, NextResponse } from "next/server";
import { recordObservation } from "@/lib/companion";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Talks to the database on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/** POST { url, pageText } — the content script's low-risk-signal report. See lib/companion.ts. */
export async function POST(req: NextRequest) {
  const { url, pageText } = (await req.json()) ?? {};
  if (!url || typeof pageText !== "string") {
    return NextResponse.json({ error: "url and pageText are required" }, { status: 400, headers: CORS_HEADERS });
  }
  return NextResponse.json(await recordObservation(url, pageText), { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
