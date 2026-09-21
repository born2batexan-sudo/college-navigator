// Private demo access-request workflow checks. Uses local SQLite only.
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "cn-demo-access-"));
process.env.DB_PATH = path.join(dir, "access.sqlite3");
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL = "owner@example.com";
process.env.REQUEST_ACCESS_HASH_SECRET = "test-request-secret";

let A: typeof import("../lib/db/accounts");
let C: typeof import("../lib/db/client");
let D: typeof import("../lib/db/demo-access");
let templateId = "";

describe("private demo access requests", () => {
  before(async () => {
    A = await import("../lib/db/accounts");
    C = await import("../lib/db/client");
    D = await import("../lib/db/demo-access");
    const owner = await A.provisionAccount({ authUserId: "access-template-owner", email: "owner@example.com" });
    await A.completeOnboarding(owner, { studentName: "Sample", role: "parent", enteringTerm: "Fall 2027" });
    templateId = owner.household.id;
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = templateId;
  });

  it("acknowledges duplicates generically and records abuse/audit controls", async () => {
    assert.deepEqual(await D.submitDemoAccessRequest({ name: "Taylor Example", email: "Taylor@Example.com", ipAddress: "203.0.113.9" }), { accepted: true });
    assert.deepEqual(await D.submitDemoAccessRequest({ name: "Other Name", email: "taylor@example.com", ipAddress: "203.0.113.9" }), { accepted: true });
    const row = await C.queryOne<any>("SELECT requester_email,requester_email_hash,status FROM demo_access_requests");
    assert.deepEqual(row.status, "pending");
    assert.equal(row.requester_email, "taylor@example.com");
    assert.match(row.requester_email_hash, /^[a-f0-9]{64}$/);
    assert.equal(Number((await C.queryOne<any>("SELECT COUNT(*) AS n FROM demo_access_requests"))?.n), 1);
    const audit = await C.queryOne<any>("SELECT COUNT(*) AS n FROM demo_access_audit_events WHERE detail_code='duplicate_active'");
    assert.equal(Number(audit.n), 1);
    for (let i = 0; i < 4; i++) await D.submitDemoAccessRequest({ name: `Bot ${i}`, email: `bot-${i}@example.com`, ipAddress: "203.0.113.9" });
    await D.submitDemoAccessRequest({ name: "Bot over limit", email: "bot-over@example.com", ipAddress: "203.0.113.9" });
    assert.equal(Number((await C.queryOne<any>("SELECT COUNT(*) AS n FROM demo_access_requests WHERE requester_ip_hash IS NOT NULL"))?.n), 5);
    assert.ok(Number((await C.queryOne<any>("SELECT COUNT(*) AS n FROM demo_access_audit_events WHERE detail_code='rate_limited'"))?.n) >= 1);
  });

  it("approves once, queues without delivery, and revokes an unclaimed invite", async () => {
    const submitted = await D.submitDemoAccessRequest({ name: "Morgan Example", email: "morgan@example.com", ipAddress: "203.0.113.10" });
    assert.deepEqual(submitted, { accepted: true });
    const request = await C.queryOne<any>("SELECT id FROM demo_access_requests WHERE requester_email='morgan@example.com'");
    const approved = await D.approveDemoAccessRequest({ requestId: request.id, actor: { id: "owner", email: "OWNER@EXAMPLE.COM" } });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.match(approved.token, /^[A-Za-z0-9_-]{43}$/);
    const invite = await C.queryOne<any>("SELECT token_hash,access_request_id FROM demo_invites WHERE access_request_id=$1", [request.id]);
    assert.equal(invite.access_request_id, request.id);
    assert.notEqual(invite.token_hash, approved.token);
    const notification = await C.queryOne<any>("SELECT delivery_state,payload_json FROM demo_access_notifications WHERE request_id=$1 AND kind='approved'", [request.id]);
    assert.equal(notification.delivery_state, "queued_no_provider");
    assert.doesNotMatch(notification.payload_json, new RegExp(approved.token));
    assert.equal(await D.revokeDemoAccessRequest({ requestId: request.id, actor: { id: "owner", email: "owner@example.com" } }), true);
    assert.deepEqual(await D.approveDemoAccessRequest({ requestId: request.id, actor: { id: "owner", email: "owner@example.com" } }), { ok: false, reason: "not_pending" });
    assert.equal(await C.queryOne<any>("SELECT status FROM demo_access_requests WHERE id=$1", [request.id]).then((r) => r.status), "revoked");
  });
});
