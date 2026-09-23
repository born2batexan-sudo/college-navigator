/** Canonical deployment origin for all links sent or displayed by the server. Never trust Host headers. */
export function appOrigin(): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (!configured) throw new Error("APP_ORIGIN must be configured for emailed links.");
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("APP_ORIGIN must be an absolute origin."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    configured !== url.origin || url.username || url.password) {
    throw new Error("APP_ORIGIN must be an HTTPS origin (HTTP only for localhost), without path, credentials, query or fragment.");
  }
  return url.origin;
}
