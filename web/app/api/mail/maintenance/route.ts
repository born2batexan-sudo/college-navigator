import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appOrigin } from '@/lib/auth/origin';
import { purgeMailRetention } from '@/lib/mail/service';
export const dynamic='force-dynamic';
/** Scheduler-only. Never accepts browser credentials or mailbox payloads. */
export async function POST(request:NextRequest){
 const secret=process.env.MAIL_MAINTENANCE_SECRET;
 const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
 const a=Buffer.from(secret??''),b=Buffer.from(supplied);
 if(!secret||a.length<32||a.length!==b.length||!timingSafeEqual(a,b)||new URL(request.url).origin!==appOrigin())
  return new NextResponse(null,{status:404,headers:{'Cache-Control':'no-store'}});
 await purgeMailRetention();
 return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
