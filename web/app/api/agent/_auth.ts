import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export type AgentScope = "general" | "research" | "queue" | "directory" | "monitor";
const ENV_BY_SCOPE: Record<AgentScope,string> = {
  general:"AGENT_API_KEY",
  research:"RESEARCH_WRITER_API_KEY",
  queue:"QUEUE_AGENT_API_KEY",
  directory:"DIRECTORY_IMPORT_API_KEY",
  monitor:"MONITOR_API_KEY",
};

function machineRouteEnabled(scope: AgentScope): boolean {
  if (scope === "queue") {
    return process.env.VERCEL_ENV === "preview" &&
      process.env.REQUEST_PIPELINE_ENABLED === "1" &&
      process.env.REQUEST_QUEUE_ENABLED === "1" &&
      process.env.RESEARCH_API_ENABLED === "1";
  }
  if (scope === "monitor") {
    return process.env.VERCEL_ENV === "preview" &&
      process.env.MONITORING_API_ENABLED === "1" &&
      process.env.MONITORING_PIPELINE_ENABLED === "1" &&
      process.env.MONITORING_DELIVERY_ENABLED === "0";
  }
  return false;
}

function privateError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Machine credentials are narrowly scoped; queue and monitor tokens cannot fabricate rules. */
export function requireAgentAuth(req: NextRequest, scope: AgentScope = "general"): NextResponse | null {
  // Machine-key routes have no signed-in household entitlement. Production app
  // routes stay closed; queue and monitoring can open only on an explicit Vercel
  // Preview with their separate gates set, and family delivery explicitly off.
  if (process.env.NODE_ENV === "production" && !machineRouteEnabled(scope)) {
    return privateError(404, "Not found");
  }
  const envName=ENV_BY_SCOPE[scope],expected=process.env[envName];
  if(!expected)return privateError(500, `${envName} is not configured on the server`);
  const auth=req.headers.get("authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
  const a=Buffer.from(token),b=Buffer.from(expected);const valid=a.length===b.length&&timingSafeEqual(a,b);
  if(!valid)return privateError(401, "Unauthorized");
  return null;
}

/** Sources are shared by research and monitoring, but each caller keeps a distinct token. */
export function requireResearchOrMonitorAuth(req: NextRequest): NextResponse | null {
  const monitor = requireAgentAuth(req, "monitor");
  if (!monitor) return null;
  const research = requireAgentAuth(req, "research");
  return research;
}
