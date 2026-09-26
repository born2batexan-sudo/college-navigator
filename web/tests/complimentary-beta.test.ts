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
  it("reserves the combined lifetime 25-household complimentary capacity at approval", async () => {
    // The earlier three approvals include two expired reservations and one revoked,
    // leaving the successfully onboarded family as a consumed slot.
    for (let i = 0; i < 24; i++) await approved(`capacity-${i}@example.com`);
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
