import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

// Local-only compatibility fixture: the release candidate adds nullable research_term
// to legacy Postgres rows. SQLite's newer default NOT NULL schema cannot model that
// without an isolated schema copy. Never change the checked-in SQLite/Production schema.
const originalCwd = process.cwd();
const fixture = mkdtempSync(path.join(tmpdir(), "cp-null-term-"));
const fixtureSchemaDir = path.join(fixture, "lib/db");
mkdirSync(fixtureSchemaDir, { recursive: true });
const schema = readFileSync(path.join(originalCwd, "lib/db/schema.sql"), "utf8");
assert.equal(schema.match(/research_term TEXT NOT NULL DEFAULT 'Fall 2027'/g)?.length, 1);
writeFileSync(path.join(fixtureSchemaDir, "schema.sql"), schema.replace("research_term TEXT NOT NULL DEFAULT 'Fall 2027'", "research_term TEXT"));
process.env.DB_PATH = path.join(fixture, "db.sqlite3");
delete process.env.DATABASE_URL;
delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;
delete process.env.ASSISTANT_MODEL_ENABLED;
process.chdir(fixture);

let C: typeof import("../lib/db/client"), R: typeof import("../lib/db/repo"), A: typeof import("../lib/db/accounts");
let M: typeof import("../lib/db/reminders"), Q: typeof import("../lib/db/ask-campus"), Companion: typeof import("../lib/companion");
let ActionListItem: typeof import("../components/ActionListItem").ActionListItem;
let OfficialDestination: typeof import("../components/OfficialDestination").OfficialDestination;
let householdId: string, studentId: string, relationshipId: string, institutionId: string, sourceId: string;
const legacy = { null: "act_null_term", blank: "act_blank_term", current: "act_current_term", other: "act_other_term" };
const now = () => new Date().toISOString();

async function insertRuleAndAction(id: string, term: string | null, label: string) {
  const stamp = now();
  await C.exec(`INSERT INTO rules(id,institution_id,checkpoint_code,domain,title,requirement,status,confidence,research_term,cycle_state,applicability,evidence_quote,verified_at,source_id,created_at,updated_at)
    VALUES($1,$2,$3,'Admissions',$4,$5,'verified','high',$6,'current','applies',$7,$8,$9,$10,$11)`,
    [`rule_${id}`, institutionId, `ADM-${id}`, label, `Apply by December 15, 2026: ${label}`, term,
      `Admissions ${label} is due December 15, 2026.`, stamp, sourceId, stamp, stamp]);
  await R.upsertGuidance({ ruleId: `rule_${id}`, what: `Submit ${label} by December 15`, when: "December 15, 2026",
    why: "Legacy date claim", how: "Follow prior-cycle instructions", consequence: "Legacy consequence", deepLink: "https://fixture.example.edu/old" });
  await C.exec(`INSERT INTO action_instances(id,relationship_id,rule_id,due_at,applicability_reason,priority,state,created_at,updated_at)
    VALUES($1,$2,$3,'2026-12-15T00:00:00.000Z','legacy applies','high','not_started',$4,$5)`,
    [id, relationshipId, `rule_${id}`, stamp, stamp]);
}

