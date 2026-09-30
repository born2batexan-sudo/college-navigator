import { safeNext } from "./env";

const CALLBACK_ERRORS = ["error", "error_code", "error_description"] as const;

/**
 * A first-time Supabase signup confirmation can return without an exchangeable
 * PKCE code. Recognize only the explicit signup type and never treat that
 * return as authentication.
 */
export function isNoCodeSignupReturn(params: URLSearchParams): boolean {
  return !params.has("code") &&
    params.get("type") === "signup" &&
    !CALLBACK_ERRORS.some((name) => params.has(name));
}

/** Build a same-origin, token-free return to the sign-in form after callback failure. */
export function callbackLoginLocation(origin: string, next: unknown, confirmationReturn: boolean): URL {
  const login = new URL("/login", origin);
  login.searchParams.set("next", safeNext(next));
  if (confirmationReturn) {
    login.searchParams.set("notice", "email-confirmation");
  } else {
    login.searchParams.set(
      "error",
      "That callback did not sign you in. If you just confirmed a new email address, confirmation may have completed, but you still need to request a sign-in email below. Otherwise, request a fresh sign-in link and open it in the same browser.",
    );
  }
  return login;
}
