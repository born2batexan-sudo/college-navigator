import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { parseDateStatus } from "../lib/date-status";
import { isOuAidDateHeld, OU_AID_HOLD } from "../lib/ou-aid-quarantine";
import { evaluateRule } from "../lib/rules-engine";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "cp-ou-hold-")), "fixture.sqlite3");
delete process.env.DATABASE_URL;
delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;
let R: typeof import("../lib/db/repo");
let A: typeof import("../lib/db/accounts");
let M: typeof import("../lib/db/reminders");
let Mat: typeof import("../lib/materialize");
let Q: typeof import("../lib/db/ask-campus");
let C: typeof import("../lib/db/client");
let ActionListItem: typeof import("../components/ActionListItem").ActionListItem;
let OfficialDestination: typeof import("../components/OfficialDestination").OfficialDestination;
let relationshipId: string;
let heldActionId: string;
let controlActionId: string;
let heldRuleId: string;

// Snapshot of the read-only staging OU AID-03 finding on 2026-10-01, not
// fabricated task titles. The fixture is local SQLite only; no staging writes.
describe("OU Fall 2027 AID-03 official-date conflict quarantine", () => {
  before(async () => {
    A = await import("../lib/db/accounts"); R = await import("../lib/db/repo");
    M = await import("../lib/db/reminders"); Mat = await import("../lib/materialize"); C = await import("../lib/db/client"); Q = await import("../lib/db/ask-campus");
    ActionListItem = (await import("../components/ActionListItem")).ActionListItem;
    OfficialDestination = (await import("../components/OfficialDestination")).OfficialDestination;
    const account = await A.provisionAccount({ authUserId: "ou-hold-fixture", email: "fixture@example.test" });
    const student = await A.completeOnboarding(account, { studentName: "Fixture Student", role: "parent", enteringTerm: "Fall 2027" });
    await C.exec("INSERT INTO institutions (id,name,slug,domains,pathway,coverage_status,coverage_pct,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [OU_AID_HOLD.institutionId, "University of Oklahoma", "ou-hold-fixture", '["ou.edu"]', "both", "research", 0, new Date().toISOString()]);
    const relationship = await R.upsertRelationship({ studentId: student.id, institutionId: OU_AID_HOLD.institutionId });
    relationshipId = relationship.id;
    const source = await R.createSource({ institutionId: OU_AID_HOLD.institutionId, url: "https://www.ou.edu/admissions/apply/freshman/faq", label: "Freshman Admissions FAQ", lastVerified: "2026-09-10T00:00:00.000Z" });
    const heldRule = await R.upsertRule({ institutionId: OU_AID_HOLD.institutionId, checkpointCode: "AID-03", domain: "Financial Aid", title: "Priority aid deadline verified", critical: true,
      requirement: "OU's priority FAFSA deadline is December 15", deadlineExpr: "2026-12-15", status: "verified", confidence: "high", applicability: "applies", cycleState: "current", researchTerm: "Fall 2027", sourceId: source.id,
      evidenceQuote: "Admissions FAQ says priority FAFSA deadline December 15." });
    heldRuleId = heldRule.id;
    await R.upsertGuidance({ ruleId: heldRule.id, what: "Submit financial aid forms by the priority deadline", when: "Complete by December 15, 2026", why: "Do this before December 15", how: "Submit by December 15", consequence: "Missing December 15 may delay aid" });
    const held = await R.createActionInstance({ relationshipId, ruleId: heldRule.id, dueAt: "2026-12-15T00:00:00.000Z", applicabilityReason: "Applies to student", priority: "high" });
    heldActionId = held.id;
    const control = await R.upsertRule({ institutionId: OU_AID_HOLD.institutionId, checkpointCode: "AID-04", domain: "Financial Aid", title: "Different aid checkpoint", critical: false,
      requirement: "Another requirement", deadlineExpr: "2027-02-01", status: "verified", confidence: "high", applicability: "applies", cycleState: "current", researchTerm: "Fall 2027", sourceId: source.id, evidenceQuote: "Separate deadline February 1" });
    controlActionId = (await R.createActionInstance({ relationshipId, ruleId: control.id, dueAt: "2027-02-01T00:00:00.000Z", applicabilityReason: "Applies", priority: "normal" })).id;
  });

  it("quarantines a verified/current persisted rule and prevents new materialization of its date", async () => {
    const full = (await R.getActionInstanceFull(heldActionId))!;
    assert.equal(full.rule.title, "Priority aid deadline verified");
    assert.equal(full.rule.deadlineExpr, "2026-12-15", "stored evidence stays unchanged");
    assert.equal(parseDateStatus(full.rule).kind, "awaiting");
    assert.equal(evaluateRule(full.rule, full.relationship, full.relationship.student).applicable, true);
    const evaluated = evaluateRule(full.rule, full.relationship, full.relationship.student);
    if (evaluated.applicable) assert.equal(evaluated.dueAt, null);
    assert.equal(full.dueAt, null, "legacy persisted due date never projects to detail");
    assert.equal(full.guidance, null);
    assert.equal(full.source, null, "FAQ is not a verified task destination for this cycle");
    assert.equal(full.priority, "normal", "legacy urgency does not sort or count as due");
    const rows = await R.listActionInstancesForRelationship(relationshipId, "Fall 2027");
    assert.equal(rows.find(a => a.id === heldActionId)?.dueAt, null);
    assert.equal(rows.find(a => a.id === controlActionId)?.dueAt, "2027-02-01T00:00:00.000Z");
    await Mat.materializeActionsForRelationship(relationshipId);
    assert.equal((await R.getActionInstance(heldActionId))?.dueAt, null, "future local materialization does not recreate disputed date");
  });

  it("hides old date, guidance and task link even after editorial title/label/source changes", async () => {
    const full = (await R.getActionInstanceFull(heldActionId))!;
    const rawSource = (await R.getSource(full.rule.sourceId!))!;
    for (const title of [full.rule.title, "Entirely renamed research rule"]) {
      const alteredRule = { ...full.rule, title };
      const source = { ...rawSource, label: "Renamed official page", url: "https://www.ou.edu/sfc/dates-and-deadlines" };
      const destination = renderToStaticMarkup(<OfficialDestination rule={alteredRule} source={source} schoolName="University of Oklahoma" />);
      assert.match(destination, /on hold/);
      assert.doesNotMatch(destination, /href=/);
      const card = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: "_test_" } },
        <ActionListItem action={{ ...full, rule: alteredRule, guidance: { id: "legacy", ruleId: full.rule.id, what: "Complete by December 15", when: "December 15, 2026", why: "", how: "Do by December 15", consequence: "", deepLink: null, generatedBy: "fixture", createdAt: "", updatedAt: "" }, source }} schoolName="University of Oklahoma" />));
      assert.match(card, /Priority FAFSA timing.*school confirmation needed/);
      assert.match(card, /Date unresolved/);
      assert.doesNotMatch(card, /December 15|2026-12-15|href="https:\/\//i);
      assert.doesNotMatch(card, /Mark completed|Mark Complete/);
    }
    assert.equal(isOuAidDateHeld({ ...full.rule, checkpointCode: "ADM-01" }), false);
    assert.equal(isOuAidDateHeld({ ...full.rule, researchTerm: "Fall 2028" }), false);
    assert.equal(isOuAidDateHeld({ ...full.rule, institutionId: "other" }), false);
  });

  it("refuses a fully certified-looking Ask citation for this disputed identity", async () => {
    const full = (await R.getActionInstanceFull(heldActionId))!;
    const stamp = new Date(Date.now() - 5000).toISOString();
    await C.exec("UPDATE rules SET verified_at=$1,updated_at=$1 WHERE id=$2", [stamp, heldRuleId]);
    await C.exec("UPDATE sources SET last_verified=$1 WHERE id=$2", [stamp, full.rule.sourceId]);
    await C.exec("INSERT INTO research_versions(institution_id,research_term,coverage_status,coverage_pct,critical_gaps,certified_at,updated_at) VALUES($1,$2,'certified',100,0,$3,$4)",
      [OU_AID_HOLD.institutionId, OU_AID_HOLD.researchTerm, new Date().toISOString(), new Date().toISOString()]);
    process.env.ASSISTANT_ENABLED = "1";
    try {
      const answer = await Q.askCampus({ householdId: full.relationship.student.householdId, actorId: "ou-hold-fixture", studentId: full.relationship.student.id,
        question: "Tell me about University of Oklahoma priority aid." });
      assert.equal(answer.kind, "unknown");
      assert.equal(answer.citations.length, 0);
      await C.exec("UPDATE rules SET checkpoint_code=$1 WHERE id=$2", ["AID-03-local-control", heldRuleId]);
      try {
        const control = await Q.askCampus({ householdId: full.relationship.student.householdId, actorId: "ou-hold-fixture", studentId: full.relationship.student.id,
          question: "Tell me about University of Oklahoma priority aid." });
        assert.equal(control.kind, "fact", "otherwise eligible quote isolates the OU identity safeguard");
      } finally { await C.exec("UPDATE rules SET checkpoint_code=$1 WHERE id=$2", ["AID-03", heldRuleId]); }
    } finally { delete process.env.ASSISTANT_ENABLED; }
  });

  it("refuses reminder enqueue and rejects send of a previously queued row after identity changes", async () => {
    const held = await M.enqueueReminder({ actionInstanceId: heldActionId, localDate: "2026-12-01", localTime: "12:00", timezone: "America/Chicago" });
    assert.equal(held.created, false);
    assert.equal(held.reason, "not_eligible");
    // A reminder queued for an unrelated checkpoint must become unsafe if its
    // stored rule is later found to be the audited OU identity.
    const queued = await M.enqueueReminder({ actionInstanceId: controlActionId, localDate: "2027-01-01", localTime: "12:00", timezone: "America/Chicago" });
    assert.equal(queued.created, true);
    await C.exec("UPDATE rules SET checkpoint_code=$1 WHERE id=$2", ["AID-03-prior-local-fixture", heldRuleId]);
    await C.exec("UPDATE rules SET checkpoint_code=$1 WHERE id=$2", ["AID-03", (await R.getActionInstanceFull(controlActionId))!.rule.id]);
    await assert.rejects(M.recordReminderDeliveryEvent({ reminderId: queued.reminder!.id, state: "sent" }), /not eligible for dispatch/);
    const repeat = await M.enqueueReminder({ actionInstanceId: controlActionId, localDate: "2027-01-01", localTime: "12:00", timezone: "America/Chicago" });
    assert.equal(repeat.reminder, null, "idempotent path cannot resurrect queued item");
    assert.equal((await M.reconcileReminders()).canceled, 1);
    assert.equal((await M.getReminder(queued.reminder!.id))?.deliveryState, "canceled");
    assert.equal((await R.getActionInstance(heldActionId))?.ruleId, heldRuleId);
  });
});
