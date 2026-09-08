import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { ALL_CHECKPOINTS } from "@/lib/checkpoints";

// Talks to the database on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/** GET: the canonical 144-point checklist every institution is researched against. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ checkpoints: ALL_CHECKPOINTS });
}
