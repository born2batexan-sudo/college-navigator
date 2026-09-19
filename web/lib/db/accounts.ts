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
import { exec, queryOne, queryRows, newId, nowIso, usingPostgres } from "./client";
import { upsertStudent } from "./repo";
import type { Household, Person, Student } from "./types";

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
};

// ---------- Schema (self-creating on Postgres) ----------

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
];

let ensurePromise: Promise<void> | null = null;

/**
 * Postgres only (SQLite creates everything from schema.sql on boot):
 *  1. creates the two account tables if they do not exist, and
 *  2. turns on Row Level Security for every table. Supabase exposes every
 *     table in the public schema through its REST API to anyone holding the
 *     project's public "anon" key; with RLS on and no policies, that door is
 *     closed. The app itself is unaffected because it connects as the table
 *     owner (which bypasses RLS). RLS is only enabled after checking that.
 * Safe to run repeatedly; memoized per server instance.
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
  for (const stmt of ACCOUNT_DDL) {
    try {
      await exec(stmt);
    } catch {
      // Two cold starts creating the same table at once can collide.
      // CREATE ... IF NOT EXISTS is safe to simply try again.
      await new Promise((r) => setTimeout(r, 300));
      await exec(stmt);
    }
  }
  try {
    const probe = await queryOne<{ ok: boolean }>(
      `SELECT (
         COALESCE((SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user), false)
         OR COALESCE((SELECT tableowner = current_user FROM pg_tables WHERE schemaname = 'public' AND tablename = 'households'), false)
       ) AS ok`
    );
    if (probe?.ok) {
      for (const t of ALL_TABLES) {
        await exec(`ALTER TABLE IF EXISTS ${t} ENABLE ROW LEVEL SECURITY`);
      }
    } else {
      console.error("[accounts] skipped enabling row level security: this database role does not own the tables");
    }
  } catch (err) {
    console.error("[accounts] could not enable row level security:", err);
  }
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
  return {
    authUserId,
    email: link.email,
    link,
    household: toHousehold(hh),
    person: person ? toPerson(person) : null,
    student: student ? toStudent(student) : null,
    isOwner: link.role === "owner",
  };
}

export const ENTERING_CLASS_YEAR = 2027;

export async function completeOnboarding(
  ctx: HouseholdContext,
  input: { studentName: string; role: "parent" | "student" }
): Promise<Student> {
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
    attributes: {},
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
  const tokenHash = hashToken(token);
  const inv = await queryOne<any>(
    "SELECT * FROM household_invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > $2",
    [tokenHash, nowIso()]
  );
  if (!inv) return { ok: false, reason: "invalid" };
  if (inv.household_id === ctx.household.id) return { ok: true, alreadyMember: true };

  const memberCount = Number((await queryOne<any>("SELECT COUNT(*) AS n FROM auth_links WHERE household_id = $1", [ctx.household.id]))?.n ?? 0);
  if (ctx.student || memberCount > 1) return { ok: false, reason: "has_own_family" };

  // Claim the invite first; only one caller can win.
  const claimed = await queryOne<any>(
    "UPDATE household_invites SET accepted_at = $1, accepted_by = $2 WHERE id = $3 AND accepted_at IS NULL RETURNING id",
    [nowIso(), ctx.authUserId, inv.id]
  );
  if (!claimed) return { ok: false, reason: "invalid" };

  const oldHouseholdId = ctx.household.id;
  const oldPersonId = ctx.person?.id ?? null;
  const newPersonId = newId("person");
  await exec(
    "INSERT INTO people (id, household_id, name, role, email, phone, consent_state, created_at) VALUES ($1, $2, $3, $4, $5, NULL, 'pending', $6)",
    [newPersonId, inv.household_id, ctx.email ? ctx.email.split("@")[0] : "Member", inv.invited_role, ctx.email, nowIso()]
  );
  await exec("UPDATE auth_links SET household_id = $1, person_id = $2, role = 'member' WHERE auth_user_id = $3", [
    inv.household_id,
    newPersonId,
    ctx.authUserId,
  ]);
  // Remove the empty household created at sign-up.
  if (oldPersonId) await exec("DELETE FROM people WHERE id = $1", [oldPersonId]);
  await exec("DELETE FROM households WHERE id = $1", [oldHouseholdId]);
  return { ok: true, alreadyMember: false };
}

// ---------- Deleting data ----------

/** Removes one member (not the household). Returns nothing to delete beyond this member's own rows. */
export async function removeMember(ctx: HouseholdContext): Promise<void> {
  await exec("DELETE FROM auth_links WHERE auth_user_id = $1", [ctx.authUserId]);
  if (ctx.person) await exec("DELETE FROM people WHERE id = $1", [ctx.person.id]);
}

/**
 * Deletes a household and everything that hangs off it: students, school
 * relationships, action plans and their history, invites, members. Shared
 * school research (institutions, rules, sources, guidance) is untouched.
 * Returns the sign-in ids of the members who lost access (each keeps their
 * own sign-in; a fresh empty plan is created if they sign in again).
 */
export async function deleteHousehold(householdId: string): Promise<string[]> {
  const members = (await queryRows<any>("SELECT auth_user_id FROM auth_links WHERE household_id = $1", [householdId])).map(
    (r) => r.auth_user_id as string
  );
  const studentIds = "(SELECT id FROM students WHERE household_id = $1)";
  const relIds = `(SELECT id FROM institution_relationships WHERE student_id IN ${studentIds})`;
  const actionIds = `(SELECT id FROM action_instances WHERE relationship_id IN ${relIds})`;
  await exec(`DELETE FROM action_events WHERE action_id IN ${actionIds}`, [householdId]);
  await exec(`DELETE FROM action_instances WHERE relationship_id IN ${relIds}`, [householdId]);
  await exec(`DELETE FROM institution_relationships WHERE student_id IN ${studentIds}`, [householdId]);
  await exec("DELETE FROM students WHERE household_id = $1", [householdId]);
  await exec("DELETE FROM household_invites WHERE household_id = $1", [householdId]);
  await exec("DELETE FROM auth_links WHERE household_id = $1", [householdId]);
  await exec("DELETE FROM people WHERE household_id = $1", [householdId]);
  await exec("DELETE FROM households WHERE id = $1", [householdId]);
  return members;
}
