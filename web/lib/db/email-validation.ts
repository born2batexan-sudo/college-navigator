// Paid, forwarding-first email validation. The future inbound adapter must
// provide only normalized evidence and authentication results. This module
// retains only minimized fields and keyed digests.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { exec, newId, nowIso, queryOne, queryRows, withTransaction } from "./client";
import { createActionEvent, getActionInstance, updateActionInstance } from "./repo";

export const EMAIL_VALIDATION_TABLES = [
  "email_validation_entitlements",
  "intake_aliases",
  "institution_sender_policies",
  "normalized_email_evidence",
  "email_task_matches",
  "email_status_events",
] as const;

// These statements are deliberately limited to local SQLite bootstrap. The
// reviewed PostgreSQL migration is web/lib/db/deploy/20260921-email-validation.sql.
export const EMAIL_VALIDATION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS email_validation_entitlements (
    household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
    entitlement_state TEXT NOT NULL DEFAULT 'trial' CHECK (entitlement_state IN ('trial','paid','inactive','past_due')),
    owner_consent INTEGER NOT NULL DEFAULT 0 CHECK (owner_consent IN (0,1)),
    consented_by TEXT,
    consented_at TEXT,
    paused_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS intake_aliases (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    alias_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','rotated')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS institution_sender_policies (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    sender_domain TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    curated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE(institution_id, sender_domain)
  )`,
  `CREATE TABLE IF NOT EXISTS normalized_email_evidence (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    alias_id TEXT REFERENCES intake_aliases(id) ON DELETE SET NULL,
    institution_id TEXT NOT NULL REFERENCES institutions(id),
    applicant_id TEXT,
    entering_term TEXT NOT NULL,
    checkpoint_code TEXT NOT NULL,
    sender_domain TEXT NOT NULL,
    provenance_class TEXT NOT NULL CHECK (provenance_class IN ('authenticated_original','forwarded_arc','quoted_sender','unknown')),
    authentication_result TEXT NOT NULL CHECK (authentication_result IN ('authenticated','failed','unknown')),
    signal TEXT NOT NULL CHECK (signal IN ('received','complete','other')),
    replay_hash TEXT NOT NULL UNIQUE,
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_task_matches (
    id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL UNIQUE REFERENCES normalized_email_evidence(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    action_id TEXT REFERENCES action_instances(id) ON DELETE SET NULL,
    match_status TEXT NOT NULL CHECK (match_status IN ('applied','suggestion','quarantined','replay_suppressed')),
    reason_code TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_status_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    evidence_id TEXT REFERENCES normalized_email_evidence(id) ON DELETE SET NULL,
    match_id TEXT REFERENCES email_task_matches(id) ON DELETE SET NULL,
    action_id TEXT REFERENCES action_instances(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    observed_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intake_aliases_household ON intake_aliases(household_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_intake_alias ON intake_aliases(household_id) WHERE status='active'",
  "CREATE INDEX IF NOT EXISTS idx_sender_policies_institution ON institution_sender_policies(institution_id)",
  "CREATE INDEX IF NOT EXISTS idx_email_evidence_household ON normalized_email_evidence(household_id)",
  "CREATE INDEX IF NOT EXISTS idx_email_matches_household ON email_task_matches(household_id)",
  "CREATE INDEX IF NOT EXISTS idx_email_status_events_household ON email_status_events(household_id)",
];

type EntitlementState = "trial" | "paid" | "inactive" | "past_due";
type ProvenanceClass = "authenticated_original" | "forwarded_arc" | "quoted_sender" | "unknown";
type AuthenticationResult = "authenticated" | "failed" | "unknown";
type Signal = "received" | "complete" | "other";

export type EmailValidationEntitlement = {
  householdId: string;
  entitlementState: EntitlementState;
  ownerConsent: boolean;
  consentedBy: string | null;
  consentedAt: string | null;
  pausedAt: string | null;
  revokedAt: string | null;
};

export type IntakeAlias = {
  id: string;
  householdId: string;
  forwardingAddress: string;
  createdAt: string;
  revokedAt: string | null;
};

export type NormalizedEmailEvidence = {
  /** Full forwarding address returned by issueIntakeAlias; never persisted. */
  alias: string;
  institutionId: string;
  /** Exact entering term, e.g. "Fall 2027"; no term substitution is allowed. */
  enteringTerm: string;
  checkpointCode: string;
  senderDomain: string;
  provenanceClass: ProvenanceClass;
  authenticationResult: AuthenticationResult;
  signal: Signal;
  /** Adapter-provided stable nonce. Only a keyed digest is persisted. */
  replayKey: string;
  /** Optional internal applicant id from a trusted normalizer. */
  applicantId?: string | null;
  observedAt?: string;
};

export type IngestionReason =
  | "applied"
  | "forwarded_suggestion"
  | "auth_failure"
  | "domain_mismatch"
  | "ambiguous_match"
  | "no_exact_match"
  | "replay_suppressed"
  | "illegal_transition"
  | "unsupported_signal"
  | "invalid_alias"
  | "not_entitled"
  | "paused"
  | "demo_excluded";

export type IngestionDecision = {
  status: "applied" | "suggestion" | "quarantined" | "replay_suppressed";
  reasonCode: IngestionReason;
  evidenceId: string | null;
  matchId: string | null;
  actionId: string | null;
  fromState: string | null;
  toState: string | null;
};

type OwnerInput = { householdId: string; ownerAuthUserId?: string; authUserId?: string; actorId?: string };

function ownerId(input: OwnerInput): string {
  const id = input.ownerAuthUserId ?? input.authUserId ?? input.actorId;
  if (!id) throw new Error("Owner authorization is required");
  return id;
}

function normalizeDomain(raw: string): string {
  const domain = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/^www\./, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    throw new Error("Sender domain must be an exact hostname");
  }
  // A policy is never a suffix or a generic educational-domain rule.
  if (domain === "edu" || domain.startsWith(".") || domain.includes("*")) throw new Error("Sender policy must be an exact curated domain");
  return domain;
}

function normalizeAlias(alias: string): string {
  const value = alias.trim().toLowerCase();
  if (!value || value.length > 320 || !/^[^@\s]+@[^@\s]+$/.test(value)) throw new Error("Invalid forwarding alias");
  return value;
}

function hashAlias(alias: string): string { return createHash("sha256").update(normalizeAlias(alias)).digest("hex"); }
function replayDigest(value: string): string {
  const secret = process.env.EMAIL_VALIDATION_REPLAY_SECRET?.trim();
  // Replay identifiers may derive from external message metadata. Never fall
  // back to an unkeyed digest, which would make low-entropy identifiers
  // guessable. Missing secure configuration fails closed.
  if (!secret || secret.length < 16) throw new Error("Email validation replay protection is not configured");
  return createHmac("sha256", secret).update(value).digest("hex");
}
function isDemoExcluded(householdId: string): Promise<boolean> {
  return queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id=$1", [householdId]).then(Boolean);
}
function configuredTemplate(householdId: string): boolean { return process.env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim() === householdId; }
async function assertOwner(input: OwnerInput): Promise<void> {
  if (configuredTemplate(input.householdId) || await isDemoExcluded(input.householdId)) throw new Error("Private Preview households are excluded");
  const owner = await queryOne<any>("SELECT 1 AS ok FROM auth_links WHERE household_id=$1 AND auth_user_id=$2 AND role='owner'", [input.householdId, ownerId(input)]);
  if (!owner) throw new Error("Household owner authorization is required");
}

async function readEntitlement(householdId: string): Promise<any | null> {
  return queryOne<any>("SELECT * FROM email_validation_entitlements WHERE household_id=$1", [householdId]);
}
async function activeAccess(householdId: string): Promise<"active" | "paused" | "not_entitled" | "demo_excluded"> {
  if (configuredTemplate(householdId) || await isDemoExcluded(householdId)) return "demo_excluded";
  const row = await readEntitlement(householdId);
  if (!row || !row.owner_consent || !["trial", "paid"].includes(row.entitlement_state) || row.revoked_at) return "not_entitled";
  if (row.paused_at) return "paused";
  return "active";
}

/**
 * Server-side billing/admin operation. It deliberately cannot collect owner
 * consent and is not exposed by a household route. Entitlement and consent
 * are separate gates so a family can never self-grant the paid enhancement.
 */
export async function provisionEmailValidationEntitlement(input: {
  householdId: string;
  entitlementState: EntitlementState;
  provisionedBy: string;
}): Promise<EmailValidationEntitlement> {
  if (!input.provisionedBy.trim()) throw new Error("Provisioning authority is required");
  const household = await queryOne("SELECT 1 AS ok FROM households WHERE id=$1", [input.householdId]);
  if (!household || configuredTemplate(input.householdId) || await isDemoExcluded(input.householdId)) throw new Error("Household is unavailable for email validation");
  const now = nowIso();
  await exec(`INSERT INTO email_validation_entitlements(household_id,entitlement_state,owner_consent,consented_by,consented_at,paused_at,revoked_at,created_at,updated_at)
    VALUES($1,$2,0,NULL,NULL,NULL,NULL,$3,$4)
    ON CONFLICT(household_id) DO UPDATE SET entitlement_state=$5,updated_at=$6`,
    [input.householdId, input.entitlementState, now, now, input.entitlementState, now]);
  await recordControlEvent(input.householdId, "entitlement_provisioned", input.entitlementState, null);
  return getEmailValidationEntitlement(input.householdId) as Promise<EmailValidationEntitlement>;
}

export async function setEmailValidationConsent(input: OwnerInput & { consented?: boolean; consent?: boolean; ownerConsent?: boolean }): Promise<EmailValidationEntitlement> {
  await assertOwner(input);
  const consented = input.consented ?? input.consent ?? input.ownerConsent;
  if (consented === undefined) throw new Error("Explicit owner consent is required");
  const current = await readEntitlement(input.householdId);
  if (!current) throw new Error("A paid or trial entitlement must be provisioned before consent");
  const now = nowIso();
  const actor = ownerId(input);
  await withTransaction(async () => {
    await exec(`UPDATE email_validation_entitlements SET owner_consent=$1,consented_by=$2,consented_at=$3,
      paused_at=CASE WHEN $4=1 THEN paused_at ELSE NULL END,revoked_at=CASE WHEN $5=1 THEN NULL ELSE $6 END,updated_at=$7
      WHERE household_id=$8`, [consented ? 1 : 0, consented ? actor : null, consented ? now : null, consented ? 1 : 0, consented ? 1 : 0, consented ? null : now, now, input.householdId]);
    if (!consented) await exec("UPDATE intake_aliases SET status='revoked',revoked_at=$1,revoked_by=$2 WHERE household_id=$3 AND status='active'", [now, actor, input.householdId]);
    await recordControlEvent(input.householdId, consented ? "consent_granted" : "consent_withdrawn", consented ? "consented" : "withdrawn", null);
  });
  return getEmailValidationEntitlement(input.householdId) as Promise<EmailValidationEntitlement>;
}

export async function getEmailValidationEntitlement(householdId: string): Promise<EmailValidationEntitlement | null> {
  const row = await readEntitlement(householdId);
  if (!row) return null;
  return { householdId: row.household_id, entitlementState: row.entitlement_state, ownerConsent: !!row.owner_consent, consentedBy: row.consented_by ?? null, consentedAt: row.consented_at ?? null, pausedAt: row.paused_at ?? null, revokedAt: row.revoked_at ?? null };
}

function forwardingDomain(): string {
  return normalizeDomain(process.env.EMAIL_FORWARDING_DOMAIN?.trim() || "forwarding.invalid");
}

async function makeAlias(input: OwnerInput, mode: "issue" | "rotate"): Promise<IntakeAlias> {
  await assertOwner(input);
  const access = await activeAccess(input.householdId);
  if (access !== "active") throw new Error(`Email validation access is ${access}`);
  return withTransaction(async () => {
    const now = nowIso();
    const existing = await queryOne<any>("SELECT id FROM intake_aliases WHERE household_id=$1 AND status='active'", [input.householdId]);
    if (existing) await exec("UPDATE intake_aliases SET status='rotated',revoked_at=$1,revoked_by=$2 WHERE id=$3 AND status='active'", [now, ownerId(input), existing.id]);
    const secret = randomBytes(32).toString("base64url");
    const address = `cn_${secret}@${forwardingDomain()}`;
    const id = newId("alias");
    await exec("INSERT INTO intake_aliases(id,household_id,alias_hash,status,created_by,created_at,revoked_at,revoked_by) VALUES($1,$2,$3,'active',$4,$5,NULL,NULL)", [id, input.householdId, hashAlias(address), ownerId(input), now]);
    await recordControlEvent(input.householdId, "alias_issued", mode === "rotate" ? "rotated" : "issued", null);
    return { id, householdId: input.householdId, forwardingAddress: address, createdAt: now, revokedAt: null };
  });
}

export async function issueIntakeAlias(input: OwnerInput): Promise<IntakeAlias> { return makeAlias(input, "issue"); }
export async function rotateIntakeAlias(input: OwnerInput): Promise<IntakeAlias> { return makeAlias(input, "rotate"); }

export async function revokeIntakeAlias(input: OwnerInput & { aliasId?: string }): Promise<boolean> {
  await assertOwner(input);
  const now = nowIso();
  const changed = await queryOne<any>(`UPDATE intake_aliases SET status='revoked',revoked_at=$1,revoked_by=$2
    WHERE household_id=$3 AND status='active'${input.aliasId ? " AND id=$4" : ""} RETURNING id`, input.aliasId ? [now, ownerId(input), input.householdId, input.aliasId] : [now, ownerId(input), input.householdId]);
  if (changed) await recordControlEvent(input.householdId, "alias_revoked", "revoked", null);
  return !!changed;
}

export async function pauseEmailValidation(input: OwnerInput): Promise<void> {
  await assertOwner(input);
  const now = nowIso();
  await exec("UPDATE email_validation_entitlements SET paused_at=$1,updated_at=$2 WHERE household_id=$3", [now, now, input.householdId]);
  await recordControlEvent(input.householdId, "paused", "paused", null);
}
export async function resumeEmailValidation(input: OwnerInput): Promise<void> {
  await assertOwner(input);
  await exec("UPDATE email_validation_entitlements SET paused_at=NULL,updated_at=$1 WHERE household_id=$2", [nowIso(), input.householdId]);
  await recordControlEvent(input.householdId, "resumed", "resumed", null);
}
export async function revokeEmailValidation(input: OwnerInput): Promise<void> {
  await assertOwner(input);
  const now = nowIso();
  await exec("UPDATE email_validation_entitlements SET revoked_at=$1,owner_consent=0,updated_at=$2 WHERE household_id=$3", [now, now, input.householdId]);
  await exec("UPDATE intake_aliases SET status='revoked',revoked_at=$1,revoked_by=$2 WHERE household_id=$3 AND status='active'", [now, ownerId(input), input.householdId]);
  await recordControlEvent(input.householdId, "feature_revoked", "revoked", null);
}

/** Removes household-owned evidence and aliases; append-only status events remain. */
export async function deleteEmailValidationData(input: OwnerInput): Promise<void> {
  await assertOwner(input);
  await withTransaction(async () => {
    await exec("DELETE FROM normalized_email_evidence WHERE household_id=$1", [input.householdId]);
    await exec("DELETE FROM intake_aliases WHERE household_id=$1", [input.householdId]);
    await exec("DELETE FROM email_validation_entitlements WHERE household_id=$1", [input.householdId]);
    await recordControlEvent(input.householdId, "feature_deleted", "deleted", null);
  });
}

export async function createInstitutionSenderPolicy(input: { institutionId: string; senderDomain: string; curatedBy?: string }): Promise<{ id: string; institutionId: string; senderDomain: string }> {
  const institution = await queryOne<any>("SELECT domains FROM institutions WHERE id=$1", [input.institutionId]);
  if (!institution) throw new Error("Institution not found");
  const domain = normalizeDomain(input.senderDomain);
  let approved: string[] = [];
  try { approved = JSON.parse(institution.domains || "[]").map((x: unknown) => normalizeDomain(String(x))); } catch { approved = []; }
  if (!approved.some((d) => domain === d || domain.endsWith(`.${d}`))) throw new Error("Sender domain must be under the institution's approved domain");
  const id = newId("sender");
  await exec(`INSERT INTO institution_sender_policies(id,institution_id,sender_domain,active,curated_by,created_at,revoked_at)
    VALUES($1,$2,$3,1,$4,$5,NULL) ON CONFLICT(institution_id,sender_domain) DO UPDATE SET active=1,curated_by=excluded.curated_by,revoked_at=NULL`, [id, input.institutionId, domain, input.curatedBy ?? "curated", nowIso()]);
  const row = await queryOne<any>("SELECT id,institution_id,sender_domain FROM institution_sender_policies WHERE institution_id=$1 AND sender_domain=$2", [input.institutionId, domain]);
  return { id: row.id, institutionId: row.institution_id, senderDomain: row.sender_domain };
}
export const curateInstitutionSenderDomain = createInstitutionSenderPolicy;
export async function revokeInstitutionSenderPolicy(id: string): Promise<void> { await exec("UPDATE institution_sender_policies SET active=0,revoked_at=$1 WHERE id=$2", [nowIso(), id]); }

function parseStudentTerm(raw: unknown): string | null {
  try { const parsed = JSON.parse(String(raw || "{}")); return typeof parsed.enteringTerm === "string" ? parsed.enteringTerm : null; } catch { return null; }
}

async function findCandidates(householdId: string, input: NormalizedEmailEvidence): Promise<any[]> {
  const rows = await queryRows<any>(`SELECT a.id AS action_id,a.state AS action_state,a.relationship_id,r.institution_id,
      ru.checkpoint_code,ru.research_term,s.id AS student_id,s.attributes
    FROM action_instances a
    JOIN institution_relationships r ON r.id=a.relationship_id AND r.active=1
    JOIN rules ru ON ru.id=a.rule_id
    JOIN students s ON s.id=r.student_id
    WHERE s.household_id=$1 AND r.institution_id=$2 AND ru.checkpoint_code=$3 AND ru.research_term=$4
      AND ru.status='verified' AND ru.confidence IN ('high','medium') AND ru.applicability='applies'`, [householdId, input.institutionId, input.checkpointCode, input.enteringTerm]);
  return rows.filter((row) => parseStudentTerm(row.attributes) === input.enteringTerm && (!input.applicantId || input.applicantId === row.student_id));
}

function legalTarget(state: string, signal: Signal): string | null {
  if (signal === "received" && state === "submitted") return "received";
  if (signal === "complete" && state === "received") return "complete";
  return null;
}

async function policyMatches(institutionId: string, senderDomain: string): Promise<boolean> {
  let domain: string;
  try { domain = normalizeDomain(senderDomain); } catch { return false; }
  return !!(await queryOne("SELECT 1 AS ok FROM institution_sender_policies WHERE institution_id=$1 AND sender_domain=$2 AND active=1", [institutionId, domain]));
}

async function resolveAlias(alias: string): Promise<any | null> {
  try { return await queryOne<any>("SELECT * FROM intake_aliases WHERE alias_hash=$1 AND status='active'", [hashAlias(alias)]); } catch { return null; }
}

async function baseDecision(input: NormalizedEmailEvidence): Promise<{ decision: IngestionDecision; alias: any | null; action: any | null; replayHash: string }> {
  const replayHash = replayDigest(input.replayKey.trim());
  const prior = await queryOne<any>("SELECT id FROM normalized_email_evidence WHERE replay_hash=$1", [replayHash]);
  if (prior) return { decision: { status: "replay_suppressed", reasonCode: "replay_suppressed", evidenceId: prior.id, matchId: null, actionId: null, fromState: null, toState: null }, alias: null, action: null, replayHash };
  const alias = await resolveAlias(input.alias);
  if (!alias) return { decision: { status: "quarantined", reasonCode: "invalid_alias", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias: null, action: null, replayHash };
  const access = await activeAccess(alias.household_id);
  if (access === "demo_excluded") return { decision: { status: "quarantined", reasonCode: "demo_excluded", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  if (access === "not_entitled") return { decision: { status: "quarantined", reasonCode: "not_entitled", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  if (access === "paused") return { decision: { status: "quarantined", reasonCode: "paused", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  if (input.authenticationResult === "failed" || input.provenanceClass === "quoted_sender" || input.provenanceClass === "unknown") return { decision: { status: "quarantined", reasonCode: "auth_failure", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  const domainOkay = await policyMatches(input.institutionId, input.senderDomain);
  if (!domainOkay) return { decision: { status: "quarantined", reasonCode: "domain_mismatch", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  if (input.provenanceClass !== "authenticated_original" && input.provenanceClass !== "forwarded_arc") return { decision: { status: "quarantined", reasonCode: "auth_failure", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  if (input.authenticationResult !== "authenticated") return { decision: { status: "quarantined", reasonCode: "auth_failure", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  if (input.signal !== "received" && input.signal !== "complete") return { decision: { status: "quarantined", reasonCode: "unsupported_signal", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  const candidates = await findCandidates(alias.household_id, input);
  if (candidates.length !== 1) return { decision: { status: "quarantined", reasonCode: candidates.length > 1 ? "ambiguous_match" : "no_exact_match", evidenceId: null, matchId: null, actionId: null, fromState: null, toState: null }, alias, action: null, replayHash };
  const action = candidates[0];
  if (input.provenanceClass === "forwarded_arc") return { decision: { status: "suggestion", reasonCode: "forwarded_suggestion", evidenceId: null, matchId: null, actionId: action.action_id, fromState: action.action_state, toState: null }, alias, action, replayHash };
  const target = legalTarget(action.action_state, input.signal);
  if (!target) return { decision: { status: "quarantined", reasonCode: "illegal_transition", evidenceId: null, matchId: null, actionId: action.action_id, fromState: action.action_state, toState: null }, alias, action, replayHash };
  return { decision: { status: "applied", reasonCode: "applied", evidenceId: null, matchId: null, actionId: action.action_id, fromState: action.action_state, toState: target }, alias, action, replayHash };
}

function validInput(input: NormalizedEmailEvidence): void {
  if (!input || typeof input !== "object") throw new Error("Normalized evidence is required");
  if (!input.institutionId || !input.enteringTerm || !input.checkpointCode || !input.senderDomain || !input.replayKey.trim()) throw new Error("Normalized evidence is incomplete");
  if (input.institutionId.length > 200 || input.enteringTerm.length > 100 || input.checkpointCode.length > 160 || input.senderDomain.length > 255 || input.replayKey.length > 512 || (input.applicantId?.length ?? 0) > 200) throw new Error("Normalized evidence field is too long");
}

async function recordControlEvent(householdId: string, eventType: string, reasonCode: string, actionId: string | null): Promise<void> {
  await exec("INSERT INTO email_status_events(id,household_id,evidence_id,match_id,action_id,event_type,reason_code,from_state,to_state,observed_at) VALUES($1,$2,NULL,NULL,$3,$4,$5,NULL,NULL,$6)", [newId("email_evt"), householdId, actionId, eventType, reasonCode, nowIso()]);
}

export async function evaluateNormalizedEvidence(input: NormalizedEmailEvidence): Promise<IngestionDecision> {
  validInput(input);
  return (await baseDecision(input)).decision;
}

export async function ingestNormalizedEvidence(input: NormalizedEmailEvidence): Promise<IngestionDecision> {
  validInput(input);
  return withTransaction(async () => {
    const resolved = await baseDecision(input);
    if (resolved.decision.reasonCode === "replay_suppressed") {
      if (resolved.alias) await recordControlEvent(resolved.alias.household_id, "replay_suppressed", "replay_suppressed", null);
      return resolved.decision;
    }
    // Invalid aliases and disabled/demo access are intentionally not persisted:
    // accepting them would create a side channel for probing household state.
    if (!resolved.alias) return resolved.decision;
    const now = nowIso();
    const evidenceId = newId("evidence");
    let senderDomain: string;
    try { senderDomain = normalizeDomain(input.senderDomain); } catch { senderDomain = input.senderDomain.trim().toLowerCase().slice(0, 255); }
    const observed = input.observedAt ?? now;
    await exec(`INSERT INTO normalized_email_evidence(id,household_id,alias_id,institution_id,applicant_id,entering_term,checkpoint_code,sender_domain,provenance_class,authentication_result,signal,replay_hash,observed_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [evidenceId, resolved.alias.household_id, resolved.alias.id, input.institutionId, input.applicantId ?? null, input.enteringTerm.trim(), input.checkpointCode.trim(), senderDomain, input.provenanceClass, input.authenticationResult, input.signal, resolved.replayHash, observed, now]);
    const matchId = newId("email_match");
    let status = resolved.decision.status;
    let reason = resolved.decision.reasonCode;
    let actionId = resolved.decision.actionId;
    let fromState = resolved.decision.fromState;
    let toState = resolved.decision.toState;
    if (status === "applied" && actionId && toState) {
      const action = await getActionInstance(actionId);
      const changed = action && action.state === fromState;
      if (!changed) { status = "quarantined"; reason = "illegal_transition"; toState = null; }
      else {
        await updateActionInstance(actionId, { state: toState });
        await createActionEvent({ actionId, eventType: "state_change", fromState, toState, actorType: "email_validation", evidenceRef: evidenceId });
      }
    }
    await exec("INSERT INTO email_task_matches(id,evidence_id,household_id,action_id,match_status,reason_code,from_state,to_state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [matchId, evidenceId, resolved.alias.household_id, actionId, status, reason, fromState, toState, now]);
    await exec("INSERT INTO email_status_events(id,household_id,evidence_id,match_id,action_id,event_type,reason_code,from_state,to_state,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [newId("email_evt"), resolved.alias.household_id, evidenceId, matchId, actionId, status === "applied" ? "state_applied" : status === "suggestion" ? "suggestion_created" : "quarantined", reason, fromState, toState, now]);
    return { status, reasonCode: reason, evidenceId, matchId, actionId, fromState, toState };
  });
}

export type NormalizedIngestionAdapter = { ingest(input: NormalizedEmailEvidence): Promise<IngestionDecision>; dryRun(input: NormalizedEmailEvidence): Promise<IngestionDecision> };
export function createNormalizedIngestionAdapter(): NormalizedIngestionAdapter {
  return { ingest: ingestNormalizedEvidence, dryRun: evaluateNormalizedEvidence };
}
export const dryRunNormalizedEvidence = evaluateNormalizedEvidence;
// Naming aliases keep the provider-neutral library easy to discover without
// creating a second implementation or an unauthenticated route.
export const issueForwardingAlias = issueIntakeAlias;
export const rotateForwardingAlias = rotateIntakeAlias;
export const revokeForwardingAlias = revokeIntakeAlias;
export const ingestEmailEvidence = ingestNormalizedEvidence;
export const processNormalizedEvidence = ingestNormalizedEvidence;
export const dryRunIngestion = evaluateNormalizedEvidence;
export async function enableEmailValidation(input: OwnerInput): Promise<EmailValidationEntitlement> {
  // Consent can enable only a separately provisioned entitlement.
  return setEmailValidationConsent({ ...input, consented: true });
}
export const disableEmailValidation = revokeEmailValidation;
export const deleteEmailValidation = deleteEmailValidationData;

