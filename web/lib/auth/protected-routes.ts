/**
 * App routes that intentionally contain private household data or operations.
 * Unknown paths must reach Next's 404 rather than being turned into login redirects.
 * Keep this list aligned with app route-guard tests.
 */
const PROTECTED_EXACT_PATHS = new Set([
  "/account",
  "/account/mail-privacy",
  "/admin/demo",
  "/api/ask",
  "/api/companion/context",
  "/api/companion/observe",
  "/ask/research",
  "/dashboard",
  "/intake",
  "/onboarding",
  "/request",
  "/review-lab",
  "/welcome",
]);

const PROTECTED_DYNAMIC_PATHS = [
  /^\/access\/[^/]+$/,
  /^\/action\/[^/]+$/,
  /^\/demo\/[^/]+$/,
  /^\/invite\/[^/]+$/,
  /^\/school\/[^/]+$/,
];

export function isApplicationProtectedPath(pathname: string): boolean {
  return PROTECTED_EXACT_PATHS.has(pathname) || PROTECTED_DYNAMIC_PATHS.some((pattern) => pattern.test(pathname));
}
