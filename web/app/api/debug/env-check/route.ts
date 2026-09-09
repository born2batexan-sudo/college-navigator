import { NextResponse } from "next/server";

// Talks to process.env on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/**
 * TEMPORARY diagnostic endpoint — delete this file once DATABASE_URL is
 * confirmed reaching the deployed app. It never returns the actual secret
 * value (password, full connection string) — only whether it's present,
 * how long it is, and which host it points at, which is enough to prove
 * (or disprove) that Vercel is actually injecting it, without exposing
 * anything sensitive in the response.
 */
export async function GET() {
  const url = process.env.DATABASE_URL;

  let host: string | null = null;
  if (url) {
    const match = url.match(/@([^:/?]+)/);
    host = match ? match[1] : "present-but-unparseable";
  }

  return NextResponse.json({
    hasDatabaseUrl: !!url,
    valueLength: url ? url.length : 0,
    startsWithPostgresql: url ? url.startsWith("postgresql://") : false,
    host,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
}
