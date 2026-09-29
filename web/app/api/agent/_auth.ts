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
    return process.env.REQUEST_PIPELINE_ENABLED === "1" &&
      process.env.REQUEST_QUEUE_ENABLED === "1" &&
      process.env.RESEARCH_API_ENABLED === "1";
  }
  if (scope === "monitor") {
    return process.env.VERCEL_ENV !== "production" &&
      process.env.MONITORING_API_ENABLED === "1" &&
      process.env.MONITORING_PIPELINE_ENABLED === "1" &&
      process.env.MONITORING_DELIVERY_ENABLED === "0";
  }
  return false;
}

/** Machine credentials are narrowly scoped; queue and monitor tokens cannot fabricate rules. */
export function requireAgentAuth(req: NextRequest, scope: AgentScope = "general"): NextResponse | null {
  // Machine-key routes have no signed-in household entitlement. Production app
  // routes stay closed; monitoring can open only on a non-production deployment
  // with both explicit gates on and family delivery explicitly off.
  if (process.env.NODE_ENV === "production" && !machineRouteEnabled(scope)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const envName=ENV_BY_SCOPE[scope],expected=process.env[envName];
  if(!expected)return NextResponse.json({error:`${envName} is not configured on the server`},{status:500});
  const auth=req.headers.get("authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
  const a=Buffer.from(token),b=Buffer.from(expected);const valid=a.length===b.length&&timingSafeEqual(a,b);
  if(!valid)return NextResponse.json({error:"Unauthorized"},{status:401});
  return null;
}

/** Sources are shared by research and monitoring, but each caller keeps a distinct token. */
export function requireResearchOrMonitorAuth(req: NextRequest): NextResponse | null {
  const monitor = requireAgentAuth(req, "monitor");
  if (!monitor) return null;
  const research = requireAgentAuth(req, "research");
  return research;
}
