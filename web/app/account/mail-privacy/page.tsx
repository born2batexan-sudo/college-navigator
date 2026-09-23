import Link from 'next/link';
import { requireInvitationHousehold } from '@/lib/auth/session';
import { mailStatus } from '@/lib/mail/service';
import { disconnectMailAction, deleteMailAction } from '../mail-actions';
export const dynamic='force-dynamic';
export default async function MailPrivacyPage({searchParams}:{searchParams:Promise<{mail?:string}>}){
 const ctx=await requireInvitationHousehold();
 const connections=ctx.isOwner&&!ctx.isDemo?await mailStatus({id:ctx.authUserId,email:ctx.email},ctx.household.id):[];
 return <main className="mx-auto max-w-2xl space-y-5 p-6">
  <h1 className="font-display text-2xl">Connected-mail privacy controls</h1>
  <p className="text-sm">These controls remain available when product access or new connections are disabled. Only the signed-in household owner can manage these grants. Removing a connection deletes local tokens and evidence; you may also need to remove the grant in your provider account security settings.</p>
  {ctx.isOwner&&!ctx.isDemo? <>
   {searchParams && (await searchParams).mail && <p role="status">{(await searchParams).mail}</p>}
   {connections.map(c=><div key={c.id} className="rounded border border-line p-3 text-sm"><p>{c.provider==='gmail'?'Gmail':'Microsoft 365'} · {c.status}</p>{c.status!=='revoked'&&<form action={disconnectMailAction}><input type="hidden" name="id" value={c.id}/><button className="mt-2 underline">Disconnect and erase local evidence</button></form>}</div>)}
   <form action={deleteMailAction} className="flex gap-2"><input className="rounded border border-line px-2" name="confirm" aria-label="Type DELETE to confirm" placeholder="Type DELETE"/><button className="rounded border border-urgent/40 px-3 py-2">Delete all connected-mail data</button></form>
   <p className="text-xs">Microsoft: remove the app at <a href="https://myapps.microsoft.com/" className="underline">My Apps</a>. Google: if revocation fails, remove the grant in Google Account security settings.</p>
  </>:<p>Only the household owner can manage mail connections.</p>}
  <Link href="/account" className="underline">Back to account (requires product access)</Link>
 </main>;
}
