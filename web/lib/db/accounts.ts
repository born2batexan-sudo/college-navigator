// Accounts: who is signed in, which household they belong to, and the
// ownership checks every household-scoped read/write must pass.
//
// Convention note: repo.ts is documented as "the only other file that
// touches SQL". This file is a deliberate, narrow exception so the
// account/permission logic lives in one place that can be tested on its own
// (see tests/isolation.test.ts). It uses the same client.ts primitives and
// the same Postgres-style $n placeholders.
//
// Rule for the rest of the app: never call listHouseholds() or take a
// household/student/relationship/action id from a form or URL and trust it.
// Start from requireHousehold() (lib/auth/session.ts) and check ownership
// with the functions below.

import { createHash, randomBytes } from "node:crypto";
import { exec, queryOne, queryRows, newId, nowIso, usingPostgres, withTransaction } from "./client";
import { upsertStudent } from "./repo";
import type { Household, Person, Student } from "./types";
import { REQUEST_DDL, REQUEST_TABLES } from "./requests";
import { EMAIL_VALIDATION_DDL, EMAIL_VALIDATION_TABLES } from "./email-validation";
import { DEMO_ACCESS_DDL, DEMO_ACCESS_TABLES } from "./demo-access-schema";

export type AuthLink = {
  id: string;
  authUserId: string;
  householdId: string;
  personId: string | null;
  role: "owner" | "member";
  email: string | null;
  createdAt: string;
};

export type HouseholdContext = {
  authUserId: string;
  email: string | null;
  link: AuthLink;
  household: Household;
  person: Person | null;
  student: Student | null;
  isOwner: boolean;
  /** True only for a household created by an accepted private-preview invite. */
  isDemo: boolean;
};

// ---------- Schema contract (migrations on Postgres; self-created only in local SQLite) ----------

// Same statements as the end of schema.sql (tests/isolation.test.ts checks
// they stay identical). All TEXT columns, so they run unchanged on both
// SQLite and Postgres.
export const ACCOUNT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS auth_links (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  person_id TEXT REFERENCES people(id),
  role TEXT NOT NULL DEFAULT 'member',
  email TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS household_invites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  token_hash TEXT NOT NULL UNIQUE,
  invited_role TEXT NOT NULL DEFAULT 'parent',
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_links_household ON auth_links(household_id)`,
  `CREATE INDEX IF NOT EXISTS idx_household_invites_household ON household_invites(household_id)`,
  `CREATE TABLE IF NOT EXISTS demo_invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  template_household_id TEXT NOT NULL REFERENCES households(id),
  created_by TEXT NOT NULL,
  created_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_email TEXT,
  accepted_at TEXT,
  accepted_by TEXT,
  accepted_email TEXT,
  accepted_household_id TEXT REFERENCES households(id),
  access_request_id TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS demo_households (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  invite_id TEXT NOT NULL UNIQUE REFERENCES demo_invites(id),
  template_household_id TEXT NOT NULL REFERENCES households(id),
  cloned_at TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_demo_invites_template ON demo_invites(template_household_id)`,
  `CREATE INDEX IF NOT EXISTS idx_demo_invites_access_request ON demo_invites(access_request_id)`,
  ...DEMO_ACCESS_DDL,
];

export const ALL_TABLES = [
  "households",
  "people",
  "students",
  "institutions",
  "institution_relationships",
  "sources",
  "rules",
  "guidance_assets",
  "observation_patterns",
  "action_instances",
  "action_events",
  "change_events",
  "auth_links",
  "household_invites",
  "demo_invites",
  "demo_households",
  ...DEMO_ACCESS_TABLES,
  ...REQUEST_TABLES,
  ...EMAIL_VALIDATION_TABLES,
];

/** Local SQLite DDL statements, including the W4 queue. PostgreSQL uses reviewed migrations. */
export const SCHEMA_DDL = [...ACCOUNT_DDL, ...REQUEST_DDL, ...EMAIL_VALIDATION_DDL];

let ensurePromise: Promise<void> | null = null;

/**
 * Postgres release verification (SQLite creates schema.sql locally).
 * Production schema changes are applied only through reviewed migrations.
 * At runtime we fail closed unless every expected public table exists, has
 * RLS enabled, and grants no direct access to Supabase's anon/authenticated
 * roles. Safe to run repeatedly; memoized per server instance.
 */
export function ensureAccountSchema(): Promise<void> {
  if (!usingPostgres) return Promise.resolve();
  if (!ensurePromise) {
    ensurePromise = runEnsure().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function runEnsure(): Promise<void> {
  // Runtime application roles must not have DDL privileges. Deployment applies
  // versioned migrations; requests fail closed if schema/RLS verification did
  // not happen.
  const rows = await queryRows<any>(`SELECT c.relname AS name,c.relrowsecurity AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY($1::text[])`, [ALL_TABLES]);
  const byName = new Map(rows.map((r) => [r.name, !!r.rls]));
  const missing = ALL_TABLES.filter((t) => !byName.has(t));
  const withoutRls = ALL_TABLES.filter((t) => byName.has(t) && !byName.get(t));
  const exposed = await queryRows<any>(`SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee IN ('anon','authenticated')`);
  if (missing.length || withoutRls.length || exposed.length) throw new Error(`Database release verification failed (missing: ${missing.join(",") || "none"}; RLS disabled: ${withoutRls.join(",") || "none"}; direct public grants: ${exposed.map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`).join(",") || "none"})`);
}

// ---------- Row mappers ----------

const toHousehold = (r: any): Household => ({
  id: r.id,
  name: r.name,
  timezone: r.timezone,
  subState: r.sub_state,
  createdAt: r.created_at,
});

const toPerson = (r: any): Person => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  role: r.role,
  email: r.email,
  phone: r.phone,
  consentState: r.consent_state,
  createdAt: r.created_at,
});

