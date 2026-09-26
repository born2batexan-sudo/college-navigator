import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { safeNext, supabaseConfigured } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

/**
 * Where Google/Microsoft/Apple/Yahoo and the email link send the person back.
 * Trades the one-time code for a session cookie, then goes to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");

  if (code && supabaseConfigured) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  const fail = new URL("/login", origin);
  fail.searchParams.set("error", "That sign-in link did not work. It may have expired or been opened on a different device. Please try again.");
  return NextResponse.redirect(fail);
}
