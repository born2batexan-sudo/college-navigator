import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "../_auth";
import { ensureAccountSchema } from "@/lib/db/accounts";
import { linkDirectoryInstitution, searchDirectory, upsertDirectorySchool } from "@/lib/db/requests";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){const unauthorized=requireAgentAuth(req,"directory");if(unauthorized)return unauthorized;await ensureAccountSchema();const q=req.nextUrl.searchParams.get("q")??"",limit=Number(req.nextUrl.searchParams.get("limit")??20);return NextResponse.json({schools:await searchDirectory(q,limit)});}
export async function POST(req:NextRequest){
  const body=await req.json().catch(()=>null);
  const scope=body?.link?.unitid&&body?.link?.slug?"research":"directory";
  const unauthorized=requireAgentAuth(req,scope);if(unauthorized)return unauthorized;await ensureAccountSchema();
  if(scope==="research"){try{await linkDirectoryInstitution(String(body.link.unitid),String(body.link.slug));return NextResponse.json({linked:true});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not link"},{status:400});}}
  const schools=Array.isArray(body?.schools)?body.schools:[];if(!schools.length||schools.length>5000)return NextResponse.json({error:"schools must contain 1 to 5000 rows"},{status:400});let imported=0;for(const row of schools){if(!row||row.unitid==null||!row.name)continue;await upsertDirectorySchool(row);imported++;}return NextResponse.json({imported});
}
