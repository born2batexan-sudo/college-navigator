import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPublicPath } from "../lib/auth/env";
import { appOrigin } from "../lib/auth/origin";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "campus-access-")), "access.sqlite3");
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL = "owner@example.com";
process.env.REQUEST_ACCESS_HASH_SECRET = "local-test-secret";
process.env.ACCESS_CYCLE = "Fall 2027";

let A: typeof import("../lib/db/accounts");
let C: typeof import("../lib/db/client");
let D: typeof import("../lib/db/demo-access");
let G: typeof import("../lib/db/cycle-access");
let hasProductAccess: typeof import("../lib/auth/product-access")["hasProductAccess"];
let B: typeof import("../lib/db/beta-access");
let owner: Awaited<ReturnType<typeof A.provisionAccount>>;
const actor = { id: "owner-auth", email: "owner@example.com" };

async function createUser(id: string, email: string) {
  const ctx = await A.provisionAccount({ authUserId: id, email });
  return { ctx, identity: { id, email } };
}

describe("production product authorization", () => {
  before(async () => {
    A = await import("../lib/db/accounts");
    C = await import("../lib/db/client");
    D = await import("../lib/db/demo-access");
    B = await import("../lib/db/beta-access");
    G = await import("../lib/db/cycle-access");
    ({ hasProductAccess } = await import("../lib/auth/product-access"));
    owner = await A.provisionAccount({ authUserId: actor.id, email: actor.email });
    await A.completeOnboarding(owner, { studentName: "Template", role: "parent", enteringTerm: "Fall 2027" });
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = owner.household.id;
  });

  it("denies a signed-in household without a grant; owner bypass stays available", async () => {
    const { ctx, identity } = await createUser("unapproved-auth", "unapproved@example.com");
    assert.equal(await hasProductAccess(identity, ctx.household.id), false);
    assert.equal(await hasProductAccess(actor, owner.household.id), true);
    assert.equal(await hasProductAccess({ id: actor.id, email: "other@example.com" }, owner.household.id), false);
  });

  it("honors existing complimentary entitlement, expiry and revocation on every check", async () => {
    const { ctx, identity } = await createUser("granted-auth", "grant@example.com");
    await A.completeOnboarding(ctx, { studentName: "Student", role: "parent", enteringTerm: "Fall 2027" });
    await G.grantComplimentary({ householdId: ctx.household.id, actor, reason: "Approved early access", idempotencyKey: "grant-access-test" });
    assert.equal(await hasProductAccess(identity, ctx.household.id), true);
    await C.exec("UPDATE cycle_entitlements SET expires_at=$1 WHERE household_id=$2", ["2000-01-01T00:00:00.000Z", ctx.household.id]);
    assert.equal(await hasProductAccess(identity, ctx.household.id), false);
    await C.exec("UPDATE cycle_entitlements SET expires_at=$1 WHERE household_id=$2", ["2099-01-01T00:00:00.000Z", ctx.household.id]);
    assert.equal(await hasProductAccess(identity, ctx.household.id), true);
    await G.revokeComplimentary({ householdId: ctx.household.id, actor, reason: "Access withdrawn" });
    assert.equal(await hasProductAccess(identity, ctx.household.id), false);
  });

  it("binds the single-use link to email; only same-cycle successful onboarding creates access and ledger", async () => {
    await D.submitDemoAccessRequest({ name: "Requested Person", email: "approved@example.com" });
    const request = await C.queryOne<{ id: string }>("SELECT id FROM demo_access_requests WHERE requester_email=$1", ["approved@example.com"]);
    assert.ok(request);
    const decision = await D.approveDemoAccessRequest({ requestId: request.id, actor });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    const other = await createUser("wrong-auth", "wrong@example.com");
    assert.equal(await B.previewBetaInvite(decision.token, other.identity.email), null);
    assert.equal(await B.acceptBetaInvite(other.ctx, decision.token), "invalid");
    const matching = await createUser("approved-auth", "approved@example.com");
    assert.ok(await B.previewBetaInvite(decision.token, matching.identity.email));
    assert.equal(await hasProductAccess(matching.identity, matching.ctx.household.id), false);
    assert.equal(await B.acceptBetaInvite(matching.ctx, decision.token), "accepted");
    assert.equal(await B.acceptBetaInvite(matching.ctx, decision.token), "invalid");
    assert.equal(await hasProductAccess(matching.identity, matching.ctx.household.id), false);
    assert.equal(await B.hasBetaOnboardingAccess(matching.identity, matching.ctx.household.id), true);
    assert.equal(await B.hasBetaOnboardingAccess({ id: matching.identity.id, email: "changed@example.com" }, matching.ctx.household.id), false);
    const details = { role: "parent" as const, students: [{ name: "Real Student", enteringTerm: "Fall 2027" }], purchaserAttested: true };
    await assert.rejects(() => B.completeBetaOnboarding(matching.ctx, matching.identity.email, { ...details, students: [{ name: "Wrong", enteringTerm: "Fall 2028" }] }), /cycle/);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM students WHERE household_id=$1", [matching.ctx.household.id]), null);
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM cycle_orders WHERE household_id=$1", [matching.ctx.household.id]), null);
    const order = await B.completeBetaOnboarding(matching.ctx, matching.identity.email, details);
    assert.equal(await B.completeBetaOnboarding(matching.ctx, matching.identity.email, details), order);
    assert.equal((await A.getContextForUser(matching.identity.id))?.student?.name, "Real Student");
    assert.equal((await A.getContextForUser(matching.identity.id))?.isDemo, false);
    assert.equal(await hasProductAccess(matching.identity, matching.ctx.household.id), true);
    assert.equal(Number((await C.queryOne<any>("SELECT COUNT(*) AS n FROM cycle_orders WHERE household_id=$1 AND amount_cents=0", [matching.ctx.household.id]))?.n), 1);
    assert.equal(Number((await C.queryOne<any>("SELECT COUNT(*) AS n FROM cycle_accounting_events WHERE order_id=$1 AND kind='complimentary'", [order]))?.n), 1);
    assert.equal(Number((await C.queryOne<any>("SELECT COUNT(*) AS n FROM cycle_audit_events WHERE order_id=$1 AND event_type='complimentary_granted'", [order]))?.n), 1);
    await C.exec("UPDATE beta_access_invites SET expires_at=$1 WHERE request_id=$2", ["2000-01-01T00:00:00.000Z", request.id]);
    assert.equal(await hasProductAccess(matching.identity, matching.ctx.household.id), true, "invitation expiry does not terminate entitlement");
    assert.equal(await D.revokeDemoAccessRequest({ requestId: request.id, actor }), true);
    assert.equal(await hasProductAccess(matching.identity, matching.ctx.household.id), false);
  });

  it("keeps marketing and requests public but denies adjacent product paths", () => {
    for (const p of ["/", "/sample-plan", "/request-access", "/login"]) assert.equal(isPublicPath(p), true, p);
    for (const p of ["/dashboard", "/account", "/api/ask", "/request-access/private", "/request-access-evil", "/ask"]) assert.equal(isPublicPath(p), false, p);
    const landing = readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");
    assert.doesNotMatch(landing, /redirect\("\/dashboard"\)/, "signed-in visitors must also reach marketing");
    assert.match(readFileSync(path.join(process.cwd(), "app/request-access/actions.ts"), "utf8"), /submitDemoAccessRequest/);
    const session = readFileSync(path.join(process.cwd(), "lib/auth/session.ts"), "utf8");
    assert.match(session, /if \(!await hasProductAccess\(user, ctx\.household\.id\)\) redirect\("\/request-access"\)/);
    for (const api of ["app/api/ask/route.ts", "app/api/companion/context/route.ts", "app/api/companion/observe/route.ts"]) {
      const source = readFileSync(path.join(process.cwd(), api), "utf8");
      assert.match(source, /authorizedApiHousehold\(\)/, `${api} must check live access`);
      assert.match(source, /status:403/, `${api} must deny with 403`);
    }
  });

  it("uses only the configured canonical origin, never forwarded host, for mail links", () => {
    const previous = process.env.APP_ORIGIN;
    try {
      process.env.APP_ORIGIN = "https://campus.example";
      assert.equal(appOrigin(), "https://campus.example");
      for (const invalid of ["https://evil.example/path", "http://evil.example", "https://evil.example?next=x", "https://user:pw@evil.example"]) {
        process.env.APP_ORIGIN = invalid;
        assert.throws(() => appOrigin());
      }
      delete process.env.APP_ORIGIN;
      assert.throws(() => appOrigin(), /APP_ORIGIN/);
      const mail = readFileSync(path.join(process.cwd(), "lib/db/demo-access.ts"), "utf8");
      assert.match(mail, /const origin = appOrigin\(\)/);
      assert.doesNotMatch(mail, /x-forwarded-host|input\.origin/);
    } finally {
      if (previous === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previous;
    }
  });
});
