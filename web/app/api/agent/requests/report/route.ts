import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../../_auth";
import { ensureAccountSchema } from "@/lib/db/accounts";
import { reportResearchJob } from "@/lib/db/requests";

export const dynamic = "force-dynamic";

/** Reports an attempt. A caller cannot mark a school ready merely by posting
 * a positive result: requests.ts re-reads the institution's server-side
 * certification status before allowing the ready transition. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;
  await ensureAccountSchema();
  const body = await req.json().catch(() => null);
  if (!body?.unitid || !body?.term || !Number.isInteger(Number(body.attempt)) || !["recheck", "certified", "review", "failed"].includes(body.outcome)) {
    return NextResponse.json({ error: "unitid, term, integer attempt, and valid outcome are required" }, { status: 400 });
  }
  try {
    const job = await reportResearchJob({
      unitid: String(body.unitid), term: String(body.term), attempt: Number(body.attempt), outcome: body.outcome,
      costCents: body.costCents, coveragePct: body.coveragePct, note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
      slug: typeof body.slug === "string" ? body.slug.slice(0, 120) : null,
    });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not report job" }, { status: 409 });
  }
}
