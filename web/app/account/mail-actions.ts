'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireHousehold, requireInvitationHousehold } from '@/lib/auth/session';
import { appOrigin } from '@/lib/auth/origin';
import { beginMailConsent, deleteMailData, disconnectMail, runMailSync } from '@/lib/mail/service';
import { configured } from '@/lib/mail/provider';
import type { MailProvider } from '@/lib/db/connected-mail';

async function originCheck(){ if((await headers()).get('origin')!==appOrigin())throw new Error('Invalid request origin'); }
const location=(message:string)=>`/account?mail=${encodeURIComponent(message)}`;
const privacyLocation=(message:string)=>`/account/mail-privacy?mail=${encodeURIComponent(message)}`;
export async function connectMail(form:FormData):Promise<void>{
 await originCheck();
 const ctx=await requireHousehold();
 const p=form.get('provider');
 if(p!=='gmail'&&p!=='microsoft'||!ctx.isOwner||ctx.isDemo)throw new Error('Mail owner required');
 const provider=p as MailProvider;
 if(!configured(provider)||form.get('consent')!=='yes')redirect(location('Review and approve the provider-specific mail consent.'));
 const {state,url}=await beginMailConsent({id:ctx.authUserId,email:ctx.email},ctx.household.id,provider,true);
 (await cookies()).set(`mail_oauth_${provider}`,state,{httpOnly:true,secure:appOrigin().startsWith('https:'),sameSite:'lax',path:'/api/mail/callback',maxAge:600});
 redirect(url);
}
export async function syncMail(form:FormData):Promise<void>{
 await originCheck();const ctx=await requireHousehold();
 try {await runMailSync({id:ctx.authUserId,email:ctx.email},ctx.household.id,String(form.get('id')??''));}
 catch {redirect(location('Sync unavailable. Check connection status and try later.'));}
 redirect(location('Sync complete. Only minimal sender evidence is retained.'));
}
export async function disconnectMailAction(form:FormData):Promise<void>{
 await originCheck();const ctx=await requireInvitationHousehold();
 try {const result=await disconnectMail({id:ctx.authUserId,email:ctx.email},ctx.household.id,String(form.get('id')??''));
  redirect(privacyLocation(result==='revoked'?'Disconnected and Google grant revoked.':'Disconnected locally. Remove the app grant in your provider security settings.'));
 }catch(e){if(e && typeof e==='object' && 'digest' in e)throw e;redirect(privacyLocation('Disconnect failed; check status before retrying.'));}
}
export async function deleteMailAction(form:FormData):Promise<void>{
 await originCheck();const ctx=await requireInvitationHousehold();
 if(form.get('confirm')!=='DELETE')redirect(privacyLocation('Type DELETE to remove connected-mail data.'));
 const results=await deleteMailData({id:ctx.authUserId,email:ctx.email},ctx.household.id);
 redirect(privacyLocation(results.some(r=>r!=='revoked')?'Mail data removed locally. Check provider security settings to remove any remaining grant.':'Connected-mail data deleted.'));
}
