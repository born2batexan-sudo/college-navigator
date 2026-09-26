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
process.env.EMAIL_VALIDATION_REPLAY_SECRET = "test-only-replay-key-012345678901234567890";
process.env.EMAIL_VALIDATION_NORMALIZER_SECRET = "test-only-normalizer-secret-012345678901234567890";
process.env.EMAIL_VALIDATION_ADMIN_USER_IDS = "test-billing,reviewer";
process.env.EMAIL_FORWARDING_DOMAIN = "inbound.example.test";

let A: typeof import("../lib/db/accounts");
let R: typeof import("../lib/db/repo");
let D: typeof import("../lib/db/client");
let E: typeof import("../lib/db/email-validation");
let ctx: Awaited<ReturnType<typeof A.provisionAccount>>;
let inst: Awaited<ReturnType<typeof R.upsertInstitution>>;
let action: Awaited<ReturnType<typeof R.createActionInstance>>;
let alias: Awaited<ReturnType<typeof E.issueIntakeAlias>>;
let trusted: import("../lib/db/email-validation").TrustedNormalizedEnvelopeContext;

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
  }, trusted);
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
    await D.exec("INSERT INTO research_versions(institution_id,research_term,coverage_status,coverage_pct,critical_gaps,certified_at,updated_at) VALUES($1,$2,'certified',100,0,$3,$4)", [inst.id, "Fall 2027", new Date().toISOString(), new Date().toISOString()]);
    trusted = E.createTrustedNormalizedEnvelopeContext();
    await E.provisionEmailValidationEntitlement({ householdId: ctx.household.id, entitlementState: "paid", adminAuthUserId: "test-billing" });
    await E.setEmailValidationConsent({ householdId: ctx.household.id, ownerAuthUserId: "email-owner", consented: true });
    await E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: "admissions.example.edu", adminAuthUserId: "reviewer" });
    alias = await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
  });

  it("has no mailbox/content columns and requires owner consent plus active entitlement", async () => {
    const names = await D.queryRows<any>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_validation_entitlements','intake_aliases','normalized_email_evidence')");
    const columns: string[] = [];
    for (const table of names) for (const row of await D.queryRows<any>(`PRAGMA table_info(${table.name})`)) columns.push(row.name);
    assert.deepEqual(columns.filter((name) => /mime|subject|body|attachment|local.?part|message.?id|mailbox|password|oauth|imap/i.test(name)), []);
    const other = await A.provisionAccount({ authUserId: "no-consent", email: "no-consent@example.com" });
    await E.provisionEmailValidationEntitlement({ householdId: other.household.id, entitlementState: "paid", adminAuthUserId: "test-billing" });
    await assert.rejects(() => E.issueIntakeAlias({ householdId: other.household.id, ownerAuthUserId: "no-consent" }), /access is not_entitled/);
    const unprovisioned = await A.provisionAccount({ authUserId: "unprovisioned", email: "unprovisioned@example.com" });
    await assert.rejects(() => E.setEmailValidationConsent({ householdId: unprovisioned.household.id, ownerAuthUserId: "unprovisioned", consented: true }), /must be provisioned/);
  });

  it("requires trusted server-side admin identity for provisioning and sender policy changes", async () => {
    const other = await A.provisionAccount({ authUserId: "admin-boundary", email: "admin-boundary@example.com" });
    await assert.rejects(() => E.provisionEmailValidationEntitlement({ householdId: other.household.id, entitlementState: "paid", adminAuthUserId: "attacker" }), /admin authorization/);
    await assert.rejects(() => E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: "www.example.edu", curatedBy: "reviewer" }), /authorization/);
    await assert.rejects(() => E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: "www.example.edu", adminAuthUserId: "attacker" }), /admin authorization/);
    await assert.rejects(() => E.revokeInstitutionSenderPolicy("missing", { authUserId: "attacker" }), /admin authorization/);
  });

  it("requires a trusted normalizer capability and fails closed when it is missing", async () => {
    await assert.rejects(() => E.ingestNormalizedEvidence({} as any), /Trusted normalized-envelope capability is required/);
    const prior = process.env.EMAIL_VALIDATION_NORMALIZER_SECRET;
    delete process.env.EMAIL_VALIDATION_NORMALIZER_SECRET;
    await assert.rejects(async () => E.createTrustedNormalizedEnvelopeContext(), /capability is not configured/);
    process.env.EMAIL_VALIDATION_NORMALIZER_SECRET = prior;
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
    assert.equal(await E.ingestNormalizedEvidence({ alias: alias.forwardingAddress, institutionId: inst.id, enteringTerm: "Fall 2027", checkpointCode: "ADM-01", senderDomain: "admissions.example.edu", provenanceClass: "authenticated_original", authenticationResult: "authenticated", signal: "received", replayKey: "old-alias" }, trusted).then((d) => d.reasonCode), "invalid_alias");
    alias = await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    assert.equal(await E.revokeIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }), true);
  });

  it("rejects wildcard/generic domains, preserves www, and does not accept a suffix-only match", async () => {
    await assert.rejects(() => E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: ".edu", adminAuthUserId: "reviewer" }), /exact/);
    await assert.rejects(() => E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: "other.edu", adminAuthUserId: "reviewer" }), /approved domain/);
    const www = await E.createInstitutionSenderPolicy({ institutionId: inst.id, senderDomain: "www.example.edu", adminAuthUserId: "reviewer" });
    assert.equal(www.senderDomain, "www.example.edu");
    const stored = await D.queryOne<any>("SELECT sender_domain FROM institution_sender_policies WHERE id=$1", [www.id]);
    assert.equal(stored.sender_domain, "www.example.edu");
    await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }).then((next) => { alias = next; });
    const result = await evidence({ senderDomain: "other.example.edu" });
    assert.equal(result.reasonCode, "domain_mismatch");
  });

  it("applies only an authenticated exact positive transition and suppresses replay", async () => {
    // The previous test left a fresh alias and the action remains submitted.
    const beforeResearch = await D.queryOne<any>("SELECT updated_at FROM rules WHERE id=$1", [action.ruleId]);
    const input = { alias: alias.forwardingAddress, institutionId: inst.id, enteringTerm: "Fall 2027", checkpointCode: "ADM-01", senderDomain: "admissions.example.edu", provenanceClass: "authenticated_original" as const, authenticationResult: "authenticated" as const, signal: "received" as const, replayKey: "unique-positive" };
    const applied = await E.ingestNormalizedEvidence(input, trusted);
    assert.equal(applied.status, "applied");
    assert.equal(applied.toState, "received");
    assert.equal((await R.getActionInstance(action.id))?.state, "received");
    const replay = await E.ingestNormalizedEvidence(input, trusted);
    assert.equal(replay.reasonCode, "replay_suppressed");
    assert.equal((await D.queryOne<any>("SELECT updated_at FROM rules WHERE id=$1", [action.ruleId])).updated_at, beforeResearch.updated_at);
  });

  it("serializes replay claims and action compare-and-set transitions", async () => {
    await R.updateActionInstance(action.id, { state: "submitted" });
    const same = { alias: alias.forwardingAddress, institutionId: inst.id, enteringTerm: "Fall 2027", checkpointCode: "ADM-01", senderDomain: "admissions.example.edu", provenanceClass: "authenticated_original" as const, authenticationResult: "authenticated" as const, signal: "received" as const, replayKey: "concurrent-replay-key" };
    const beforeEvidence = Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0);
    const [first, second] = await Promise.all([E.ingestNormalizedEvidence(same, trusted), E.ingestNormalizedEvidence(same, trusted)]);
    assert.deepEqual(new Set([first.reasonCode, second.reasonCode]), new Set(["applied", "replay_suppressed"]));
    assert.equal((await R.getActionInstance(action.id))?.state, "received");
    assert.equal(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0), beforeEvidence + 1);
  });

  it("scopes replay suppression to the household", async () => {
    await R.updateActionInstance(action.id, { state: "submitted" });
    const other = await A.provisionAccount({ authUserId: "shared-replay-owner", email: "shared-replay@example.com" });
    const otherStudent = await A.completeOnboarding(other, { studentName: "Shared Replay Student", role: "parent", enteringTerm: "Fall 2027" });
    const otherRelationship = await R.upsertRelationship({ studentId: otherStudent.id, institutionId: inst.id });
    const otherAction = await R.createActionInstance({ relationshipId: otherRelationship.id, ruleId: action.ruleId, dueAt: null, applicabilityReason: "shared-replay-test", priority: "normal", state: "submitted" });
    await E.provisionEmailValidationEntitlement({ householdId: other.household.id, entitlementState: "paid", adminAuthUserId: "test-billing" });
    await E.setEmailValidationConsent({ householdId: other.household.id, ownerAuthUserId: "shared-replay-owner", consented: true });
    const otherAlias = await E.issueIntakeAlias({ householdId: other.household.id, ownerAuthUserId: "shared-replay-owner" });
    const replayKey = "same-provider-key-in-two-households";
    const firstBefore = Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0);
    const secondBefore = Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [other.household.id]))?.n ?? 0);
    const first = await evidence({ replayKey });
    const second = await E.ingestNormalizedEvidence({
      alias: otherAlias.forwardingAddress,
      institutionId: inst.id,
      enteringTerm: "Fall 2027",
      checkpointCode: "ADM-01",
      senderDomain: "admissions.example.edu",
      provenanceClass: "authenticated_original",
      authenticationResult: "authenticated",
      signal: "received",
      replayKey,
    }, trusted);
    assert.equal(first.status, "applied");
    assert.equal(second.status, "applied");
    assert.equal((await R.getActionInstance(action.id))?.state, "received");
    assert.equal((await R.getActionInstance(otherAction.id))?.state, "received");
    const evidenceCounts = await D.queryRows<any>("SELECT household_id,COUNT(*) AS n FROM normalized_email_evidence WHERE household_id IN ($1,$2) GROUP BY household_id", [ctx.household.id, other.household.id]);
    assert.deepEqual(new Map(evidenceCounts.map((row) => [row.household_id, Number(row.n)])), new Map([[ctx.household.id, firstBefore + 1], [other.household.id, secondBefore + 1]]));
    assert.equal(await D.queryOne("SELECT 1 AS ok FROM email_status_events WHERE household_id=$1 AND event_type='replay_suppressed'", [other.household.id]), null);
  });

  it("rejects cross-institution action/rule links and excludes them from evidence matching", async () => {
    const foreignInstitution = await R.upsertInstitution({ name: "Foreign Email Example", slug: "foreign-email-example", domains: ["foreign.example.edu"] });
    const foreignSource = await R.createSource({ institutionId: foreignInstitution.id, url: "https://foreign.example.edu/admissions", label: "Foreign official status guidance", lastVerified: new Date().toISOString() });
    const foreignRule = await R.upsertRule({ institutionId: foreignInstitution.id, checkpointCode: "ADM-X", domain: "Admissions", title: "Foreign checkpoint", critical: false, requirement: "Foreign requirement", researchTerm: "Fall 2027", status: "verified", confidence: "high", applicability: "applies", cycleState: "current", sourceId: foreignSource.id, evidenceQuote: "The foreign institution confirms this checkpoint through its official status channel." });
    await D.exec("INSERT INTO research_versions(institution_id,research_term,coverage_status,coverage_pct,critical_gaps,certified_at,updated_at) VALUES($1,$2,'certified',100,0,$3,$4)", [foreignInstitution.id, "Fall 2027", new Date().toISOString(), new Date().toISOString()]);
    await assert.rejects(() => R.createActionInstance({ relationshipId: action.relationshipId, ruleId: foreignRule.id, dueAt: null, applicabilityReason: "invalid-cross-institution-link", priority: "normal", state: "submitted" }), /same institution/);
    const invalidActionId = D.newId("invalid_action");
    const now = D.nowIso();
    await D.exec("INSERT INTO action_instances(id,relationship_id,rule_id,due_at,applicability_reason,priority,state,created_at,updated_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8)", [invalidActionId, action.relationshipId, foreignRule.id, "legacy-invalid-link", "normal", "submitted", now, now]);
    const result = await evidence({ checkpointCode: "ADM-X", replayKey: "cross-institution-candidate" });
    assert.equal(result.reasonCode, "no_exact_match");
  });

  it("requires exact term, certified family-visible research, and never downgrades", async () => {
    await D.exec("UPDATE research_versions SET coverage_status='beta' WHERE institution_id=$1 AND research_term=$2", [inst.id, "Fall 2027"]);
    assert.equal((await evidence({ replayKey: "noncertified" })).reasonCode, "no_exact_match");
    await D.exec("UPDATE research_versions SET coverage_status='certified' WHERE institution_id=$1 AND research_term=$2", [inst.id, "Fall 2027"]);
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
    await E.provisionEmailValidationEntitlement({ householdId: ctx.household.id, entitlementState: "paid", adminAuthUserId: "test-billing" });
    await E.setEmailValidationConsent({ householdId: ctx.household.id, ownerAuthUserId: "email-owner", consented: true });
    await E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }).then((next) => { alias = next; });
    await E.pauseEmailValidation({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    const beforePaused = Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0);
    assert.equal((await evidence({ replayKey: "paused" })).reasonCode, "paused");
    assert.equal(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0), beforePaused);
    await E.resumeEmailValidation({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = ctx.household.id;
    await assert.rejects(() => E.issueIntakeAlias({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" }), /excluded/);
    const beforeDemo = Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0);
    assert.equal((await evidence({ replayKey: "demo-excluded" })).reasonCode, "demo_excluded");
    assert.equal(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0), beforeDemo);
    delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;
    await E.provisionEmailValidationEntitlement({ householdId: ctx.household.id, entitlementState: "paid", adminAuthUserId: "test-billing" });
    await E.setEmailValidationConsent({ householdId: ctx.household.id, ownerAuthUserId: "email-owner", consented: true });
    assert.ok(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]))?.n ?? 0) > 0);
    assert.ok(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM email_task_matches WHERE household_id=$1", [ctx.household.id]))?.n ?? 0) > 0);
    await E.deleteEmailValidationData({ householdId: ctx.household.id, ownerAuthUserId: "email-owner" });
    assert.equal(await D.queryOne("SELECT 1 AS ok FROM intake_aliases WHERE household_id=$1", [ctx.household.id]), null);
    assert.equal(await D.queryOne("SELECT 1 AS ok FROM normalized_email_evidence WHERE household_id=$1", [ctx.household.id]), null);
    assert.equal(await D.queryOne("SELECT 1 AS ok FROM email_task_matches WHERE household_id=$1", [ctx.household.id]), null);
    assert.equal(await D.queryOne("SELECT 1 AS ok FROM email_validation_entitlements WHERE household_id=$1", [ctx.household.id]), null);
    assert.ok(Number((await D.queryOne<any>("SELECT COUNT(*) AS n FROM email_status_events WHERE household_id=$1 AND event_type='feature_deleted'", [ctx.household.id]))?.n ?? 0) >= 1);
  });
});
