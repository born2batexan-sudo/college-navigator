"use server";
import { redirect } from 'next/navigation';
import { requireHousehold } from '@/lib/auth/session';
import { claimComplimentaryInvite } from '@/lib/db/cycle-access';

export async function claimAccess(form:FormData):Promise<void> {
 const ctx=await requireHousehold(); if(!ctx.isOwner || ctx.isDemo) throw new Error('Owner required');
 await claimComplimentaryInvite({token:String(form.get('token')??''),householdId:ctx.household.id,authUserId:ctx.authUserId});
 redirect('/account?access=claimed');
}
export async function startCheckout():Promise<void> {
 throw new Error('Checkout disabled for the no-payment release');
}
