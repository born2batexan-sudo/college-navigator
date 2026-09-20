import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { ensureAccountSchema } from "@/lib/db/accounts";
import { queueOverview } from "@/lib/db/requests";

export const dynamic = "force-dynamic";

/** Operational view for the worker/checks. It contains no household names or emails. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;
  await ensureAccountSchema();
  return NextResponse.json(await queueOverview());
}
