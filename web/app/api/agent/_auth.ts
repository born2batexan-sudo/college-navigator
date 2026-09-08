import { NextRequest, NextResponse } from "next/server";

/**
 * All /api/agent/* routes are the surface the standalone Python agents
 * (agents/research_agent.py, monitoring_agent.py, guidance_agent.py) call.
 * They authenticate with a bearer token shared via AGENT_API_KEY — not
 * cookies/session, since these are machine callers, not browser users.
 */
export function requireAgentAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "AGENT_API_KEY is not configured on the server" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
