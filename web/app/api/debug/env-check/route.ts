import { NextResponse } from "next/server";

// This temporary diagnostic endpoint has been retired. It is kept as an inert
// stub only because files cannot be deleted from the tooling that maintains
// this repo; delete the file whenever convenient.
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("Not found", { status: 404 });
}
