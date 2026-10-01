import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, supabaseConfigured } from "./env";

type AuthAdmin = Pick<ReturnType<typeof createClient>["auth"]["admin"], "getUserById" | "deleteUser">;

/** No household/app records may be removed without a working admin credential
 * for this exact signed-in identity. Never log or send this credential to the browser. */
export function accountDeletionAdmin(): AuthAdmin {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseConfigured || !key) throw new Error("Account deletion is temporarily unavailable. Your data has not been deleted; contact support.");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}

export async function preflightOwnAuthDeletion(admin: AuthAdmin, id: string, email: string | null): Promise<void> {
  if (!id || !email) throw new Error("Unable to verify your sign-in identity; no data was deleted.");
  const { data, error } = await admin.getUserById(id);
  if (error || !data.user || data.user.id !== id || data.user.email?.trim().toLowerCase() !== email.trim().toLowerCase())
    throw new Error("Unable to verify your sign-in identity; no data was deleted.");
}

/** Called only after household/member data is removed. Failure is never a successful deletion. */
export async function deleteOwnAuthUser(admin: AuthAdmin, id: string): Promise<void> {
  const { error } = await admin.deleteUser(id);
  if (error) throw new Error("Sign-in cleanup did not complete.");
  const verification = await admin.getUserById(id);
  // Supabase Auth returns HTTP 404 for a deleted identity; any other response
  // (including a provider outage) is not proof of a completed deletion.
  if (verification.error?.status !== 404) throw new Error("Sign-in cleanup could not be verified.");
}
