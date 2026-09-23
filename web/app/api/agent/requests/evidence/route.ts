import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../../_auth";
import { ingestResearch } from "@/lib/db/request-pipeline";
import { ALL_CHECKPOINTS } from "@/lib/checkpoints";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) { const denied=requireAgentAuth(req,"queue"); return denied ?? NextResponse.json({checkpoints:ALL_CHECKPOINTS}); }
export async function POST(req: NextRequest) {
  const denied=requireAgentAuth(req,"queue"); if(denied)return denied;
  if (Number(req.headers.get("content-length") ?? 0)>3_000_000) return NextResponse.json({error:"Research batch too large"},{status:413});
  const raw=await req.text();
  if (raw.length>3_000_000) return NextResponse.json({error:"Research batch too large"},{status:413});
  const body=(()=>{try{return JSON.parse(raw)}catch{return null}})();
  if (!body || !/^\d+$/.test(String(body.unitid)) || typeof body.term!=="string" || typeof body.attemptId!=="string" || !Array.isArray(body.candidates)) return NextResponse.json({error:"Invalid research submission"},{status:400});
  try {
    const result=await ingestResearch({unitid:body.unitid,term:body.term,attemptId:body.attemptId,candidates:body.candidates});
    return NextResponse.json({changed:result.changed,counts:result.states.reduce((a,r)=>(a[r.state]=(a[r.state]||0)+1,a),{} as Record<string,number>)});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Research rejected"},{status:409}); }
}
