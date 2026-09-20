// Provider-neutral closed-loop validation tests. This suite uses only the
// local SQLite database and normalized adapter-shaped inputs.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "cn-email-validation-"));
process.env.DB_PATH = path.join(dir, "email.sqlite3");
delete process.env.DATABASE_URL;
process.env.EMAIL_VALIDATION_REPLAY_SECRET = "test-only-replay-key";
process.env.EMAIL_FORWARDING_DOMAIN = "inbound.example.test";

let A: typeof import("../lib/db/accounts");
let R: typeof import("../lib/db/repo");
let D: typeof import("../lib/db/client");
let E: typeof import("../lib/db/email-validation");
let ctx: Awaited<ReturnType<typeof A.provisionAccount>>;
let inst: Awaited<ReturnType<typeof R.upsertInstitution>>;
let action: Awaited<ReturnType<typeof R.createActionInstance>>;
let alias: Awaited<ReturnType<typeof E.issueIntakeAlias>>;

async function evidence(overrides: Partial<import("../lib/db/email-validation").NormalizedEmailEvidence> = {}) {
  return E.ingestNormalizedEvidence({
    alias: alias.forwardingAddress,
    institutionId: inst.id,
    enteringTerm: "Fall 2027",
    checkpointCode: "ADM-01",
    senderDomain: "admissions.example.edu",
    provenanceClass: "authenticated_original",
    authenticationResult: "authenticated",
    signal: "received",
    replayKey: `key-${Math.random()}`,
    ...overrides,
  });
}