const toStudent = (r: any): Student => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  gradYear: Number(r.grad_year),
  applicantType: r.applicant_type,
  residency: r.residency,
  attributes: r.attributes,
  createdAt: r.created_at,
});

const toLink = (r: any): AuthLink => ({
  id: r.id,
  authUserId: r.auth_user_id,
  householdId: r.household_id,
  personId: r.person_id,
  role: r.role === "owner" ? "owner" : "member",
  email: r.email,
  createdAt: r.created_at,
});

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);

// ---------- Provisioning ----------

/**
 * Finds the signed-in user's household, creating an empty one the first
 * time. Ids are derived from the user id and every insert is
 * ON CONFLICT DO NOTHING, so two simultaneous first requests cannot create
 * two households.
 */
export async function provisionAccount(input: { authUserId: string; email: string | null }): Promise<HouseholdContext> {
  const existing = await getContextForUser(input.authUserId);
  if (existing) return existing;

  const uid = safeId(input.authUserId);
  const householdId = `hh_${uid}`;
  const personId = `person_${uid}`;
  const now = nowIso();

  await exec(
    "INSERT INTO households (id, name, timezone, sub_state, created_at) VALUES ($1, $2, 'America/Chicago', 'trial', $3) ON CONFLICT (id) DO NOTHING",
    [householdId, "Your family", now]
  );
  await exec(
    "INSERT INTO people (id, household_id, name, role, email, phone, consent_state, created_at) VALUES ($1, $2, $3, 'parent', $4, NULL, 'pending', $5) ON CONFLICT (id) DO NOTHING",
    [personId, householdId, input.email ? input.email.split("@")[0] : "Member", input.email, now]
  );
  await exec(
    "INSERT INTO auth_links (id, auth_user_id, household_id, person_id, role, email, created_at) VALUES ($1, $2, $3, $4, 'owner', $5, $6) ON CONFLICT (auth_user_id) DO NOTHING",
    [newId("link"), input.authUserId, householdId, personId, input.email, now]
  );

  const ctx = await getContextForUser(input.authUserId);
  if (!ctx) throw new Error("Could not create your account");
  return ctx;
}

