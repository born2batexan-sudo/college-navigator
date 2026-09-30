export const APPLICATION_SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests",
} as const;

export const PRIVATE_NO_STORE = "private, no-cache, no-store, max-age=0, must-revalidate";
export const NO_STORE = "no-store";

/** Methods not used by this app; GET/HEAD/POST/OPTIONS remain available to Next. */
const UNSUPPORTED_METHODS = new Set(["CONNECT", "DELETE", "PATCH", "PUT", "TRACE"]);

export function isUnsupportedApplicationMethod(method: string): boolean {
  return UNSUPPORTED_METHODS.has(method.toUpperCase());
}
