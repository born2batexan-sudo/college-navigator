const MAX_BYTES = 2048;
export type AskPayload = { studentId: string; question: string };
export class AskRequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }

/** Enforce a real byte limit even when Content-Length is absent or untrusted. */
export async function parseAskRequest(request: Request): Promise<AskPayload> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AskRequestError(415, 'JSON required');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) throw new AskRequestError(413, 'Too large');
  const reader = request.body?.getReader();
  if (!reader) throw new AskRequestError(400, 'Missing body');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new AskRequestError(413, 'Too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AskRequestError(400, 'Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'question,studentId') throw new AskRequestError(400, 'Invalid question');
  const payload = body as Record<string, unknown>;
  if (typeof payload.studentId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.studentId) ||
    typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 500 || /[\x00-\x08\x0e-\x1f]/.test(payload.question)) throw new AskRequestError(400, 'Invalid question');
  return payload as AskPayload;
}