export async function getContextForUser(authUserId: string): Promise<HouseholdContext | null> {
  const linkRow = await queryOne<any>("SELECT * FROM auth_links WHERE auth_user_id = $1", [authUserId]);
  if (!linkRow) return null;
  const link = toLink(linkRow);
  const hh = await queryOne<any>("SELECT * FROM households WHERE id = $1", [link.householdId]);
  if (!hh) return null;
  const person = link.personId ? await queryOne<any>("SELECT * FROM people WHERE id = $1", [link.personId]) : null;
  const student = await queryOne<any>(
    "SELECT * FROM students WHERE household_id = $1 ORDER BY created_at, id LIMIT 1",
    [link.householdId]
  );
  const demo = await queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id = $1", [link.householdId]);
  return {
    authUserId,
    email: link.email,
    link,
    household: toHousehold(hh),
    person: person ? toPerson(person) : null,
    student: student ? toStudent(student) : null,
    isOwner: link.role === "owner",
    isDemo: !!demo,
  };
}

export const ENTERING_CLASS_YEAR = 2027;

/**
 * Central write gate for every family mutation. Rechecks the marker instead
 * of trusting a stale request context, so a demo household is always
 * read-only even when a caller retained an older HouseholdContext.
 */
export async function requireWritableHousehold(ctx: HouseholdContext): Promise<HouseholdContext> {
  // Once configured, the source is immutable too; previews can never alter
  // their template indirectly or through its regular family UI.
  if (process.env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim() === ctx.household.id) throw new Error("Private Preview template is read-only.");
  const demo = await queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id = $1", [ctx.household.id]);
  if (demo) throw new Error("Private Preview households are read-only.");
  return ctx;
}

export async function requireWritableOnboardedHousehold(ctx: HouseholdContext): Promise<HouseholdContext & { student: Student }> {
  await requireWritableHousehold(ctx);
  if (!ctx.student) throw new Error("Student setup is required");
  return ctx as HouseholdContext & { student: Student };
}

export async function completeOnboarding(
  ctx: HouseholdContext,
  input: { studentName: string; role: "parent" | "student"; enteringTerm?: string }
): Promise<Student> {
  await requireWritableHousehold(ctx);
  const name = input.studentName.trim().slice(0, 60);
  if (!name) throw new Error("Student name is required");

  // One student per household for now; onboarding is idempotent.
  if (ctx.student) return ctx.student;

  const student = await upsertStudent({
    id: `student_${safeId(ctx.household.id)}`,
    householdId: ctx.household.id,
    name,
    gradYear: ENTERING_CLASS_YEAR,
    applicantType: "freshman",
    residency: "unknown",
    attributes: input.enteringTerm ? { enteringTerm: input.enteringTerm } : {},
  });
  await exec("UPDATE households SET name = $1 WHERE id = $2", [`${name}'s family`, ctx.household.id]);
  if (ctx.person) {
    await exec("UPDATE people SET role = $1, name = $2 WHERE id = $3", [
      input.role,
      input.role === "student" ? name : ctx.person.name,
      ctx.person.id,
    ]);
  }
  return student;
}

/** Updates the student's household-scoped preferences without accepting a student id from the browser. */
export async function updateStudentAttributes(ctx: HouseholdContext, patch: Record<string, unknown>): Promise<void> {
  await requireWritableOnboardedHousehold(ctx);
  if (!ctx.student) throw new Error("Student setup is required");
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(ctx.student.attributes || "{}"); } catch { current = {}; }
  await exec("UPDATE students SET attributes = $1 WHERE id = $2 AND household_id = $3", [JSON.stringify({ ...current, ...patch }), ctx.student.id, ctx.household.id]);
}

// ---------- Ownership checks (deny by default) ----------

export async function studentBelongsToHousehold(studentId: string, householdId: string): Promise<boolean> {
  const r = await queryOne("SELECT 1 AS ok FROM students WHERE id = $1 AND household_id = $2", [studentId, householdId]);
  return !!r;
}

export async function relationshipBelongsToHousehold(relationshipId: string, householdId: string): Promise<boolean> {
  const r = await queryOne(
    "SELECT 1 AS ok FROM institution_relationships r JOIN students s ON s.id = r.student_id WHERE r.id = $1 AND s.household_id = $2",
    [relationshipId, householdId]
  );
  return !!r;
}

export async function actionBelongsToHousehold(actionId: string, householdId: string): Promise<boolean> {
  const r = await queryOne(
    `SELECT 1 AS ok FROM action_instances a
       JOIN institution_relationships r ON r.id = a.relationship_id
       JOIN students s ON s.id = r.student_id
      WHERE a.id = $1 AND s.household_id = $2`,
    [actionId, householdId]
  );
  return !!r;
}

