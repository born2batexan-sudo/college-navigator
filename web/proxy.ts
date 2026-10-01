import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  DEV_COOKIE,
  SUPABASE_KEY,
  SUPABASE_URL,
  devLoginEnabled,
  isPublicPath,
  supabaseConfigured,
} from "@/lib/auth/env";
import { isApplicationProtectedPath } from "@/lib/auth/protected-routes";
import { canonicalPreviewLocation } from "@/lib/auth/origin";
import { APPLICATION_SECURITY_HEADERS, NO_STORE, PRIVATE_NO_STORE, isUnsupportedApplicationMethod } from "@/lib/security-headers";

function addSecurityHeaders(response: NextResponse): void {
  for (const [name, value] of Object.entries(APPLICATION_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = isPublicPath(pathname);
  const isProtected = !isPublic && isApplicationProtectedPath(pathname);
  const isUnknownPath = !isPublic && !isProtected;
  const response = NextResponse.next({ request });

  addSecurityHeaders(response);
  // Household responses, API responses, and app-level 404s must never be cached.
  if (isProtected || isUnknownPath || pathname.startsWith("/api/") || pathname === "/login") {
    response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  }

  // Do not let unsupported verbs reach a Server Action or route handler. Next's
  // supported GET/HEAD/POST/OPTIONS handling remains intact. Hosting platforms
  // may reject TRACE before this application proxy gets a chance to run.
  if (isUnsupportedApplicationMethod(request.method)) {
    const rejected = NextResponse.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: {
          ...APPLICATION_SECURITY_HEADERS,
          "Cache-Control": NO_STORE,
          Allow: "GET, HEAD, POST, OPTIONS",
        },
      },
    );
    return rejected;
  }

  // Sign-in uses a host-only Supabase PKCE verifier cookie. Normalize protected
  // Preview page visits and the login form onto its allowlisted branch alias
  // before an auth request can start. Never forward auth-response material.
  const hasAuthResponseMaterial = ["code", "token_hash", "access_token", "refresh_token"]
    .some((key) => request.nextUrl.searchParams.has(key));
  if ((request.method === "GET" || request.method === "HEAD") &&
    (pathname === "/login" || isProtected) && !hasAuthResponseMaterial) {
    const canonicalLocation = canonicalPreviewLocation(request.nextUrl);
    if (canonicalLocation) {
      const canonicalRedirect = NextResponse.redirect(canonicalLocation, 307);
      addSecurityHeaders(canonicalRedirect);
      canonicalRedirect.headers.set("Cache-Control", PRIVATE_NO_STORE);
      return canonicalRedirect;
    }
  }

  if (isPublic || !isProtected) return response;

  let signedIn = false;
  if (devLoginEnabled) {
    signedIn = !!request.cookies.get(DEV_COOKIE)?.value;
  } else if (supabaseConfigured) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, cacheHeaders) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [name, value] of Object.entries(cacheHeaders)) response.headers.set(name, value);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims?.sub;
  }

  if (signedIn) return response;

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + request.nextUrl.search)}` : "";
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  addSecurityHeaders(redirect);
  redirect.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
