import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../../_auth";
import { ensureAccountSchema } from "@/lib/db/accounts";
import { claimNextResearchJob } from "@/lib/db/requests";

export const dynamic = "force-dynamic";

/** Claims at most one school. The kill switch, single-run guard, attempt cap,
 * and monthly reservation are enforced on the server, not in GitHub YAML. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;
  await ensureAccountSchema();
  const claimed = await claimNextResearchJob();
  return NextResponse.json(claimed ? { claimed: true, ...claimed } : { claimed: false });
}
