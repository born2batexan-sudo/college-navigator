// Two-family isolation and account tests. Run with: npm test
// Uses a throwaway local SQLite file, never a real database.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "cn-isolation-"));
process.env.DB_PATH = path.join(dir, "test.sqlite3");
delete process.env.DATABASE_URL;

type Accounts = typeof import("../lib/db/accounts");
type Repo = typeof import("../lib/db/repo");
type Client = typeof import("../lib/db/client");
let A: Accounts, R: Repo, C: Client;

async function newFamily(userId: string, student: string) {
  const ctx = await A.provisionAccount({ authUserId: userId, email: `${userId}@example.com` });
  await A.completeOnboarding(ctx, { studentName: student, role: "parent" });
  return (await A.getContextForUser(userId))!;
}

describe("accounts and household isolation", () => {
  let famA: Awaited<ReturnType<typeof newFamily>>;
  let famB: Awaited<ReturnType<typeof newFamily>>;
  let inst: { id: string };
  const ids: Record<string, { rel: string; action: string }> = {};

  before(async () => {
    A = await import("../lib/db/accounts");
    R = await import("../lib/db/repo");
    C = await import("../lib/db/client");

    inst = await R.upsertInstitution({ name: "Test University", slug: "test-u", domains: ["test.edu"] });
    const rule = await R.upsertRule({
      institutionId: inst.id,
      checkpointCode: "TST-01",
      domain: "Admissions",
      title: "Pay the deposit",
      critical: true,
      requirement: "Pay the deposit.",
    });

    famA = await newFamily("user-a", "Alex");
    famB = await newFamily("user-b", "Blair");
    for (const [key, fam] of [["a", famA], ["b", famB]] as const) {
      const rel = await R.upsertRelationship({ studentId: fam.student!.id, institutionId: inst.id });
      const action = await R.createActionInstance({
        relationshipId: rel.id,
        ruleId: rule.id,
        dueAt: null,
        applicabilityReason: "test",
        priority: "normal",
        state: "not_started",
      });
      ids[key] = { rel: rel.id, action: action.id };
    }
  });

  it("gives each sign-in its own household and student", () => {
    assert.notEqual(famA.household.id, famB.household.id);
    assert.equal(famA.student?.name, "Alex");
    assert.equal(famB.student?.name, "Blair");
    assert.equal(famA.household.name, "Alex's family");
    assert.equal(famA.isOwner, true);
  });

  it("provisioning is idempotent, including two simultaneous first requests", async () => {
    const again = await A.provisionAccount({ authUserId: "user-a", email: "user-a@example.com" });
    assert.equal(again.household.id, famA.household.id);

    const [c1, c2] = await Promise.all([
      A.provisionAccount({ authUserId: "user-c", email: "c@example.com" }),
      A.provisionAccount({ authUserId: "user-c", email: "c@example.com" }),
    ]);
    assert.equal(c1.household.id, c2.household.id);
    const n = await C.queryOne<any>("SELECT COUNT(*) AS n FROM auth_links WHERE auth_user_id = $1", ["user-c"]);
    assert.equal(Number(n.n), 1);
  });

  it("onboarding twice does not create a second student", async () => {
    const before = famA.student!.id;
    const second = await A.completeOnboarding(famA, { studentName: "Someone Else", role: "parent" });
    assert.equal(second.id, before);
    assert.equal(second.name, "Alex");
  });

  it("a family passes ownership checks for its own data only", async () => {
    for (const [mine, theirs, fam, other] of [
      ["a", "b", famA, famB],
      ["b", "a", famB, famA],
    ] as const) {
      assert.equal(await A.studentBelongsToHousehold(fam.student!.id, fam.household.id), true);
      assert.equal(await A.relationshipBelongsToHousehold(ids[mine].rel, fam.household.id), true);
      assert.equal(await A.actionBelongsToHousehold(ids[mine].action, fam.household.id), true);

      assert.equal(await A.studentBelongsToHousehold(other.student!.id, fam.household.id), false);
      assert.equal(await A.relationshipBelongsToHousehold(ids[theirs].rel, fam.household.id), false);
      assert.equal(await A.actionBelongsToHousehold(ids[theirs].action, fam.household.id), false);
    }
    assert.equal(await A.actionBelongsToHousehold("nope", famA.household.id), false);
    assert.equal(await A.actionBelongsToHousehold(ids.a.action, "nope"), false);
  });

  it("invites: only an empty new account can join; links are single-use, expire, and are capped", async () => {
    const made = await A.createInvite(famA, "student");
    assert.ok(made.ok);
    if (!made.ok) return;
    assert.ok((await A.previewInvite(made.token))?.householdName);
    assert.equal(await A.previewInvite("wrong-token"), null);

    // Family B already has a student: cannot be moved by a link.
    const blocked = await A.acceptInvite(famB, made.token);
    assert.deepEqual(blocked, { ok: false, reason: "has_own_family" });

    // A brand-new sign-in can join.
    const dCtx = await A.provisionAccount({ authUserId: "user-d", email: "d@example.com" });
    const oldHousehold = dCtx.household.id;
    const joined = await A.acceptInvite(dCtx, made.token);
    assert.equal(joined.ok, true);
    const dAfter = (await A.getContextForUser("user-d"))!;
    assert.equal(dAfter.household.id, famA.household.id);
    assert.equal(dAfter.isOwner, false);
    assert.equal(dAfter.student?.id, famA.student!.id);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM households WHERE id = $1", [oldHousehold]), null, "empty household removed");
    assert.equal((await A.listMembers(famA.household.id)).length, 2);

    // Single use.
    const eCtx = await A.provisionAccount({ authUserId: "user-e", email: "e@example.com" });
    assert.deepEqual(await A.acceptInvite(eCtx, made.token), { ok: false, reason: "invalid" });

    // Expired.
    const exp = await A.createInvite(famA, "parent");
    assert.ok(exp.ok);
    if (exp.ok) {
      await C.exec("UPDATE household_invites SET expires_at = $1 WHERE token_hash IS NOT NULL AND accepted_at IS NULL", ["2000-01-01T00:00:00.000Z"]);
      assert.deepEqual(await A.acceptInvite(eCtx, exp.token), { ok: false, reason: "invalid" });
    }

    // Cap on open invites.
    for (let i = 0; i < 5; i++) assert.ok((await A.createInvite(famA, "parent")).ok);
    assert.deepEqual(await A.createInvite(famA, "parent"), { ok: false, reason: "too_many" });
  });

  it("a member removing themself leaves the household and its data intact", async () => {
    const d = (await A.getContextForUser("user-d"))!;
    await A.removeMember(d);
    assert.equal(await A.getContextForUser("user-d"), null);
    assert.equal(await A.actionBelongsToHousehold(ids.a.action, famA.household.id), true);
    const back = await A.provisionAccount({ authUserId: "user-d", email: "d@example.com" });
    assert.notEqual(back.household.id, famA.household.id, "signing in again starts a fresh empty plan");
  });

  it("deleting a household removes that family's data and nothing else", async () => {
    await A.deleteHousehold(famA.household.id);

    assert.equal(await C.queryOne("SELECT 1 AS ok FROM households WHERE id = $1", [famA.household.id]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM students WHERE id = $1", [famA.student!.id]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM action_instances WHERE id = $1", [ids.a.action]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM auth_links WHERE auth_user_id = $1", ["user-a"]), null);

    // Family B and the shared school research are untouched.
    assert.equal(await A.actionBelongsToHousehold(ids.b.action, famB.household.id), true);
    assert.ok(await C.queryOne("SELECT 1 AS ok FROM institutions WHERE id = $1", [inst.id]));
    assert.ok(await C.queryOne("SELECT 1 AS ok FROM rules WHERE institution_id = $1", [inst.id]));
    assert.ok(await A.getContextForUser("user-b"));
  });

  it("the self-creating table statements match schema.sql exactly", () => {
    const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\s*;\s*/g, ";").trim();
    const schema = norm(readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf-8"));
    for (const stmt of A.ACCOUNT_DDL) assert.ok(schema.includes(norm(stmt)), `schema.sql is missing: ${stmt.slice(0, 60)}`);
  });

  it("row level security covers every table in schema.sql", () => {
    const schema = readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf-8");
    const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
    assert.deepEqual([...A.ALL_TABLES].sort(), tables);
  });
});
