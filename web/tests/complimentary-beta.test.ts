import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "cn-beta-")), "beta.sqlite3");
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL = "owner@example.com";
process.env.REQUEST_ACCESS_HASH_SECRET = "beta-test-secret";
process.env.ACCESS_CYCLE = "Fall 2027";
let A: typeof import("../lib/db/accounts");
let C: typeof import("../lib/db/client");
let B: typeof import("../lib/db/beta-access");
let D: typeof import("../lib/db/demo-access");
let P: typeof import("../lib/auth/product-access");
const actor = { id: "beta-owner", email: "owner@example.com" };
const setup = { role: "parent" as const, purchaserAttested: true, students: [{ name: "Avery", enteringTerm: "Fall 2027" }] };
async function approved(email: string) {
  await D.submitDemoAccessRequest({ name: "Beta Tester", email });
  const request = await C.queryOne<{ id: string }>("SELECT id FROM demo_access_requests WHERE requester_email=$1", [email]);
  assert.ok(request);
  const invite = await D.approveDemoAccessRequest({ requestId: request.id, actor });
  assert.equal(invite.ok, true);
  if (!invite.ok) throw new Error("Approval failed");
  return { ...invite, requestId: request.id };
}

describe("owner-approved founding-family access", () => {
  before(async () => {
    A = await import("../lib/db/accounts"); C = await import("../lib/db/client");
    B = await import("../lib/db/beta-access"); D = await import("../lib/db/demo-access");
    P = await import("../lib/auth/product-access");
    await A.provisionAccount({ authUserId: actor.id, email: actor.email });
  });
  it("rejects expiry and changed cycle before acceptance or onboarding, with no ledger or students", async () => {
    const pre = await approved("expired-before@example.com");
    const user = await A.provisionAccount({ authUserId: "expired-before", email: "expired-before@example.com" });
    await C.exec("UPDATE beta_access_invites SET expires_at=$1 WHERE request_id=$2", ["2000-01-01T00:00:00.000Z", pre.requestId]);
    assert.equal(await B.previewBetaInvite(pre.token, user.email), null);
    assert.equal(await B.acceptBetaInvite(user, pre.token), "invalid");
    const later = await approved("expired-after@example.com");
    const next = await A.provisionAccount({ authUserId: "expired-after", email: "expired-after@example.com" });
    assert.equal(await B.acceptBetaInvite(next, later.token), "accepted");
    process.env.ACCESS_CYCLE = "Fall 2028";
    try {
      assert.equal(await B.hasBetaOnboardingAccess({ id: next.authUserId, email: next.email }, next.household.id), false);
      await assert.rejects(() => B.completeBetaOnboarding(next, next.email, setup), /cycle|available/);
    } finally { process.env.ACCESS_CYCLE = "Fall 2027"; }
    await C.exec("UPDATE beta_access_invites SET expires_at=$1 WHERE request_id=$2", ["2000-01-01T00:00:00.000Z", later.requestId]);
    assert.equal(await B.hasBetaOnboardingAccess({ id: next.authUserId, email: next.email }, next.household.id), false);
    await assert.rejects(() => B.completeBetaOnboarding(next, next.email, setup), /expired/);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM students WHERE household_id=$1", [next.household.id]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM cycle_accounting_events"), null);
  });
  it("rolls back the whole onboarding transaction if the ledger write fails; retry is idempotent", async () => {
    const invite = await approved("retry@example.com");
    const ctx = await A.provisionAccount({ authUserId: "retry", email: "retry@example.com" });
    assert.equal(await B.acceptBetaInvite(ctx, invite.token), "accepted");
    await C.exec("CREATE TRIGGER fail_beta_ledger BEFORE INSERT ON cycle_accounting_events BEGIN SELECT RAISE(ABORT,'ledger unavailable'); END");
    await assert.rejects(() => B.completeBetaOnboarding(ctx, ctx.email, setup), /ledger unavailable/);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM students WHERE household_id=$1", [ctx.household.id]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM cycle_orders WHERE household_id=$1", [ctx.household.id]), null);
    await C.exec("DROP TRIGGER fail_beta_ledger");
    const order = await B.completeBetaOnboarding(ctx, ctx.email, setup);
    assert.equal(await B.completeBetaOnboarding(ctx, ctx.email, setup), order);
    assert.equal(await P.hasProductAccess({ id: ctx.authUserId, email: ctx.email }, ctx.household.id), true);
    await C.exec("UPDATE beta_access_invites SET expires_at=$1 WHERE request_id=$2", ["2000-01-01T00:00:00.000Z", invite.requestId]);
    assert.equal(await B.completeBetaOnboarding(ctx, ctx.email, setup), order, "completed retry remains idempotent after invitation expiry");
    assert.deepEqual(await A.deleteHousehold(ctx.household.id), [ctx.authUserId]);
    assert.equal((await C.queryOne<{ household_id: string | null }>("SELECT household_id FROM cycle_orders WHERE id=$1", [order]))?.household_id, null);
    assert.equal((await C.queryOne<{ accepted_household_id: string | null }>("SELECT accepted_household_id FROM beta_access_invites WHERE request_id=$1", [invite.requestId]))?.accepted_household_id, null);
  });
  it("revoke after acceptance closes onboarding without creating accounting", async () => {
    const invite = await approved("revoked@example.com");
    const ctx = await A.provisionAccount({ authUserId: "revoked", email: "revoked@example.com" });
    assert.equal(await B.acceptBetaInvite(ctx, invite.token), "accepted");
    assert.equal(await D.revokeDemoAccessRequest({ requestId: invite.requestId, actor }), true);
    assert.equal(await B.hasBetaOnboardingAccess({ id: ctx.authUserId, email: ctx.email }, ctx.household.id), false);
    await assert.rejects(() => B.completeBetaOnboarding(ctx, ctx.email, setup), /available/);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM cycle_orders WHERE household_id=$1", [ctx.household.id]), null);
  });
  it("bypasses checkout but enforces ten distinct household-cycle colleges through the authorized request flow", async () => {
    const Q = await import("../lib/db/requests");
    const K = await import("../lib/db/college-coverage");
    const { collegeCoverageEnforced } = await import("../lib/payments/college-coverage");
    const invite = await approved("ten-colleges@example.com");
    const ctx = await A.provisionAccount({ authUserId: "ten-colleges", email: "ten-colleges@example.com" });
    assert.equal(await B.acceptBetaInvite(ctx, invite.token), "accepted");
    await B.completeBetaOnboarding(ctx, ctx.email, setup);
    assert.equal(await P.hasProductAccess({ id: ctx.authUserId, email: ctx.email }, ctx.household.id), true);
    assert.equal((await C.queryOne<{ amount_cents: number; kind: string }>("SELECT amount_cents,kind FROM cycle_orders WHERE household_id=$1", [ctx.household.id]))?.amount_cents, 0);
    assert.equal((await C.queryOne<{ kind: string }>("SELECT kind FROM cycle_orders WHERE household_id=$1", [ctx.household.id]))?.kind, "complimentary");
    assert.equal(collegeCoverageEnforced({}), false, "payment coverage experiment is off");
    for (let i = 0; i < 11; i++) await Q.upsertDirectorySchool({ unitid: String(850000 + i), name: `Official School ${i}`, domain: "school.example.edu" });
    await C.exec("INSERT INTO institutions(id,name,slug,created_at) VALUES($1,$2,$3,$4)", ["inst_beta_0", "Beta School Zero", "beta-school-zero", new Date().toISOString()]);
    await C.exec("UPDATE school_directory SET institution_id=$1 WHERE unitid=$2", ["inst_beta_0", "850000"]);
    await K.requireBetaTrackedCollege({ householdId: ctx.household.id, cycle: "Fall 2027", institutionId: "inst_beta_0" });
    assert.equal((await K.getCollegeCoverageSummary(ctx.household.id, "Fall 2027")).coveredUnits, 1);
    await C.exec("INSERT INTO institutions(id,name,slug,created_at) VALUES($1,$2,$3,$4)", ["inst_beta_11", "Beta School Eleven", "beta-school-eleven", new Date().toISOString()]);
    await assert.rejects(() => K.requireBetaTrackedCollege({ householdId: ctx.household.id, cycle: "Fall 2027", institutionId: "inst_beta_11" }),
      (error: unknown) => error instanceof K.CollegeCoverageBlockedError && error.reason === "invalid_college");
    assert.equal((await K.getCollegeCoverageSummary(ctx.household.id, "Fall 2027")).coveredUnits, 1, "unmapped internal IDs consume no capacity");
    await C.exec("UPDATE school_directory SET institution_id=$1 WHERE unitid=$2", ["inst_beta_11", "850010"]);
    await assert.rejects(() => K.assertBetaAccessCycle(ctx.household.id, "Fall 2028"),
      (error: unknown) => error instanceof K.CollegeCoverageBlockedError && error.reason === "invalid_cycle");
    for (let i = 0; i < 10; i++) {
      const requested = await Q.createSchoolRequest({ householdId: ctx.household.id, personId: ctx.person?.id, unitid: String(850000 + i), term: "Fall 2027" });
      assert.equal(requested.created, true);
      // The existing three-per-calendar-month rate limit is independent of lifetime cycle coverage.
      await C.exec("UPDATE school_requests SET created_at=$1 WHERE id=$2", [`2025-${String(1 + i).padStart(2, "0")}-01T00:00:00.000Z`, requested.request.id]);
    }
    const summary = await K.getCollegeCoverageSummary(ctx.household.id, "Fall 2027");
    assert.equal(summary.coveredCollegeIds.length, 10, "tracked and requested canonical school counts once");
    assert.equal(summary.remainingUnits, 0);
    await assert.rejects(() => K.requireBetaTrackedCollege({ householdId: ctx.household.id, cycle: "Fall 2027", institutionId: "inst_beta_11" }),
      (error: unknown) => error instanceof K.CollegeCoverageBlockedError && error.reason === "capacity_exhausted");
    assert.equal((await Q.createSchoolRequest({ householdId: ctx.household.id, unitid: "850000", term: "Fall 2027" })).created, false);
    await assert.rejects(() => Q.createSchoolRequest({ householdId: ctx.household.id, unitid: "850010", term: "Fall 2027" }),
      (error: unknown) => error instanceof K.CollegeCoverageBlockedError && error.reason === "capacity_exhausted");
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM school_requests WHERE household_id=$1 AND unitid=$2", [ctx.household.id, "850010"]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM college_addon_purchases WHERE household_id=$1", [ctx.household.id]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM cycle_accounting_events WHERE order_id IN (SELECT id FROM cycle_orders WHERE household_id=$1) AND kind='payment'", [ctx.household.id]), null);
    assert.equal(await D.revokeDemoAccessRequest({ requestId: invite.requestId, actor }), true);
    assert.equal(await P.hasProductAccess({ id: ctx.authUserId, email: ctx.email }, ctx.household.id), false);
    await assert.rejects(() => K.requireBetaTrackedCollege({ householdId: ctx.household.id, cycle: "Fall 2027", institutionId: "inst_beta_0" }),
      (error: unknown) => error instanceof K.CollegeCoverageBlockedError && error.reason === "no_active_entitlement");
  });
  it("reserves the combined lifetime 25-household complimentary capacity at approval", async () => {
    // Two onboarded beta households consume slots. Expired reservations and a revoked
    // invitation release their reservation without erasing past $0 orders.
    for (let i = 0; i < 23; i++) await approved(`capacity-${i}@example.com`);
    await D.submitDemoAccessRequest({ name: "Overflow", email: "capacity-overflow@example.com" });
    const row = await C.queryOne<{ id: string }>("SELECT id FROM demo_access_requests WHERE requester_email='capacity-overflow@example.com'");
    assert.ok(row);
    await assert.rejects(() => D.approveDemoAccessRequest({ requestId: row.id, actor }), /cap reached/);
    assert.equal((await C.queryOne<{status:string}>("SELECT status FROM demo_access_requests WHERE id=$1", [row.id]))?.status, "pending");
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM beta_access_invites WHERE request_id=$1", [row.id]), null);
    process.env.ACCESS_CYCLE = "Fall 2029";
    try { await assert.rejects(() => D.approveDemoAccessRequest({ requestId: row.id, actor }), /not supported/); }
    finally { process.env.ACCESS_CYCLE = "Fall 2027"; }
  });
});
