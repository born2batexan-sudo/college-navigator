// Public request approvals are distinct from the owner-only fictional demo lab.
// The bearer link only grants narrowly scoped onboarding after email-bound acceptance.
import { createHash, randomBytes } from "node:crypto";
import { completeOnboarding, requireWritableHousehold, type HouseholdContext, type StudentSetup } from "./accounts";
import { exec, newId, nowIso, queryOne, usingPostgres, withTransaction } from "./client";
import { capLock, createComplimentary, currentAccessCycle, recordCycleAudit } from "./cycle-access";
import { isStartTerm } from "@/lib/terms";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const normalized = (email: string | null) => email?.trim().toLowerCase() ?? null;
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export async function issueBetaInvite(request: { id: string; requester_email: string }, actor: { id: string; email: string }) {
  await capLock();
  const term = currentAccessCycle();
  if (!isStartTerm(term)) throw new Error("ACCESS_CYCLE is not supported by onboarding");
  // Reserve room for outstanding invitations while preserving the lifetime cap
  // on legacy complimentary invites and zero-dollar orders.
  const count = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM (
    SELECT 'h:'||household_id AS k FROM complimentary_invites
    UNION SELECT CASE WHEN household_id IS NULL THEN 'deleted:'||id ELSE 'h:'||household_id END FROM cycle_orders WHERE kind='complimentary'
    UNION SELECT 'beta:'||b.id FROM beta_access_invites b JOIN demo_access_requests r ON r.id=b.request_id
      WHERE r.status='approved' AND b.revoked_at IS NULL AND b.expires_at>$1
      AND NOT EXISTS (SELECT 1 FROM cycle_orders o WHERE o.idempotency_key='beta:'||b.id)
  ) reserved`, [nowIso()]);
  if (Number(count?.n ?? 0) >= 25) throw new Error("Complimentary household cap reached");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const id = newId("betainv");
  await exec(`INSERT INTO beta_access_invites(id,request_id,token_hash,cycle,kind,authorized_by,expires_at,created_at)
    VALUES($1,$2,$3,$4,'founding_family',$5,$6,$7)`, [id, request.id, tokenHash(token), term, actor.id, expiresAt, nowIso()]);
  return { id, token, expiresAt };
}

export async function previewBetaInvite(token: string, email: string | null) {
  if (!validToken(token) || !email) return null;
  return queryOne<{ expires_at: string }>(`SELECT b.expires_at FROM beta_access_invites b JOIN demo_access_requests r ON r.id=b.request_id
    WHERE b.token_hash=$1 AND b.accepted_at IS NULL AND b.revoked_at IS NULL AND b.expires_at>$2
      AND b.cycle=$3 AND r.status='approved' AND r.requester_email=$4`, [tokenHash(token), nowIso(), currentAccessCycle(), normalized(email)]);
}

export async function acceptBetaInvite(ctx: HouseholdContext, token: string): Promise<"accepted" | "invalid" | "populated"> {
  if (!validToken(token) || !ctx.email) return "invalid";
  return withTransaction(async () => {
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const invite = await queryOne<any>(`SELECT b.* FROM beta_access_invites b WHERE b.token_hash=$1${lock}`, [tokenHash(token)]);
    const request = invite && await queryOne<any>(`SELECT * FROM demo_access_requests WHERE id=$1${lock}`, [invite.request_id]);
    const current = await queryOne<any>(`SELECT * FROM auth_links WHERE auth_user_id=$1${lock}`, [ctx.authUserId]);
    if (!invite || !request || !current || current.household_id !== ctx.household.id || current.role !== "owner" ||
      request.status !== "approved" || request.requester_email !== normalized(ctx.email) || invite.cycle !== currentAccessCycle() ||
      invite.accepted_at || invite.revoked_at || invite.expires_at <= nowIso()) return "invalid";
    const [students, members, demo, orders] = await Promise.all([
      queryOne<any>("SELECT COUNT(*) AS n FROM students WHERE household_id=$1", [ctx.household.id]),
      queryOne<any>("SELECT COUNT(*) AS n FROM auth_links WHERE household_id=$1", [ctx.household.id]),
      queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id=$1", [ctx.household.id]),
      queryOne("SELECT 1 AS ok FROM cycle_orders WHERE household_id=$1", [ctx.household.id]),
    ]);
    if (Number(students?.n) || Number(members?.n) !== 1 || demo || orders ||
      ctx.household.id === process.env.DEMO_TEMPLATE_HOUSEHOLD_ID ||
      await queryOne("SELECT 1 AS ok FROM school_requests WHERE household_id=$1", [ctx.household.id]) ||
      await queryOne("SELECT 1 AS ok FROM institution_relationships r JOIN students s ON s.id=r.student_id WHERE s.household_id=$1", [ctx.household.id])) return "populated";
    await exec(`UPDATE beta_access_invites SET accepted_at=$1,accepted_by=$2,accepted_email=$3,accepted_household_id=$4 WHERE id=$5`,
      [nowIso(), ctx.authUserId, normalized(ctx.email), ctx.household.id, invite.id]);
    return "accepted";
  });
}

/** Only /onboarding and its submit action may use this grant; never a product API. */
export async function hasBetaOnboardingAccess(user: { id: string; email: string | null }, householdId: string) {
  if (!user.email) return false;
  return !!await queryOne(`SELECT 1 AS ok FROM beta_access_invites b JOIN demo_access_requests r ON r.id=b.request_id
    WHERE b.accepted_household_id=$1 AND b.accepted_by=$2 AND b.accepted_email=$3
    AND r.requester_email=$4 AND r.status='approved' AND b.accepted_at IS NOT NULL
    AND b.revoked_at IS NULL AND b.expires_at>$5 AND b.cycle=$6
    AND NOT EXISTS(SELECT 1 FROM students s WHERE s.household_id=$7) LIMIT 1`,
    [householdId, user.id, normalized(user.email), normalized(user.email), nowIso(), currentAccessCycle(), householdId]);
}

export async function completeBetaOnboarding(ctx: HouseholdContext, email: string | null, input: {
  role: "parent" | "student"; students: StudentSetup[]; purchaserAttested: boolean;
}) {
  if (!email || !input.purchaserAttested || !input.students.length || input.students.some(s => s.enteringTerm !== currentAccessCycle())) throw new Error("This invitation is for the configured admissions cycle only.");
  return withTransaction(async () => {
    await capLock();
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const invite = await queryOne<any>(`SELECT b.* FROM beta_access_invites b WHERE b.accepted_household_id=$1 AND b.accepted_by=$2${lock}`, [ctx.household.id, ctx.authUserId]);
    const request = invite && await queryOne<any>(`SELECT * FROM demo_access_requests WHERE id=$1${lock}`, [invite.request_id]);
    if (!invite || !request || request.status !== "approved" || request.requester_email !== normalized(email) ||
      invite.accepted_email !== normalized(email) || invite.cycle !== currentAccessCycle() ||
      !invite.accepted_at || invite.revoked_at || !ctx.isOwner) throw new Error("Invitation is no longer available.");
    const previous = await queryOne<any>("SELECT * FROM cycle_orders WHERE idempotency_key=$1", [`beta:${invite.id}`]);
    if (previous) {
      if (previous.household_id !== ctx.household.id || previous.cycle !== invite.cycle) throw new Error("Invitation order conflict");
      return previous.id as string;
    }
    if (invite.expires_at <= nowIso()) throw new Error("Invitation has expired before onboarding completed.");
    if (await queryOne("SELECT 1 AS ok FROM students WHERE household_id=$1", [ctx.household.id])) throw new Error("Onboarding already started without this invitation.");
    await requireWritableHousehold(ctx);
    await completeOnboarding(ctx, input);
    // All student creation, the $0 order, entitlement, accounting and audit
    // share one transaction; any failure rolls back the whole onboarding.
    return createComplimentary(ctx.household.id, { id: invite.authorized_by, email: process.env.DEMO_OWNER_EMAIL ?? "" }, "Owner-approved founding-family beta access", `beta:${invite.id}`);
  });
}

export async function revokeBetaInvite(requestId: string, actor: { id: string; email: string }) {
  const invite = await queryOne<any>("SELECT * FROM beta_access_invites WHERE request_id=$1", [requestId]);
  if (!invite) return false;
  await exec("UPDATE beta_access_invites SET revoked_at=$1 WHERE id=$2 AND revoked_at IS NULL", [nowIso(), invite.id]);
  if (invite.accepted_household_id) {
    const row = await queryOne<any>(`SELECT e.id,e.order_id FROM cycle_entitlements e JOIN cycle_orders o ON o.id=e.order_id
      WHERE e.household_id=$1 AND e.cycle=$2 AND o.idempotency_key=$3 AND e.revoked_at IS NULL`,
      [invite.accepted_household_id, invite.cycle, `beta:${invite.id}`]);
    if (row) {
      await exec("UPDATE cycle_entitlements SET revoked_at=$1,revoked_by=$2 WHERE id=$3", [nowIso(), actor.id, row.id]);
      await recordCycleAudit(invite.accepted_household_id, row.order_id, "access_revoked", `revoke:${row.id}`, actor.id, "Owner revoked beta approval");
    }
  }
  return true;
}
