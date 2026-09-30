/** Server-side administrator allowlist. ADMIN_EMAILS accepts comma/newline-separated
 * addresses; DEMO_OWNER_EMAIL remains supported as the primary/legacy owner address.
 * Matching is exact after trimming and case normalization, and an empty allowlist fails closed. */
export function administratorEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = [env.DEMO_OWNER_EMAIL ?? "", env.ADMIN_EMAILS ?? ""]
    .flatMap((value) => value.split(/[\n,]/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(configured)];
}

export function isAdministratorEmail(email: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalized = email?.trim().toLowerCase();
  return !!normalized && administratorEmails(env).includes(normalized);
}
