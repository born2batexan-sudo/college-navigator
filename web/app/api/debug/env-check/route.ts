import { NextResponse } from "next/server";

// Talks to process.env on every request — never let Next.js try to
// statically render or pre-execute this at build time.
export const dynamic = "force-dynamic";

/**
 * TEMPORARY diagnostic endpoint — delete this file once DATABASE_URL and
 * AGENT_API_KEY are both confirmed reaching the deployed app. It never
 * returns a full secret value — only presence, length, a few boundary
 * characters, and (for AGENT_API_KEY only, which is an internal app-to-app
 * token rather than a third-party credential) whether it matches the known
 * value we're currently testing with — enough to prove or disprove that
 * Vercel is actually injecting the *current* value, without exposing
 * anything sensitive in the response.
 */
const EXPECTED_AGENT_API_KEY =
  "a5b76caabcdc61f76ffeb05de295b2988532543edcd16e267445dcddfd53b06d";

export async function GET() {
  const url = process.env.DATABASE_URL;

  let host: string | null = null;
  if (url) {
    const match = url.match(/@([^:/?]+)/);
    host = match ? match[1] : "present-but-unparseable";
  }

  const agentKey = process.env.AGENT_API_KEY;

  return NextResponse.json({
    hasDatabaseUrl: !!url,
    valueLength: url ? url.length : 0,
    startsWithPostgresql: url ? url.startsWith("postgresql://") : false,
    host,
    hasAgentApiKey: !!agentKey,
    agentApiKeyLength: agentKey ? agentKey.length : 0,
    agentApiKeyFirst4: agentKey ? agentKey.slice(0, 4) : null,
    agentApiKeyLast4: agentKey ? agentKey.slice(-4) : null,
    agentApiKeyHasWhitespace: agentKey ? /\s/.test(agentKey) : null,
    agentApiKeyMatchesExpected: agentKey ? agentKey === EXPECTED_AGENT_API_KEY : false,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
}
