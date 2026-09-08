export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Very small glob matcher: "*" matches any run of characters. Good enough for host/path patterns like "housing.sl.ua.edu/*". */
export function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

export function domainMatches(domains: string[], hostname: string): boolean {
  return domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}
