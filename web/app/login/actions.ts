"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requestOrigin } from "@/lib/auth/session";
import { DEV_COOKIE, devLoginEnabled, enabledProviders, safeNext, supabaseConfigured } from "@/lib/auth/env";

// These are the only server actions that run without a signed-in user,
// because signing in is their whole job.

const emailSchema = z.string().trim().toLowerCase().email().max(200);

function back(params: Record<string, string>): never {
  redirect(`/login?${new URLSearchParams(params).toString()}`);
}

/** Step 1 of email sign-in: send a 6-digit code (and a same-device link). */
export async function sendEmailCode(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) back({ error: "Enter a valid email address.", next });
  if (!supabaseConfigured) back({ error: "Sign-in is not set up yet.", next });

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true, emailRedirectTo: `${requestOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    const msg = /rate|limit|seconds/i.test(error.message)
      ? "Too many attempts. Please wait a minute and try again."
      : "We could not send the email. Check the address and try again.";
    back({ error: msg, next });
  }
  back({ step: "code", email: parsed.data, next });
}

/** Step 2: the person types the code from the email. Works on any device. */
export async function verifyEmailCode(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const email = emailSchema.safeParse(formData.get("email"));
  const token = String(formData.get("code") ?? "").replace(/\s+/g, "");
  if (!email.success) back({ error: "Enter a valid email address.", next });
  if (!/^\d{6,10}$/.test(token)) back({ step: "code", email: email.data, error: "Enter the code from the email.", next });

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token, type: "email" });
  if (error) back({ step: "code", email: email.data, error: "That code did not work. It may have expired. Request a new one.", next });
  redirect(next);
}

/** One-tap sign-in with an outside account (Google, Microsoft, Apple, Yahoo). */
export async function signInWithProvider(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const provider = String(formData.get("provider") ?? "");
  if (!enabledProviders.includes(provider)) back({ error: "That sign-in option is not available.", next });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as any,
    options: {
      redirectTo: `${requestOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
      ...(provider === "azure" ? { scopes: "email" } : {}),
    },
  });
  if (error || !data?.url) back({ error: "We could not start that sign-in. Please try again.", next });
  redirect(data.url);
}

/** Local development only (see devLoginEnabled). Does nothing in production. */
export async function devSignIn(formData: FormData): Promise<void> {
  if (!devLoginEnabled) back({ error: "That sign-in option is not available." });
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) back({ error: "Enter a valid email address." });
  cookies().set(DEV_COOKIE, email.data, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(safeNext(formData.get("next")));
}