// ---------- Members ----------

export async function listMembers(householdId: string): Promise<{ email: string | null; role: string }[]> {
  const rows = await queryRows<any>("SELECT email, role FROM auth_links WHERE household_id = $1 ORDER BY created_at, id", [householdId]);
  return rows.map((r) => ({ email: r.email, role: r.role }));
}

// ---------- Invites ----------

const INVITE_DAYS = 14;
const MAX_OPEN_INVITES = 5;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function countOpenInvites(householdId: string): Promise<number> {
  const r = await queryOne<any>(
    "SELECT COUNT(*) AS n FROM household_invites WHERE household_id = $1 AND accepted_at IS NULL AND expires_at > $2",
    [householdId, nowIso()]
  );
  return Number(r?.n ?? 0);
}

/** Only a hash is stored, so the link can be shown once and never recovered. */
export async function createInvite(
  ctx: HouseholdContext,
  invitedRole: "parent" | "student"
): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; reason: "too_many" }> {
  await requireWritableHousehold(ctx);
  if ((await countOpenInvites(ctx.household.id)) >= MAX_OPEN_INVITES) return { ok: false, reason: "too_many" };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000).toISOString();
  await exec(
    "INSERT INTO household_invites (id, household_id, token_hash, invited_role, created_by, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [newId("inv"), ctx.household.id, hashToken(token), invitedRole, ctx.authUserId, expiresAt, nowIso()]
  );
  return { ok: true, token, expiresAt };
}

export async function previewInvite(token: string): Promise<{ householdId: string; householdName: string; invitedRole: string } | null> {
  const r = await queryOne<any>(
    `SELECT h.id AS household_id, h.name AS household_name, i.invited_role AS invited_role
       FROM household_invites i JOIN households h ON h.id = i.household_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > $2`,
    [hashToken(token), nowIso()]
  );
  return r ? { householdId: r.household_id, householdName: r.household_name, invitedRole: r.invited_role } : null;
}

export type AcceptResult = { ok: true; alreadyMember: boolean } | { ok: false; reason: "invalid" | "has_own_family" };

/**
 * Moves a signed-in user into the inviting household. Only allowed when the
 * user's current household is the empty one created at sign-up (no student,
 * no other members), so nobody can lose real data by tapping a link.
 */
