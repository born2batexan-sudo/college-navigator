import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "./supabase-server";
import { DEV_COOKIE, devLoginEnabled, supabaseConfigured } from "./env";
import { ensureAccountSchema, isDemoOwnerEmail, provisionAccount, requireWritableHousehold as assertWritableHousehold, requireWritableOnboardedHousehold as assertWritableOnboardedHousehold, type HouseholdContext } from "@/lib/db/accounts";
import type { Student } from "@/lib/db/types";

export type SessionUser = { id: string; email: string | null };

/** The signed-in user for this request, or null. Verified with Supabase, never trusted from a cookie alone. */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (devLoginEnabled) {
    const email = (await cookies()).get(DEV_COOKIE)?.value;
    if (email && /^[^\s@]+@[^\s@]+$/.test(email)) {
      return { id: `dev_${createHash("sha1").update(email.toLowerCase()).digest("hex").slice(0, 16)}`, email: email.toLowerCase() };
    }
    return null;
  }
  if (!supabaseConfigured) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email.toLowerCase() : null;
  return { id: data.claims.sub, email };
}

/** Redirects to the sign-in page when nobody is signed in. */
export async function requireUser(opts?: { next?: string }): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const next = opts?.next && opts.next !== "/" ? `?next=${encodeURIComponent(opts.next)}` : "";
    redirect(`/login${next}`);
  }
  return user;
}

/**
 * The starting point for every signed-in page and action: who is signed in,
 * and which household they belong to (created empty on first sign-in).
 * Never look up a household any other way.
 */
export async function requireHousehold(opts?: { next?: string }): Promise<HouseholdContext> {
  const user = await requireUser(opts);
  await ensureAccountSchema();
  return provisionAccount({ authUserId: user.id, email: user.email });
}

/** Like requireHousehold, but sends brand-new accounts to finish setup first. */
export async function requireOnboardedHousehold(): Promise<HouseholdContext & { student: Student }> {
  const ctx = await requireHousehold();
  if (!ctx.student) redirect("/onboarding");
  return ctx as HouseholdContext & { student: Student };
}

/** Signed-in household write gates. Reads continue to use the normal helpers. */
export async function requireWritableHousehold(opts?: { next?: string }): Promise<HouseholdContext> {
  const ctx = await requireHousehold(opts);
  return assertWritableHousehold(ctx);
}

export async function requireWritableOnboardedHousehold(): Promise<HouseholdContext & { student: Student }> {
  const ctx = await requireOnboardedHousehold();
  return assertWritableOnboardedHousehold(ctx);
}

/** Private-preview administration is intentionally fail-closed. */
export async function requireDemoOwner(): Promise<SessionUser> {
  const user = await requireUser({ next: "/admin/demo" });
  if (!isDemoOwnerEmail(user.email)) notFound();
  await ensureAccountSchema();
  return user;
}

/** The address the browser used to reach us (works on preview and production URLs alike). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
