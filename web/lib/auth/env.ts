// Sign-in configuration. Safe to import from middleware (no Node-only imports).

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the Supabase project settings are present. */
export const supabaseConfigured = !!SUPABASE_URL && !!SUPABASE_KEY;

/**
 * Local-only shortcut so the app can be run and tested without a Supabase
 * project. It can never be switched on in a production build, whatever the
 * environment variables say.
 */
export const devLoginEnabled = process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "1";
export const DEV_COOKIE = "cn_dev_user";

/**
 * How the email sign-in works. Supabase's built-in mail cannot change the
 * email text, so its message holds only a link (opens on the same browser
 * that asked for it). Once custom mail is set up and the emails are edited
 * to show a 6-digit code, set AUTH_EMAIL_CODE=1 to show the code box too,
 * which also works when the email is opened on a different device.
 */
export const emailCodeEnabled = process.env.AUTH_EMAIL_CODE === "1";

export const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  azure: "Microsoft",
  apple: "Apple",
  "custom:yahoo": "Yahoo",
};

/**
 * One-tap providers to show on the sign-in page. Off by default; turn each
 * on (comma separated, e.g. "google,azure") only after its developer account
 * and Supabase settings exist, so no button ever leads to an error page.
 */
export const enabledProviders: string[] = (process.env.AUTH_PROVIDERS ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p in PROVIDER_LABELS);

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.includes("\n") || next.includes("\r")) return "/";
  return next;
}

/** Paths that never require sign-in. Everything else does (deny by default). */
export const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/auth/",
  "/api/agent/", // machine callers; each route checks its own bearer key
  "/api/companion/", // browser extension; pinned to the demo household only
  "/api/debug/", // retired stub, always 404
  "/_next/",
  "/favicon.ico",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}