export async function acceptInvite(ctx: HouseholdContext, token: string): Promise<AcceptResult> {
  return withTransaction(async () => {
    // Serialize every invite acceptance for this identity. The context was
    // created before this transaction, so re-read the link while holding the
    // lock and fail closed if another request already moved the user.
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const currentLink = await queryOne<any>(
      `SELECT * FROM auth_links WHERE auth_user_id = $1${lock}`,
      [ctx.authUserId]
    );
    if (!currentLink || currentLink.household_id !== ctx.household.id || currentLink.person_id !== (ctx.person?.id ?? null)) {
      return { ok: false, reason: "invalid" };
    }

    const tokenHash = hashToken(token);
    const inv = await queryOne<any>(
      `SELECT * FROM household_invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > $2${lock}`,
      [tokenHash, nowIso()]
    );
    if (!inv) return { ok: false, reason: "invalid" };
    // Household-member invitations never grant access to a demo clone.
    if (await queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id = $1", [inv.household_id])) return { ok: false, reason: "invalid" };
    if (inv.household_id === currentLink.household_id) return { ok: true, alreadyMember: true };

    const studentCount = Number((await queryOne<any>("SELECT COUNT(*) AS n FROM students WHERE household_id = $1", [currentLink.household_id]))?.n ?? 0);
    const memberCount = Number((await queryOne<any>("SELECT COUNT(*) AS n FROM auth_links WHERE household_id = $1", [currentLink.household_id]))?.n ?? 0);
    if (studentCount > 0 || memberCount > 1) return { ok: false, reason: "has_own_family" };

    // Claim, membership move, and empty-household cleanup are one atomic unit.
    const claimed = await queryOne<any>(
      "UPDATE household_invites SET accepted_at = $1, accepted_by = $2 WHERE id = $3 AND accepted_at IS NULL RETURNING id",
      [nowIso(), ctx.authUserId, inv.id]
    );
    if (!claimed) return { ok: false, reason: "invalid" };

    const oldHouseholdId = currentLink.household_id;
    const oldPersonId = currentLink.person_id ?? null;
    const newPersonId = newId("person");
    await exec(
      "INSERT INTO people (id, household_id, name, role, email, phone, consent_state, created_at) VALUES ($1, $2, $3, $4, $5, NULL, 'pending', $6)",
      [newPersonId, inv.household_id, ctx.email ? ctx.email.split("@")[0] : "Member", inv.invited_role, ctx.email, nowIso()]
    );
    await exec("UPDATE auth_links SET household_id = $1, person_id = $2, role = 'member' WHERE auth_user_id = $3 AND household_id = $4", [
      inv.household_id,
      newPersonId,
      ctx.authUserId,
      oldHouseholdId,
    ]);
    if (oldPersonId) await exec("DELETE FROM people WHERE id = $1 AND household_id = $2", [oldPersonId, oldHouseholdId]);
    await exec("DELETE FROM households WHERE id = $1", [oldHouseholdId]);
    return { ok: true, alreadyMember: false };
  });
}

// ---------- Private-preview invitations ----------

export type DemoInvite = {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  acceptedAt: string | null;
  acceptedEmail: string | null;
  acceptedHouseholdId: string | null;
  createdAt: string;
};

type DemoPreview = { expiresAt: string };
const DEMO_INVITE_DAYS = 7;

/** Server-only configuration: never accept a template id from a form or URL. */
function demoTemplateId(): string {
  const value = process.env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim();
  if (!value) throw new Error("Private preview is not configured.");
  return value;
}

export function isDemoOwnerEmail(email: string | null): boolean {
  const expected = process.env.DEMO_OWNER_EMAIL?.trim().toLowerCase();
  return !!expected && !!email && email.trim().toLowerCase() === expected;
}

export async function createDemoInvite(input: { createdBy: string; createdEmail: string }): Promise<{ token: string; expiresAt: string }> {
  const templateHouseholdId = demoTemplateId();
  const template = await queryOne("SELECT id FROM households WHERE id = $1", [templateHouseholdId]);
  if (!template || await queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id = $1", [templateHouseholdId])) {
    throw new Error("Private preview template is unavailable.");
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DEMO_INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await exec(`INSERT INTO demo_invites(id,token_hash,template_household_id,created_by,created_email,expires_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [newId("demoinv"), hashToken(token), templateHouseholdId, input.createdBy, input.createdEmail.trim().toLowerCase(), expiresAt, nowIso()]);
  return { token, expiresAt };
}

export async function listDemoInvites(): Promise<DemoInvite[]> {
  const rows = await queryRows<any>(`SELECT id,expires_at,revoked_at,accepted_at,accepted_email,accepted_household_id,created_at
    FROM demo_invites ORDER BY created_at DESC`);
  return rows.map((r) => ({ id: r.id, expiresAt: r.expires_at, revokedAt: r.revoked_at ?? null, acceptedAt: r.accepted_at ?? null,
    acceptedEmail: r.accepted_email ?? null, acceptedHouseholdId: r.accepted_household_id ?? null, createdAt: r.created_at }));
}

export async function revokeDemoInvite(id: string, actor: { id: string; email: string }): Promise<boolean> {
  const changed = await queryOne<any>(`UPDATE demo_invites SET revoked_at=$1,revoked_by=$2,revoked_email=$3
    WHERE id=$4 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [nowIso(), actor.id, actor.email.trim().toLowerCase(), id]);
  return !!changed;
}

export async function previewDemoInvite(token: string): Promise<DemoPreview | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await queryOne<any>(`SELECT expires_at FROM demo_invites
    WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2`, [hashToken(token), nowIso()]);
  return row ? { expiresAt: row.expires_at } : null;
}

function sanitizedAttributes(raw: string | null | undefined): string {
  // Copy only UI preference fields, never arbitrary historical/free-form data.
  try {
    const value = JSON.parse(raw || "{}") as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof value.enteringTerm === "string" && value.enteringTerm.length <= 50) out.enteringTerm = value.enteringTerm;
    return JSON.stringify(out);
  } catch { return "{}"; }
}

