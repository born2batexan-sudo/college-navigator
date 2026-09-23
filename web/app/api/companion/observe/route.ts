import { NextRequest, NextResponse } from "next/server";
import { recordObservation } from "@/lib/companion";
import { authorizedApiHousehold } from "@/lib/auth/session";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){if(process.env.NODE_ENV==="production")return NextResponse.json({error:"Not found"},{status:404});if (!await authorizedApiHousehold()) return NextResponse.json({error:"Forbidden"},{status:403});const {url,pageText}=(await req.json().catch(()=>null))??{};if(!url||typeof pageText!=="string")return NextResponse.json({error:"url and pageText are required"},{status:400});return NextResponse.json(await recordObservation(url,pageText));}
