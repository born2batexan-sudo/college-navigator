// TEMPORARY diagnostic page — delete once DATABASE_URL is confirmed working
// on the real homepage. Deliberately built as a Page (like the real
// homepage) rather than an API route, to test whether Vercel is exposing
// DATABASE_URL differently to pages vs. route handlers within the same
// deployment. Never prints the actual secret value.
export const dynamic = "force-dynamic";

export default async function DebugPageCheck() {
  const url = process.env.DATABASE_URL;

  let host: string | null = null;
  if (url) {
    const match = url.match(/@([^:/?]+)/);
    host = match ? match[1] : "present-but-unparseable";
  }

  const result = {
    hasDatabaseUrl: !!url,
    valueLength: url ? url.length : 0,
    startsWithPostgresql: url ? url.startsWith("postgresql://") : false,
    host,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  };

  return <pre>{JSON.stringify(result, null, 2)}</pre>;
}
