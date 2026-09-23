import { NextRequest, NextResponse } from "next/server";
import { getContextForUrl } from "@/lib/companion";
import { authorizedApiHousehold } from "@/lib/auth/session";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){if(process.env.NODE_ENV==="production")return NextResponse.json({error:"Not found"},{status:404});if (!await authorizedApiHousehold()) return NextResponse.json({error:"Forbidden"},{status:403});const url=req.nextUrl.searchParams.get("url");if(!url)return NextResponse.json({error:"url is required"},{status:400});return NextResponse.json(await getContextForUrl(url));}
