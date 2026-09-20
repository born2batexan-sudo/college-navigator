// Private-preview integration checks: local SQLite mirrors production's
// transactional invitation and clone behavior.
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const dir = mkdtempSync(path.join(tmpdir(), "cn-demo-"));
process.env.DB_PATH = path.join(dir, "demo.sqlite3");
delete process.env.DATABASE_URL;
process.env.DEMO_OWNER_EMAIL = "owner@example.com";

type Accounts = typeof import("../lib/db/accounts");
type Repo = typeof import("../lib/db/repo");
type Client = typeof import("../lib/db/client");
let A: Accounts, R: Repo, C: Client;
let template: Awaited<ReturnType<Accounts["provisionAccount"]>>;

async function empty(id: string) { return A.provisionAccount({ authUserId: id, email: `${id}@example.com` }); }

describe("private preview invitations", () => {
  before(async () => {
    A = await import("../lib/db/accounts"); R = await import("../lib/db/repo"); C = await import("../lib/db/client");
    template = await empty("template-owner");
    await A.completeOnboarding(template, { studentName: "Template Student", role: "parent", enteringTerm: "Fall 2027" });
    template = (await A.getContextForUser("template-owner"))!;
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = template.household.id;
    const institution = await R.upsertInstitution({ name: "Preview University", slug: "preview-u", domains: ["preview.edu"] });
    const rule = await R.upsertRule({ institutionId: institution.id, checkpointCode: "PV-01", domain: "Admissions", title: "Submit sample", critical: true, requirement: "Submit the sample." });
    const rel = await R.upsertRelationship({ studentId: template.student!.id, institutionId: institution.id });
    await R.updateRelationshipAttributes(rel.id, { housingPlan: "campus", greekInterest: true, freeForm: "must not copy" });
    const action = await R.createActionInstance({ relationshipId: rel.id, ruleId: rule.id, dueAt: "2027-05-01T00:00:00.000Z", applicabilityReason: "sample", priority: "high", state: "started" });
    await R.createActionEvent({ actionId: action.id, eventType: "state_change", fromState: "not_started", toState: "started", actorType: "student" });
  });

  it("stores hash-only single-use invitations and makes isolated sanitized clones", async () => {
    const beforeTemplate = await C.queryOne<any>("SELECT name,attributes FROM students WHERE id=$1", [template.student!.id]);
    const made = await A.createDemoInvite({ createdBy: "owner", createdEmail: "OWNER@EXAMPLE.COM" });
    const raw = await C.queryOne<any>("SELECT token_hash,created_email FROM demo_invites WHERE token_hash=$1", [createHash("sha256").update(made.token).digest("hex")]);
    assert.equal(raw.created_email, "owner@example.com"); assert.notEqual(raw.token_hash, made.token); assert.match(raw.token_hash, /^[a-f0-9]{64}$/);
    const joining = await empty("preview-one");
    const result = await A.acceptDemoInvite(joining, made.token);
    assert.deepEqual(result.ok, true);
    const cloned = (await A.getContextForUser("preview-one"))!;
    assert.equal(cloned.isDemo, true); assert.equal(cloned.household.name, "Private Preview household"); assert.equal(cloned.student?.name, "Sample Student");
    assert.notEqual(cloned.student?.id, template.student?.id);
    assert.deepEqual(JSON.parse(cloned.student!.attributes), { enteringTerm: "Fall 2027" });
    const rels = await R.listRelationshipsForStudent(cloned.student!.id);
    assert.equal(rels.length, 1); assert.notEqual(rels[0].id, (await R.listRelationshipsForStudent(template.student!.id))[0].id);
    const actions = await R.listActionInstancesForRelationship(rels[0].id, "Fall 2027");
    assert.equal(actions.length, 1); assert.equal(actions[0].state, "started");
    const events = await C.queryOne<any>("SELECT COUNT(*) AS n FROM action_events WHERE action_id=$1", [actions[0].id]); assert.equal(Number(events.n), 1);
    assert.deepEqual(await C.queryOne<any>("SELECT name,attributes FROM students WHERE id=$1", [template.student!.id]), beforeTemplate, "template remains unchanged");
    assert.equal(await C.queryOne("SELECT 1 AS ok FROM school_requests WHERE household_id=$1", [cloned.household.id]), null, "operational requests are not copied");
    await assert.rejects(() => A.requireWritableHousehold(cloned), /read-only/);
    assert.deepEqual(await A.acceptDemoInvite(await empty("preview-two"), made.token), { ok: false, reason: "invalid" });
  });

  it("rejects expired, revoked, populated, and concurrent claims", async () => {
    const expired = await A.createDemoInvite({ createdBy: "owner", createdEmail: "owner@example.com" });
    await C.exec("UPDATE demo_invites SET expires_at=$1 WHERE token_hash=$2", ["2000-01-01T00:00:00.000Z", require("node:crypto").createHash("sha256").update(expired.token).digest("hex")]);
    assert.deepEqual(await A.acceptDemoInvite(await empty("expired"), expired.token), { ok: false, reason: "invalid" });
    const revoked = await A.createDemoInvite({ createdBy: "owner", createdEmail: "owner@example.com" });
    const revokeRow = await C.queryOne<any>("SELECT id FROM demo_invites WHERE token_hash=$1", [require("node:crypto").createHash("sha256").update(revoked.token).digest("hex")]);
    assert.equal(await A.revokeDemoInvite(revokeRow.id, { id: "owner", email: "owner@example.com" }), true);
    assert.deepEqual(await A.acceptDemoInvite(await empty("revoked"), revoked.token), { ok: false, reason: "invalid" });
    const populated = await empty("populated"); await A.completeOnboarding(populated, { studentName: "Real Student", role: "parent" });
    const valid = await A.createDemoInvite({ createdBy: "owner", createdEmail: "owner@example.com" });
    assert.deepEqual(await A.acceptDemoInvite(populated, valid.token), { ok: false, reason: "populated" });
    const a = await empty("race-a"), b = await empty("race-b");
    const race = await A.createDemoInvite({ createdBy: "owner", createdEmail: "owner@example.com" });
    const results = await Promise.all([A.acceptDemoInvite(a, race.token), A.acceptDemoInvite(b, race.token)]);
    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  it("fails closed owner authorization when config is absent or mismatched", () => {
    assert.equal(A.isDemoOwnerEmail("owner@example.com"), true);
    assert.equal(A.isDemoOwnerEmail(" owner@example.com "), true);
    assert.equal(A.isDemoOwnerEmail("other@example.com"), false);
    const owner = process.env.DEMO_OWNER_EMAIL; delete process.env.DEMO_OWNER_EMAIL;
    assert.equal(A.isDemoOwnerEmail("owner@example.com"), false);
    process.env.DEMO_OWNER_EMAIL = owner;
  });
});
