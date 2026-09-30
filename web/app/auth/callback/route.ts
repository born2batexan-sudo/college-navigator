import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { safeNext, supabaseConfigured } from "@/lib/auth/env";
import { callbackLoginLocation, isNoCodeSignupReturn } from "@/lib/auth/callback";

export const dynamic = "force-dynamic";

/**
 * Where Google/Microsoft/Apple/Yahoo and the email link send the person back.
 * Trades a valid one-time PKCE code for a session cookie, then goes to `next`.
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

  // A first-time signup confirmation can return without a PKCE code. Explain
  // that distinction without treating it as authentication or exposing its
  // query parameters. All other missing/failed-code returns remain generic.
  return NextResponse.redirect(
    callbackLoginLocation(origin, next, isNoCodeSignupReturn(searchParams)),
  );
}
