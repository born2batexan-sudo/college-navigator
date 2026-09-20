import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { ensureAccountSchema } from "@/lib/db/accounts";
import { linkDirectoryInstitution, searchDirectory, upsertDirectorySchool } from "@/lib/db/requests";

export const dynamic = "force-dynamic";

/** Machine-only IPEDS import/search surface. No directory write is available to browser users. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;
  await ensureAccountSchema();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  return NextResponse.json({ schools: await searchDirectory(q, limit) });
}

/** Import is idempotent by UnitID; rerunning a newer IPEDS file refreshes metadata. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentAuth(req);
  if (unauthorized) return unauthorized;
  await ensureAccountSchema();
  const body = await req.json().catch(() => null);
  if (body?.link?.unitid && body?.link?.slug) {
    await linkDirectoryInstitution(String(body.link.unitid), String(body.link.slug));
    return NextResponse.json({ linked: true });
  }
  const schools = Array.isArray(body?.schools) ? body.schools : [];
  if (!schools.length || schools.length > 5000) return NextResponse.json({ error: "schools must contain 1 to 5000 rows" }, { status: 400 });
  let imported = 0;
  for (const row of schools) {
    if (!row || row.unitid == null || !row.name) continue;
    await upsertDirectorySchool(row);
    imported++;
  }
  return NextResponse.json({ imported });
}
