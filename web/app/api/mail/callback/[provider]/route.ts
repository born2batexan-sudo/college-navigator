import { NextRequest, NextResponse } from 'next/server';
import { authorizedApiHousehold } from '@/lib/auth/session';
import { appOrigin } from '@/lib/auth/origin';
import { configured } from '@/lib/mail/provider';
import { finishMailConsent } from '@/lib/mail/service';
import type { MailProvider } from '@/lib/db/connected-mail';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:Promise<{provider:string}>}){
 const {provider}=await params;
 const origin=appOrigin(), url=new URL(request.url);
 const p=provider==='gmail'||provider==='microsoft'?provider as MailProvider:null;
 const result=(message:string)=>{const r=NextResponse.redirect(`${origin}/account?mail=${encodeURIComponent(message)}`,303);
  if(p)r.cookies.delete(`mail_oauth_${p}`);r.headers.set('Cache-Control','no-store');return r;};
 if(!p||!configured(p)||url.origin!==origin||url.pathname!==`/api/mail/callback/${p}`)return result('Mail callback unavailable.');
 const state=url.searchParams.get('state'),code=url.searchParams.get('code');
 if(!state||state!==request.cookies.get(`mail_oauth_${p}`)?.value||!code||url.searchParams.has('error'))return result('Mail consent not completed.');
 const ctx=await authorizedApiHousehold();if(!ctx)return result('Sign in again to complete mail consent.');
 try {await finishMailConsent({id:ctx.authUserId,email:ctx.email},p,state,code);return result('Mail connected. You can sync approved senders when ready.');}
 catch {return result('Mail connection failed. Review consent and retry.');}
}
