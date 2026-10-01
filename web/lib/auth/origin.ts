/** Canonical deployment origin for all links sent or displayed by the server. Never trust Host headers. */
function parseAppOrigin(configured: string): URL {
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("APP_ORIGIN must be an absolute origin."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    configured !== url.origin || url.username || url.password) {
    throw new Error("APP_ORIGIN must be an HTTPS origin (HTTP only for localhost), without path, credentials, query or fragment.");
  }
  return url;
}

export function appOrigin(): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) throw new Error("APP_ORIGIN must be configured for emailed links.");
  return parseAppOrigin(configured).origin;
}

const PROTECTED_REVIEW_BRANCH = "review/mvp-school-research-queue";
const PROTECTED_REVIEW_ORIGIN = "https://college-navigator-git-review-mvp-school-research-queue-j-dock.vercel.app";

/**
 * The protected branch has one allowlisted Preview origin for Supabase PKCE.
 * Immutable Vercel deployment URLs must arrive there before a sign-in starts,
 * otherwise the host-only verifier cookie would not accompany the callback.
 * This applies only to GET/HEAD routing on that exact Preview branch; never
 * redirect Production or another preview branch to the review alias.
 */
export function canonicalPreviewLocation(
  currentUrl: URL,
  deploymentEnvironment = process.env.VERCEL_ENV,
  gitRef = process.env.VERCEL_GIT_COMMIT_REF,
  configuredOrigin = process.env.APP_ORIGIN,
): URL | null {
  if (deploymentEnvironment !== "preview" || gitRef !== PROTECTED_REVIEW_BRANCH || !configuredOrigin?.trim()) return null;
  const origin = parseAppOrigin(configuredOrigin.trim()).origin;
  if (origin !== PROTECTED_REVIEW_ORIGIN) {
    throw new Error("Protected Preview APP_ORIGIN must match the allowlisted review-branch origin.");
  }
  if (currentUrl.origin === origin) return null;

  const destination = new URL(origin);
  destination.pathname = currentUrl.pathname;
  destination.search = currentUrl.search;
  return destination;
}