describe("paid forwarding-first email validation", () => {
  before(async () => {
    A = await import("../lib/db/accounts");
    R = await import("../lib/db/repo");
    D = await import("../lib/db/client");
    E = await import("../lib/db/email-validation");
    inst = await R.upsertInstitution({ name: "Email Example", slug: "email-example", domains: ["example.edu"] });
    const source = await R.createSource({ institutionId: inst.id, url: "https://admissions.example.edu/status", label: "Official status guidance", lastVerified: new Date().toISOString() });
    const rule = await R.upsertRule({ institutionId: inst.id, checkpointCode: "ADM-01", domain: "Admissions", title: "Transcript", critical: true, requirement: "Transcript received", researchTerm: "Fall 2027", status: "verified", confidence: "high", applicability: "applies", cycleState: "current", sourceId: source.id, evidenceQuote: "The institution confirms receipt through its official status channel." });
    ctx = await A.provisionAccount({ authUserId: "email-owner", email: "owner@example.com" });
    const student = await A.completeOnboarding(ctx, { studentName: "Email Student", role: "parent", enteringTerm: "Fall 2027" });
    const rel = await R.upsertRelationship({ studentId: student.id, institutionId: inst.id });
    action = await R.createActionInstance({ relationshipId: rel.id, ruleId: rule.id, dueAt: null, applicabilityReason: "test", priority: "normal", state: "submitted" });
    await E.provisionEmailValidationEntitlement({ householdId: ctx.household.id, entitlementState: "paid", provisionedBy: "test-billing" });
    await E.setEmailValidationConsent({ householdId: ctx.household.id, ownerAuthUserId: "email-owner", consented: true });
    await E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: "admissions.example.edu", curatedBy: "reviewer" });
    alias = await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
  });

  it("has no mailbox/content columns and requires owner consent plus active entitlement", async () => {
    const names = await D.queryRows<any>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_validation_entitlements','intake_aliases','normalized_email_evidence')");
    const columns: string[] = [];
    for (const table of names) for (const row of await D.queryRows<any>(`PRAGMA table_info(${table.name})`)) columns.push(row.name);
    assert.deepEqual(columns.filter((name) => /mime|subject|body|attachment|local.?part|message.?id|mailbox|password|oauth|imap/i.test(name)), []);
    const other = await A.provisionAccount({ authUserId: "no-consent", email: "no-consent@example.com" });
    await E.provisionEmailValidationEntitlement({ householdId: other.household.id, entitlementState: "paid", provisionedBy: "test-billing" });
    await assert.rejects(() => E.issueIntakeAlias({ householdId: other.household.id, ownerAuthUserId: "no-consent" }), /access is not_entitled/);
    const unprovisioned = await A.provisionAccount({ authUserId: "unprovisioned", email: "unprovisioned@example.com" });
    await assert.rejects(() => E.setEmailValidationConsent({ householdId: unprovisioned.household.id, ownerAuthUserId: "unprovisioned", consented: true }), /must be provisioned/);
  });

  it("fails closed when keyed replay protection is not configured", async () => {
    const prior = process.env.EMAIL_VALIDATION_REPLAY_SECRET;
    delete process.env.EMAIL_VALIDATION_REPLAY_SECRET;
    await assert.rejects(() => evidence({ replayKey: "missing-key" }), /replay protection is not configured/);
    process.env.EMAIL_VALIDATION_REPLAY_SECRET = prior;
  });

  it("hashes aliases, rotates one-at-a-time, and revokes the old address", async () => {
    const row = await D.queryOne<any>("SELECT alias_hash FROM intake_aliases WHERE id=$1", [alias.id]);
    assert.notEqual(row.alias_hash, alias.forwardingAddress);
    assert.equal((await E.rotateIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" })).forwardingAddress === alias.forwardingAddress, false);
    assert.equal(await E.ingestNormalizedEvidence({ alias: alias.forwardingAddress, institutionId: inst.id, enteringTerm: "Fall 2027", checkpointCode: "ADM-01", senderDomain: "admissions.example.edu", provenanceClass: "authenticated_original", authenticationResult: "authenticated", signal: "received", replayKey: "old-alias" }).then((d) => d.reasonCode), "invalid_alias");
    alias = await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    assert.equal(await E.revokeIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }), true);
  });

  it("rejects wildcard/generic domains and does not accept a suffix-only match", async () => {
    await assert.rejects(() => E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: ".edu" }), /exact/);
    await assert.rejects(() => E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: "other.edu" }), /approved domain/);
    await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }).then((next) => { alias = next; });
    const result = await evidence({ senderDomain: "other.example.edu" });
    assert.equal(result.reasonCode, "domain_mismatch");
  });

  it("applies only an authenticated exact positive transition and suppresses replay", async () => {
    // The previous test left a fresh alias and the action remains submitted.
    const beforeResearch = await D.queryOne<any>("SELECT updated_at FROM rules WHERE id=$1", [action.ruleId]);
    const input = { alias: alias.forwardingAddress, institutionId: inst.id, enteringTerm: "Fall 2027", checkpointCode: "ADM-01", senderDomain: "admissions.example.edu", provenanceClass: "authenticated_original" as const, authenticationResult: "authenticated" as const, signal: "received" as const, replayKey: "unique-positive" };
    const applied = await E.ingestNormalizedEvidence(input);
    assert.equal(applied.status, "applied");
    assert.equal(applied.toState, "received");
    assert.equal((await R.getActionInstance(action.id))?.state, "received");
    const replay = await E.ingestNormalizedEvidence(input);
    assert.equal(replay.reasonCode, "replay_suppressed");
    assert.equal((await D.queryOne<any>("SELECT updated_at FROM rules WHERE id=$1", [action.ruleId])).updated_at, beforeResearch.updated_at);
  });

  it("requires exact term, certified family-visible research, and never downgrades", async () => {
    const wrongTerm = await evidence({ enteringTerm: "Winter 2028" });
    assert.equal(wrongTerm.reasonCode, "no_exact_match");
    const unsafeRule = await R.upsertRule({ institutionId: inst.id, checkpointCode: "ADM-02", domain: "Admissions", title: "Unsafe draft", critical: false, requirement: "Draft requirement", researchTerm: "Fall 2027", status: "unverified", confidence: "low", applicability: "applies", cycleState: "current" });
    await R.createActionInstance({ relationshipId: action.relationshipId, ruleId: unsafeRule.id, dueAt: null, applicabilityReason: "internal-only", priority: "normal", state: "submitted" });
    const unsafe = await evidence({ checkpointCode: "ADM-02", replayKey: "unsafe-rule" });
    assert.equal(unsafe.reasonCode, "no_exact_match");
    const noDowngrade = await evidence({ signal: "received" });
    assert.equal(noDowngrade.reasonCode, "illegal_transition");
    assert.equal((await R.getActionInstance(action.id))?.state, "received");
  });

  it("makes forwarding suggestions and quarantines authentication failures", async () => {
    const forwarded = await evidence({ provenanceClass: "forwarded_arc", replayKey: "forwarded" });
    assert.equal(forwarded.status, "suggestion");
    assert.equal((await R.getActionInstance(action.id))?.state, "received");
    const failed = await evidence({ authenticationResult: "failed", replayKey: "failed" });
    assert.equal(failed.reasonCode, "auth_failure");
    const quoted = await evidence({ provenanceClass: "quoted_sender", replayKey: "quoted" });
    assert.equal(quoted.reasonCode, "auth_failure");
  });

  it("excludes demo/template households and supports pause/revoke/delete controls", async () => {
    await E.provisionEmailValidationEntitlement({ householdId: ctx.household.id, entitlementState: "paid", provisionedBy: "test-billing" });
    await E.setEmailValidationConsent({ householdId: ctx.household.id, ownerAuthUserId: "email-owner", consented: true });
    await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }).then((next) => { alias = next; });
    await E.pauseEmailValidation({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    assert.equal((await evidence({ replayKey: "paused" })).reasonCode, "paused");
    await E.resumeEmailValidation({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = ctx.household.id;
    await assert.rejects(() => E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }), /excluded/);
    delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;
    await E.provisionEmailValidationEntitlement({ householdId: ctx.household.id, entitlementState: "paid", provisionedBy: "test-billing" });
    await E.setEmailValidationConsent({ householdId: ctx.household.id, ownerAuthUserId: "email-owner", consented: true });
    await E.deleteEmailValidationData({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    assert.equal(await D.queryOne("SELECT 1 AS ok FROM intake_aliases WHERE household_id=$1", [ctx.household.id]), null);
    assert.ok(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM email_status_events WHERE household_id=$1", [ctx.household.id]))?.n ?? 0) > 0);
  });
});
