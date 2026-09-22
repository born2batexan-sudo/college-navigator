"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { requireHousehold, requireUser, requireWritableHousehold } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { DEV_COOKIE, SUPABASE_URL, devLoginEnabled, supabaseConfigured } from "@/lib/auth/env";
import { addStudentProfile, createInvite, deleteHousehold, getPurchaserAttestation, removeMember } from "@/lib/db/accounts";
import { isStartTerm } from "@/lib/terms";

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
  try {
    const student = await addStudentProfile(ctx, { name, enteringTerm, purchaserAttested: attested });
    redirect(`/welcome?student=${encodeURIComponent(student.id)}`);
  } catch (error) {
    redirect("/account?error=" + encodeURIComponent(error instanceof Error ? error.message : "Could not add the student."));
  }
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
 * Deletes the signed-in person's sign-in record, using the project's secret
 * service key. Returns false when that key is not configured.
 */
async function deleteSignInRecords(authUserIds: string[]): Promise<boolean> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured || !serviceKey) return false;
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const id of authUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("[account] could not delete sign-in record", id, error.message);
  }
  return true;
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
  if (ctx.isOwner) await deleteHousehold(ctx.household.id);
  else await removeMember(ctx);
  await endSession();
  await deleteSignInRecords([ctx.authUserId]);
  redirect("/login?deleted=1");
}
