// Private CampusPassage demo access workflow. This module is server-only.
// It deliberately does not send mail: the adapter persists a safe queue row
// and marks it as waiting for a configured provider. Invitation bearer tokens
// remain transient and hash-only in the database.
import { createHash, createHmac } from "node:crypto";
import { createDemoInvite, revokeDemoInvite } from "./accounts";
import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from "./client";

export const ACCESS_CONSENT_VERSION = "demo-access-2026-09-24-v1";
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const IP_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_IP_WINDOW = 5;

function hashSecret(): string {
  const configured = process.env.REQUEST_ACCESS_HASH_SECRET?.trim();
  if (configured) return configured;
  // Tests and local development remain deterministic. Production must set a
  // deployment secret; submitDemoAccessRequest fails closed if it is absent.
  return "local-only-demo-access-hash-secret";
}
function digest(value: string): string {
  return createHmac("sha256", hashSecret()).update(value).digest("hex");
}
function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}
function validEmail(email: string): boolean {
  return email.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
}
function audit(input: {
  requestId?: string | null;
  eventType: string;
  detailCode: string;
  actorId?: string | null;
  actorEmail?: string | null;
  emailHash?: string | null;
  ipHash?: string | null;
}): Promise<void> {
  return exec(`INSERT INTO demo_access_audit_events
    (id,request_id,event_type,detail_code,actor_id,actor_email,email_hash,ip_hash,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    newId("demoaudit"), input.requestId ?? null, input.eventType, input.detailCode,
    input.actorId ?? null, input.actorEmail ?? null, input.emailHash ?? null, input.ipHash ?? null, nowIso(),
  ]);
}

export type AccessRequestResult = { accepted: true };

/**
 * Notification adapter boundary. A future provider can implement this
 * interface, but the current implementation only writes a queue record.
 * It never stores a raw invite token or claims that delivery occurred.
 */
export interface DemoAccessNotificationAdapter {
  enqueue(input: {
    requestId: string;
    inviteId?: string | null;
    kind: "request_received" | "approved" | "declined" | "revoked";
    recipientEmail: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export const queuedNotificationAdapter: DemoAccessNotificationAdapter = {
  async enqueue(input) {
    await exec(`INSERT INTO demo_access_notifications
      (id,request_id,invite_id,kind,recipient_email,payload_json,delivery_state,attempts,last_error,created_at,sent_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued_no_provider',0,NULL,$7,NULL)
      ON CONFLICT(request_id,kind) DO NOTHING`, [
      newId("demonotify"), input.requestId, input.inviteId ?? null, input.kind,
      normalizedEmail(input.recipientEmail), JSON.stringify(input.payload), nowIso(),
    ]);
  },
};

function requireHashSecretForProduction(): void {
  if (process.env.NODE_ENV === "production" && !process.env.REQUEST_ACCESS_HASH_SECRET?.trim()) {
    throw new Error("REQUEST_ACCESS_HASH_SECRET is required for public access requests.");
  }
}

/**
 * Submits a request while returning the same accepted result for duplicates,
 * rate limits, and already-known addresses. Callers must render a generic
 * response and never reveal which branch occurred.
 */
export async function submitDemoAccessRequest(input: {
  name: string;
  email: string;
  ipAddress?: string | null;
  honeypot?: string | null;
}): Promise<AccessRequestResult> {
  requireHashSecretForProduction();
  const name = normalizedName(input.name);
  const email = normalizedEmail(input.email);
  if (!name || !validEmail(email) || (input.honeypot ?? "").trim()) return { accepted: true };
  const emailHash = digest(email);
  const ip = input.ipAddress?.trim().slice(0, 200) || null;
  const ipHash = ip ? digest(ip) : null;
  const now = nowIso();
  const ipSince = new Date(Date.now() - IP_WINDOW_MS).toISOString();
  const emailSince = new Date(Date.now() - EMAIL_WINDOW_MS).toISOString();

  await withTransaction(async () => {
    if (usingPostgres) {
      await exec("SELECT pg_advisory_xact_lock(hashtext($1))", [`demo-access-email:${emailHash}`]);
      if (ipHash) await exec("SELECT pg_advisory_xact_lock(hashtext($1))", [`demo-access-ip:${ipHash}`]);
    }
    const existing = await queryOne<any>(`SELECT id FROM demo_access_requests
      WHERE requester_email_hash=$1 AND status IN ('pending','approved') LIMIT 1`, [emailHash]);
    if (existing) {
      await audit({ requestId: existing.id, eventType: "request_suppressed", detailCode: "duplicate_active", emailHash, ipHash });
      return;
    }
    if (ipHash) {
      const recentIp = await queryOne<any>(`SELECT COUNT(*) AS n FROM demo_access_requests
        WHERE requester_ip_hash=$1 AND created_at>$2`, [ipHash, ipSince]);
      if (Number(recentIp?.n ?? 0) >= MAX_REQUESTS_PER_IP_WINDOW) {
        await audit({ eventType: "request_suppressed", detailCode: "rate_limited", emailHash, ipHash });
        return;
      }
    }
    const recentEmail = await queryOne<any>(`SELECT COUNT(*) AS n FROM demo_access_requests
      WHERE requester_email_hash=$1 AND created_at>$2`, [emailHash, emailSince]);
    if (Number(recentEmail?.n ?? 0) >= 1) {
      await audit({ eventType: "request_suppressed", detailCode: "rate_limited", emailHash, ipHash });
      return;
    }
    const id = newId("demoaccess");
    await exec(`INSERT INTO demo_access_requests
      (id,requester_name,requester_email,requester_email_hash,requester_ip_hash,consent_version,consented_at,status,invite_id,decided_at,decided_by,decided_email,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending',NULL,NULL,NULL,NULL,$8,$9)`,
      [id, name, email, emailHash, ipHash, ACCESS_CONSENT_VERSION, now, now, now]);
    await audit({ requestId: id, eventType: "request_submitted", detailCode: "accepted", emailHash, ipHash });
  });
  return { accepted: true };
}

