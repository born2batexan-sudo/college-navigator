// Server-only, least-privilege transactional email transport.
// Secrets stay in the deployment environment and are never returned to browsers.

export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

export type EmailDeliveryResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string };

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.DEMO_EMAIL_FROM?.trim());
}

function safeError(status: number, body: unknown): string {
  const code = body && typeof body === "object" && "name" in body && typeof body.name === "string"
    ? body.name.slice(0, 80)
    : "provider_error";
  return `resend_${status}_${code}`;
}

export async function sendTransactionalEmail(input: TransactionalEmail): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.DEMO_EMAIL_FROM?.trim();
  if (!apiKey || !from) return { ok: false, error: "provider_not_configured" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        reply_to: process.env.DEMO_EMAIL_REPLY_TO?.trim() || undefined,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null) as { id?: unknown } | null;
    if (!response.ok) return { ok: false, error: safeError(response.status, body) };
    return { ok: true, providerMessageId: typeof body?.id === "string" ? body.id : null };
  } catch (error) {
    const label = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error";
    return { ok: false, error: `resend_${label}` };
  }
}
