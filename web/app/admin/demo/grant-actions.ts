"use server";
import { revalidatePath } from 'next/cache';
import { requireDemoOwner } from '@/lib/auth/session';
import { grantComplimentary, issueComplimentaryInvite, revokeComplimentary } from '@/lib/db/cycle-access';
export type GrantState={message:string;token:string|null};
export async function manageComplimentary(_prior:GrantState,form:FormData):Promise<GrantState> {
 const actor=await requireDemoOwner();
 const householdId=String(form.get('householdId')??'').trim(), reason=String(form.get('reason')??'').trim(), operation=String(form.get('operation')??'');
 try {
  const identity={id:actor.id,email:actor.email!};
  if(operation==='revoke') await revokeComplimentary({householdId,actor:identity,reason});
  else if(operation==='grant') await grantComplimentary({householdId,actor:identity,reason,idempotencyKey:crypto.randomUUID()});
  else if(operation==='invite' || operation==='founding_family') {
   const result=await issueComplimentaryInvite({householdId,actor:identity,reason,kind:operation==='invite'?'complimentary':'founding_family'});
   revalidatePath('/admin/demo');return {message:`Issued; expires ${result.expiresAt}. Share only with the intended household owner.`,token:result.token};
  } else throw new Error('Invalid operation');
  revalidatePath('/admin/demo');return {message:'Recorded. No payment or provider delivery was initiated.',token:null};
 } catch(e){return {message:e instanceof Error?e.message:'Operation unavailable',token:null};}
}