export type DemoAccessRequest = {
  id: string;
  requesterName: string;
  requesterEmail: string;
  status: "pending" | "approved" | "declined" | "revoked";
  inviteId: string | null;
  inviteAccepted: boolean;
  inviteExpiresAt: string | null;
  createdAt: string;
  decidedAt: string | null;
};

function toAccessRequest(row: any): DemoAccessRequest {
  return {
    id: row.id, requesterName: row.requester_name, requesterEmail: row.requester_email,
    status: row.status, inviteId: row.invite_id ?? null, inviteAccepted: !!row.invite_accepted,
    inviteExpiresAt: row.invite_expires_at ?? null, createdAt: row.created_at, decidedAt: row.decided_at ?? null,
  };
}

export async function listDemoAccessRequests(): Promise<DemoAccessRequest[]> {
  const rows = await queryRows<any>(`SELECT r.id,r.requester_name,r.requester_email,r.status,r.invite_id,
    r.created_at,r.decided_at, i.accepted_at IS NOT NULL AS invite_accepted, i.expires_at AS invite_expires_at
    FROM demo_access_requests r LEFT JOIN demo_invites i ON i.id=r.invite_id
    ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END,r.created_at DESC`);
  return rows.map(toAccessRequest);
}

export type AccessDecision =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; reason: "not_pending" | "missing_template" };

export async function approveDemoAccessRequest(input: {
  requestId: string;
  actor: { id: string; email: string };
}): Promise<AccessDecision> {
  return withTransaction(async () => {
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const request = await queryOne<any>(`SELECT * FROM demo_access_requests WHERE id=$1${lock}`, [input.requestId]);
    if (!request || request.status !== "pending") return { ok: false, reason: "not_pending" };
    const made = await createDemoInvite({ createdBy: input.actor.id, createdEmail: input.actor.email });
    const invite = await queryOne<any>("SELECT id FROM demo_invites WHERE token_hash=$1", [hashToken(made.token)]);
    if (!invite) return { ok: false, reason: "missing_template" };
    const now = nowIso();
    await exec("UPDATE demo_invites SET access_request_id=$1 WHERE id=$2", [request.id, invite.id]);
    await exec(`UPDATE demo_access_requests SET status='approved',invite_id=$1,decided_at=$2,decided_by=$3,decided_email=$4,updated_at=$5 WHERE id=$6`,
      [invite.id, now, input.actor.id, normalizedEmail(input.actor.email), now, request.id]);
    await audit({ requestId: request.id, eventType: "request_decided", detailCode: "approved", actorId: input.actor.id, actorEmail: normalizedEmail(input.actor.email), emailHash: request.requester_email_hash });
    await queuedNotificationAdapter.enqueue({ requestId: request.id, inviteId: invite.id, kind: "approved", recipientEmail: request.requester_email, payload: { type: "private_preview_invitation", expiresAt: made.expiresAt, delivery: "manual_link_required" } });
    return { ok: true, token: made.token, expiresAt: made.expiresAt };
  });
}

export async function declineDemoAccessRequest(input: { requestId: string; actor: { id: string; email: string } }): Promise<boolean> {
  return withTransaction(async () => {
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const request = await queryOne<any>(`SELECT * FROM demo_access_requests WHERE id=$1${lock}`, [input.requestId]);
    if (!request || request.status !== "pending") return false;
    const now = nowIso();
    await exec("UPDATE demo_access_requests SET status='declined',decided_at=$1,decided_by=$2,decided_email=$3,updated_at=$4 WHERE id=$5", [now, input.actor.id, normalizedEmail(input.actor.email), now, request.id]);
    await audit({ requestId: request.id, eventType: "request_decided", detailCode: "declined", actorId: input.actor.id, actorEmail: normalizedEmail(input.actor.email), emailHash: request.requester_email_hash });
    await queuedNotificationAdapter.enqueue({ requestId: request.id, kind: "declined", recipientEmail: request.requester_email, payload: { type: "private_preview_decision", decision: "declined" } });
    return true;
  });
}

export async function revokeDemoAccessRequest(input: { requestId: string; actor: { id: string; email: string } }): Promise<boolean> {
  return withTransaction(async () => {
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const request = await queryOne<any>(`SELECT * FROM demo_access_requests WHERE id=$1${lock}`, [input.requestId]);
    if (!request || request.status !== "approved" || !request.invite_id) return false;
    const invite = await queryOne<any>(`SELECT id,accepted_at FROM demo_invites WHERE id=$1${lock}`, [request.invite_id]);
    if (!invite || invite.accepted_at) return false;
    const revoked = await revokeDemoInvite(request.invite_id, { id: input.actor.id, email: input.actor.email });
    if (!revoked) return false;
    const now = nowIso();
    await exec("UPDATE demo_access_requests SET status='revoked',decided_at=$1,decided_by=$2,decided_email=$3,updated_at=$4 WHERE id=$5", [now, input.actor.id, normalizedEmail(input.actor.email), now, request.id]);
    await audit({ requestId: request.id, eventType: "request_decided", detailCode: "revoked", actorId: input.actor.id, actorEmail: normalizedEmail(input.actor.email), emailHash: request.requester_email_hash });
    await queuedNotificationAdapter.enqueue({ requestId: request.id, inviteId: request.invite_id, kind: "revoked", recipientEmail: request.requester_email, payload: { type: "private_preview_decision", decision: "revoked" } });
    return true;
  });
}
