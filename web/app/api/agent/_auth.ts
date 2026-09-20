import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export type AgentScope = "general" | "research" | "queue" | "directory";
const ENV_BY_SCOPE: Record<AgentScope,string> = { general:"AGENT_API_KEY", research:"RESEARCH_WRITER_API_KEY", queue:"QUEUE_AGENT_API_KEY", directory:"DIRECTORY_IMPORT_API_KEY" };

/** Machine credentials are scoped so a queue token cannot fabricate rules. */
export function requireAgentAuth(req: NextRequest, scope: AgentScope = "general"): NextResponse | null {
  const envName=ENV_BY_SCOPE[scope],expected=process.env[envName];
  if(!expected)return NextResponse.json({error:`${envName} is not configured on the server`},{status:500});
  const auth=req.headers.get("authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
  const a=Buffer.from(token),b=Buffer.from(expected);const valid=a.length===b.length&&timingSafeEqual(a,b);
  if(!valid)return NextResponse.json({error:"Unauthorized"},{status:401});
  return null;
}
