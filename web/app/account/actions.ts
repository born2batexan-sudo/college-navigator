"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountDeletionAdmin, deleteOwnAuthUser, preflightOwnAuthDeletion } from "@/lib/auth/account-deletion";
import { requireHousehold, requireUser, requireWritableHousehold } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { DEV_COOKIE, devLoginEnabled, supabaseConfigured } from "@/lib/auth/env";
import { addStudentProfile, createInvite, deleteHousehold, getPurchaserAttestation, removeMember } from "@/lib/db/accounts";
import { isStartTerm } from "@/lib/terms";
import { mailEnabled } from '@/lib/mail/provider';
import { deleteMailData, mailStatus } from '@/lib/mail/service';

async function endSession() {
  if (devLoginEnabled) (await cookies()).delete(DEV_COOKIE);
  else if (supabaseConfigured) await (await createSupabaseServerClient()).auth.signOut();
}

export async function signOut(): Promise<void> {
  await requireUser();
  await endSession();
  redirect("/login");
}

/** Adds an independent profile to the signed-in household; no surname proof is collected. */
export async function addStudent(formData: FormData): Promise<void> {
  const ctx = await requireWritableHousehold();
  const name = String(formData.get("studentName") ?? "").trim();
  const enteringTerm = String(formData.get("enteringTerm") ?? "");
  const attested = formData.get("purchaserAttested") === "yes";
  if (!name || name.length > 60 || !isStartTerm(enteringTerm)) redirect("/account?error=" + encodeURIComponent("Enter a first or preferred name and a valid start term."));
  const hasAttestation = await getPurchaserAttestation(ctx.household.id);
  if (!hasAttestation && !attested) redirect("/account?error=" + encodeURIComponent("Confirm authorization to manage this household plan before adding a student."));
  let student;
  try {
    student = await addStudentProfile(ctx, { name, enteringTerm, purchaserAttested: attested });
  } catch (error) {
    redirect("/account?error=" + encodeURIComponent(error instanceof Error ? error.message : "Could not add the student."));
  }
  // Next.js implements redirect by throwing; keep it outside the domain-error
  // catch so a successful add never renders NEXT_REDIRECT as an error.
  redirect(`/welcome?student=${encodeURIComponent(student.id)}`);
}

/** Makes a one-time link the family can send to the other parent or the student. */
export async function makeInvite(formData: FormData): Promise<void> {
  const ctx = await requireWritableHousehold();
  const role = formData.get("role") === "student" ? "student" : "parent";
  const result = await createInvite(ctx, role);
  if (!result.ok) redirect("/account?error=" + encodeURIComponent("You already have 5 open invites. Wait for one to be used or expire."));
  redirect(`/account?invite=${result.token}`);
}

/**
 * Deletes the account. The plan's owner deletes the whole family plan and
 * its data (other members keep their own sign-in but lose access to it);
 * any other member only removes themself.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const ctx = await requireWritableHousehold();
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    redirect("/account?error=" + encodeURIComponent("Type DELETE to confirm."));
  }
  // Auth-admin preflight must happen BEFORE any app/mail data is destroyed.
  // Missing or wrong-project credentials leave the account intact and usable.
  let admin;
  try {
    admin = accountDeletionAdmin();
    await preflightOwnAuthDeletion(admin, ctx.authUserId, ctx.email);
  } catch {
    redirect("/account?error=" + encodeURIComponent("Account deletion is temporarily unavailable. Your data has not been deleted; contact support."));
  }
  if (ctx.isOwner) {
    if (mailEnabled() || (await mailStatus({id:ctx.authUserId,email:ctx.email},ctx.household.id)).some(c=>c.status!=='revoked'))
      await deleteMailData({id:ctx.authUserId,email:ctx.email},ctx.household.id);
    await deleteHousehold(ctx.household.id);
  }
  else await removeMember(ctx);
  try {
    await deleteOwnAuthUser(admin, ctx.authUserId);
  } catch (error) {
    // External Auth deletion cannot be made atomic with the app database.
    // Surface partial cleanup honestly and flag it for operator follow-up.
    console.error("[account] Auth deletion incomplete after app data removal", error);
    await endSession();
    redirect("/login?deletion=pending");
  }
  await endSession();
  redirect("/login?deleted=1");
}