describe("nullable legacy rule term quarantine (synthetic local compatibility schema)", () => {
  before(async () => {
    C = await import("../lib/db/client"); R = await import("../lib/db/repo"); A = await import("../lib/db/accounts");
    M = await import("../lib/db/reminders"); Q = await import("../lib/db/ask-campus"); Companion = await import("../lib/companion");
    ActionListItem = (await import("../components/ActionListItem")).ActionListItem;
    OfficialDestination = (await import("../components/OfficialDestination")).OfficialDestination;
    const owner = await A.provisionAccount({ authUserId: "legacy-fixture-owner", email: "legacy@example.test" });
    householdId = owner.household.id;
    const student = await A.completeOnboarding(owner, { studentName: "Synthetic Student", role: "parent", enteringTerm: "Fall 2027" });
    studentId = student.id;
    const institution = await R.upsertInstitution({ name: "Synthetic Fixture College", slug: "fixture-college", domains: ["fixture.example.edu"] });
    institutionId = institution.id;
    const source = await R.createSource({ institutionId, url: "https://fixture.example.edu/old", label: "Historical instructions", lastVerified: now() });
    sourceId = source.id;
    relationshipId = (await R.upsertRelationship({ studentId, institutionId })).id;
    await insertRuleAndAction(legacy.null, null, "legacy unknown-term requirement");
    await insertRuleAndAction(legacy.blank, "  ", "legacy blank-term requirement");
    await insertRuleAndAction(legacy.current, "Fall 2027", "matriculation checklist");
    await insertRuleAndAction(legacy.other, "Winter 2028", "different-term requirement");
    await C.exec(`INSERT INTO research_versions(institution_id,research_term,coverage_status,coverage_pct,critical_gaps,certified_at,updated_at)
      VALUES($1,'Fall 2027','certified',100,0,$2,$3)`, [institutionId, now(), now()]);
    process.chdir(originalCwd);
  });

  it("keeps NULL/blank terms unknown; direct IDs deny old due date, guidance and source; explicit Fall 2027 remains", async () => {
    const { parseDateStatus } = await import("../lib/date-status");
    const { evaluateRule } = await import("../lib/rules-engine");
    for (const id of [legacy.null, legacy.blank]) {
      const rule = (await R.getRuleById(`rule_${id}`))!;
      assert.equal(rule.researchTerm, null, "no fabricated Fall 2027 mapper default");
      const status = parseDateStatus(rule);
      assert.equal(status.kind, "awaiting");
      assert.doesNotMatch(JSON.stringify(status), /Fall 2027|December 15/);
      assert.equal(await R.getActionInstanceFull(id), null, "direct ID does not project historical content");
      assert.equal((await R.getActionInstance(id))?.dueAt, "2026-12-15T00:00:00.000Z", "stored row is not rewritten");
      const relation = (await R.getRelationship(relationshipId))!;
      assert.equal(evaluateRule(rule, relation, relation.student).applicable, false);
    }
    assert.equal(await R.getActionInstanceFull(legacy.other), null, "direct ID cannot bypass a different entering term");
    const current = (await R.getActionInstanceFull(legacy.current))!;
    assert.equal(current.rule.researchTerm, "Fall 2027");
    assert.equal(current.dueAt, "2026-12-15T00:00:00.000Z");
    assert.equal(current.guidance?.when, "December 15, 2026");
    assert.ok(current.source, "unchanged explicitly termed record remains available to the existing certification gate");
    await assert.rejects(R.upsertRule({ institutionId, checkpointCode: "UNSPECIFIED", domain: "Admissions", title: "Unspecified", critical: false, requirement: "Unspecified", researchTerm: "" }), /researchTerm is required/);
    assert.equal(await R.getRuleByCode(institutionId, "UNSPECIFIED"), null);
  });

  it("filters school, saved plan and dashboard shared lists even when a caller forgets the term; UI cannot show legacy facts", async () => {
    const rows = await R.listActionInstancesForRelationship(relationshipId, "Fall 2027");
    assert.deepEqual(rows.map(a => a.id), [legacy.current]);
    assert.deepEqual(await R.listActionInstancesForRelationship(relationshipId, ""), []);
    assert.deepEqual(await (R.listActionInstancesForRelationship as (id: string) => ReturnType<typeof R.listActionInstancesForRelationship>)(relationshipId), []);
    assert.equal((await R.listActionInstancesForRelationship(relationshipId, "Winter 2028")).length, 1, "explicit other term remains queryable by internal term-bound reads");
    const { partitionTasks } = await import("../lib/task-progress");
    assert.equal(partitionTasks(rows).open.length, 1);
    const source = (await R.getSource(sourceId))!;
    const rule = (await R.getRuleById(`rule_${legacy.null}`))!;
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: "_legacy_" } },
      <ActionListItem action={{ ...(await R.getActionInstance(legacy.null))!, completed: false, rule, guidance: (await R.getGuidanceForRule(rule.id))!, source }} schoolName="Synthetic Fixture College" />));
    assert.match(html, /Research term unconfirmed/);
    assert.doesNotMatch(html, /December 15|2026-12-15|href=|Mark completed|Submit legacy unknown/);
    const destination = renderToStaticMarkup(<OfficialDestination rule={rule} source={source} schoolName="Synthetic Fixture College" />);
    assert.doesNotMatch(destination, /href=|Fall 2027|December 15/);
    const { readFileSync } = await import("node:fs");
    const detail = readFileSync(path.join(originalCwd, "app/action/[id]/page.tsx"), "utf8");
    assert.match(detail, /getActionInstanceFull\(id\)/);
    assert.match(detail, /!action\.rule\.researchTerm\?\.trim\(\)/);
    const dashboard = readFileSync(path.join(originalCwd, "app/dashboard/page.tsx"), "utf8");
    const school = readFileSync(path.join(originalCwd, "app/school/[slug]/page.tsx"), "utf8");
    assert.match(dashboard, /listActionInstancesForRelationship\(relationship\.id, enteringTerm\)/);
    assert.match(school, /listActionInstancesForRelationship\(relationship\.id, term\)/);
  });

  it("blocks legacy action mutations, family completion and reminder enqueue; preserves current action", async () => {
    const { saveFamilyCompletion } = await import("../lib/db/action-completion");
    for (const id of [legacy.null, legacy.blank, legacy.other]) {
      await assert.rejects(saveFamilyCompletion(householdId, id, true), /Action not found/);
      const reminder = await M.enqueueReminder({ actionInstanceId: id, localDate: "2026-12-01", localTime: "12:00" });
      assert.equal(reminder.reason, "not_eligible");
      assert.equal(reminder.reminder, null);
      assert.equal((await R.getActionInstance(id))?.state, "not_started");
    }
    await M.upsertReminderPreferences({ householdId });
    const current = await M.enqueueReminder({ actionInstanceId: legacy.current, localDate: "2026-12-01", localTime: "12:00" });
    assert.equal(current.created, true, "explicit term retains reminder path under existing rules");
    await M.cancelReminder(current.reminder!.id, "local_fixture_cleanup");
    const actionsSource = readFileSync(path.join(originalCwd, "app/actions.ts"), "utf8");
    assert.match(actionsSource, /getActionInstanceFull\(actionId\)/, "server action rechecks guarded direct-ID projection");
    assert.doesNotMatch(actionsSource, /getActionInstance\(actionId\)/);
  });

  it("companion does not project or mutate unfiltered legacy actions", async () => {
    const demo = await R.upsertHousehold({ id: Companion.DEMO_HOUSEHOLD_ID, name: "Synthetic demo" });
    const student = await R.upsertStudent({ householdId: demo.id, name: "Demo Student", gradYear: 2027, attributes: { enteringTerm: "Fall 2027" } });
    const rel = await R.upsertRelationship({ studentId: student.id, institutionId });
    await R.createActionInstance({ relationshipId: rel.id, ruleId: `rule_${legacy.null}`, dueAt: "2026-12-15T00:00:00.000Z", applicabilityReason: "legacy", priority: "high" });
    const control = await R.createActionInstance({ relationshipId: rel.id, ruleId: `rule_${legacy.current}`, dueAt: "2026-12-15T00:00:00.000Z", applicabilityReason: "current", priority: "normal" });
    const url = "https://fixture.example.edu/apply";
    const context = await Companion.getContextForUrl(url);
    assert.equal(context.matched, true);
    if (context.matched) assert.deepEqual(context.actions.map(a => a.id), [control.id]);
    await R.createObservationPattern({ institutionId, workflow: "legacy", urlPattern: "fixture.example.edu/*", signal: "application submitted", impliesState: "submitted", relatedCheckpointCode: `ADM-${legacy.null}` });
    const outcome = await Companion.recordObservation(url, "application submitted");
    assert.deepEqual(outcome.updates, []);
    const demoLegacy = await R.findActionInstance(rel.id, `rule_${legacy.null}`);
    assert.equal(demoLegacy?.state, "not_started");
    await C.exec("UPDATE students SET attributes=$1 WHERE id=$2", [JSON.stringify({ enteringTerm: null }), student.id]);
    const withoutTerm = await Companion.getContextForUrl(url);
    if (withoutTerm.matched) assert.deepEqual(withoutTerm.actions, []);
  });

  it("Ask refuses a fully verified/certified-looking NULL-term citation", async () => {
    process.env.ASSISTANT_ENABLED = "1";
    try {
      const answer = await Q.askCampus({ householdId, actorId: "legacy-fixture-owner", studentId,
        question: "Tell me about legacy unknown-term requirement." });
      assert.equal(answer.kind, "unknown");
      assert.deepEqual(answer.citations, []);
      const ambiguous = await Q.askCampus({ householdId, actorId: "legacy-fixture-owner", studentId,
        question: "Tell me about legacy unknown-term matriculation checklist." });
      assert.equal(ambiguous.kind, "unknown", "a loose current-topic match cannot answer a legacy-topic question");
      assert.deepEqual(ambiguous.citations, []);
      // The exact-term control remains eligible rather than globally disabling Ask.
      const control = await Q.askCampus({ householdId, actorId: "legacy-fixture-owner", studentId,
        question: "Tell me about matriculation checklist." });
      assert.equal(control.kind, "fact");
      assert.equal(control.citations[0].term, "Fall 2027");
    } finally { delete process.env.ASSISTANT_ENABLED; }
  });
});