function sanitizedRelationshipAttributes(raw: string | null | undefined): string {
  try {
    const value = JSON.parse(raw || "{}") as Record<string, unknown>;
    return JSON.stringify({
      housingPlan: typeof value.housingPlan === "string" ? value.housingPlan.slice(0, 50) : "undecided",
      greekInterest: value.greekInterest === true,
      bringingCar: value.bringingCar === true,
      disabilityAccommodation: value.disabilityAccommodation === true,
    });
  } catch { return "{}"; }
}

export type AcceptDemoResult = { ok: true; householdId: string } | { ok: false; reason: "invalid" | "populated" };

/**
 * Atomically consumes one bearer link and turns the invitee's empty first-sign-in
 * shell into an isolated, read-only clone. All IDs below are regenerated;
 * institutions/rules/guidance remain shared immutable references.
 */
export async function acceptDemoInvite(ctx: HouseholdContext, token: string): Promise<AcceptDemoResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, reason: "invalid" };
  return withTransaction(async () => {
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const current = await queryOne<any>(`SELECT * FROM auth_links WHERE auth_user_id=$1${lock}`, [ctx.authUserId]);
    if (!current || current.household_id !== ctx.household.id) return { ok: false, reason: "invalid" };
    const invite = await queryOne<any>(`SELECT * FROM demo_invites WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>$2${lock}`,
      [hashToken(token), nowIso()]);
    // The template id comes only from the server-issued invite row. This lets
    // an owner rotate the active template without invalidating open links.
    if (!invite || !(await queryOne("SELECT 1 AS ok FROM households WHERE id=$1", [invite.template_household_id]))) {
      return { ok: false, reason: "invalid" };
    }

    const householdId = current.household_id as string;
    const [students, members, relationships, requests, demo] = await Promise.all([
      queryOne<any>("SELECT COUNT(*) AS n FROM students WHERE household_id=$1", [householdId]),
      queryOne<any>("SELECT COUNT(*) AS n FROM auth_links WHERE household_id=$1", [householdId]),
      queryOne<any>("SELECT COUNT(*) AS n FROM institution_relationships r JOIN students s ON s.id=r.student_id WHERE s.household_id=$1", [householdId]),
      queryOne<any>("SELECT COUNT(*) AS n FROM school_requests WHERE household_id=$1", [householdId]),
      queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id=$1", [householdId]),
    ]);
    if (Number(students?.n ?? 0) || Number(members?.n ?? 0) !== 1 || Number(relationships?.n ?? 0) || Number(requests?.n ?? 0) || demo) {
      return { ok: false, reason: "populated" };
    }

    const sourceStudent = await queryOne<any>("SELECT * FROM students WHERE household_id=$1 ORDER BY created_at,id LIMIT 1", [invite.template_household_id]);
    if (!sourceStudent) return { ok: false, reason: "invalid" };
    const now = nowIso();
    const studentId = newId("student");
    await exec("UPDATE households SET name=$1 WHERE id=$2", ["Private Preview household", householdId]);
    if (current.person_id) await exec("UPDATE people SET name=$1,role='parent',consent_state='pending' WHERE id=$2 AND household_id=$3", ["Preview Member", current.person_id, householdId]);
    await exec(`INSERT INTO students(id,household_id,name,grad_year,applicant_type,residency,attributes,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [studentId, householdId, "Sample Student", sourceStudent.grad_year, sourceStudent.applicant_type, sourceStudent.residency, sanitizedAttributes(sourceStudent.attributes), now]);

    const sourceRelationships = await queryRows<any>("SELECT * FROM institution_relationships WHERE student_id=$1", [sourceStudent.id]);
    const relIds = new Map<string, string>();
    for (const rel of sourceRelationships) {
      const id = newId("rel"); relIds.set(rel.id, id);
      await exec(`INSERT INTO institution_relationships(id,student_id,institution_id,lifecycle_state,decision_date,commit_date,attributes,active,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, studentId, rel.institution_id, rel.lifecycle_state, rel.decision_date, rel.commit_date, sanitizedRelationshipAttributes(rel.attributes), rel.active, now]);
    }
    const actionIds = new Map<string, string>();
    for (const [oldRelId, newRelId] of relIds) {
      const sourceActions = await queryRows<any>("SELECT * FROM action_instances WHERE relationship_id=$1", [oldRelId]);
      for (const action of sourceActions) {
        const id = newId("action"); actionIds.set(action.id, id);
        await exec(`INSERT INTO action_instances(id,relationship_id,rule_id,due_at,applicability_reason,priority,state,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, newRelId, action.rule_id, action.due_at, action.applicability_reason, action.priority, action.state, now, now]);
      }
    }
    for (const [oldActionId, newActionId] of actionIds) {
      const events = await queryRows<any>("SELECT * FROM action_events WHERE action_id=$1", [oldActionId]);
      for (const event of events) await exec(`INSERT INTO action_events(id,action_id,event_type,from_state,to_state,actor_type,evidence_ref,observed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [newId("event"), newActionId, event.event_type, event.from_state, event.to_state, event.actor_type, event.evidence_ref, event.observed_at]);
    }
    const claimed = await queryOne<any>(`UPDATE demo_invites SET accepted_at=$1,accepted_by=$2,accepted_email=$3,accepted_household_id=$4
      WHERE id=$5 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [now, ctx.authUserId, (ctx.email ?? "").trim().toLowerCase(), householdId, invite.id]);
    if (!claimed) throw new Error("Demo invite was claimed concurrently");
    await exec("INSERT INTO demo_households(household_id,invite_id,template_household_id,cloned_at) VALUES($1,$2,$3,$4)", [householdId, invite.id, invite.template_household_id, now]);
    return { ok: true, householdId };
  });
}

// ---------- Deleting data ----------

/** Removes one member (not the household). Returns nothing to delete beyond this member's own rows. */
export async function removeMember(ctx: HouseholdContext): Promise<void> {
  await requireWritableHousehold(ctx);
  await withTransaction(async () => {
    // Requests survive member departure as household intent; the FK is SET
    // NULL and this explicit update also supports pre-migration SQLite data.
    if (ctx.person) await exec("UPDATE school_requests SET person_id=NULL WHERE person_id=$1", [ctx.person.id]);
    await exec("DELETE FROM auth_links WHERE auth_user_id=$1", [ctx.authUserId]);
    if (ctx.person) await exec("DELETE FROM people WHERE id=$1 AND household_id=$2", [ctx.person.id, ctx.household.id]);
  });
}

/**
 * Deletes a household and everything that hangs off it: students, school
 * relationships, action plans and their history, invites, members. Shared
 * school research (institutions, rules, sources, guidance) is untouched.
 * Returns the sign-in ids of the members who lost access (each keeps their
 * own sign-in; a fresh empty plan is created if they sign in again).
 */
export async function deleteHousehold(householdId: string): Promise<string[]> {
  if (process.env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim() === householdId || await queryOne("SELECT 1 AS ok FROM demo_households WHERE household_id = $1", [householdId])) throw new Error("Private Preview households are read-only.");
  return withTransaction(async () => {
    const members = (await queryRows<any>("SELECT auth_user_id FROM auth_links WHERE household_id=$1", [householdId])).map((r) => r.auth_user_id as string);
    const studentIds = "(SELECT id FROM students WHERE household_id = $1)";
    const relIds = `(SELECT id FROM institution_relationships WHERE student_id IN ${studentIds})`;
    const actionIds = `(SELECT id FROM action_instances WHERE relationship_id IN ${relIds})`;
    await exec(`DELETE FROM action_events WHERE action_id IN ${actionIds}`, [householdId]);
    await exec(`DELETE FROM action_instances WHERE relationship_id IN ${relIds}`, [householdId]);
    await exec(`DELETE FROM institution_relationships WHERE student_id IN ${studentIds}`, [householdId]);
    await exec("DELETE FROM students WHERE household_id=$1", [householdId]);
    await exec("DELETE FROM school_requests WHERE household_id=$1", [householdId]);
    await exec("DELETE FROM household_invites WHERE household_id=$1", [householdId]);
    await exec("DELETE FROM auth_links WHERE household_id=$1", [householdId]);
    await exec("DELETE FROM people WHERE household_id=$1", [householdId]);
    await exec("DELETE FROM households WHERE id=$1", [householdId]);
    return members;
  });
}
