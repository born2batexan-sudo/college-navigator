import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { OfficialDestination, verifiedOfficialUrl } from "../components/OfficialDestination";
import type { Rule, Source } from "../lib/db/types";
import { partitionTasks } from "../lib/task-progress";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "cp-task-completion-")), "task.sqlite3");
delete process.env.DATABASE_URL;
let A: typeof import("../lib/db/accounts"), R: typeof import("../lib/db/repo"), S: typeof import("../lib/db/action-completion");
let first: Awaited<ReturnType<typeof A.provisionAccount>>;
let second: Awaited<ReturnType<typeof A.provisionAccount>>;
let ids: string[];
let source: Source, rule: Rule;

describe("independent household task completion and official destinations", () => {
  before(async () => {
    A = await import("../lib/db/accounts"); R = await import("../lib/db/repo"); S = await import("../lib/db/action-completion");
    first = await A.provisionAccount({ authUserId: "task-owner-a", email: "a@example.test" });
    second = await A.provisionAccount({ authUserId: "task-owner-b", email: "b@example.test" });
    await A.completeOnboarding(first, { studentName: "Fictional A", role: "parent", enteringTerm: "Fall 2027" });
    await A.completeOnboarding(second, { studentName: "Fictional B", role: "parent", enteringTerm: "Fall 2027" });
    first = (await A.getContextForUser("task-owner-a"))!;
    second = (await A.getContextForUser("task-owner-b"))!;
    const school = await R.upsertInstitution({ name: "Fiction University", slug: "fiction-u", domains: ["fiction.example.edu"] });
    source = await R.createSource({ institutionId: school.id, url: "https://fiction.example.edu/aid", label: "Aid instructions", lastVerified: "2026-09-10T00:00:00Z" });
    const relationship = await R.upsertRelationship({ studentId: first.student!.id, institutionId: school.id });
    const otherRelationship = await R.upsertRelationship({ studentId: second.student!.id, institutionId: school.id });
    ids = [];
    for (const [index, rel] of [relationship, relationship, otherRelationship].entries()) {
      rule = await R.upsertRule({ institutionId: school.id, checkpointCode: `T-${index}`, domain: "Financial Aid", title: `Review aid ${index}`, critical: true, requirement: "Review official instructions", researchTerm: "Fall 2027", status: "verified", confidence: "high", applicability: "applies", cycleState: "current", sourceId: source.id, evidenceQuote: "Official aid instructions" });
      ids.push((await R.createActionInstance({ relationshipId: rel.id, ruleId: rule.id, dueAt: null, applicabilityReason: "Applies to this student", priority: "normal", state: "not_started" })).id);
    }
  });

  it("persists each task independently across new reads, supports undo, records an audit trail", async () => {
    await S.saveFamilyCompletion(first.household.id, ids[0], true);
    assert.equal((await R.getActionInstance(ids[0]))?.state, "not_started", "checkbox does not overwrite workflow");
    assert.deepEqual([... (await S.familyCompletionForActions(ids)).values()], [true]);
    await S.saveFamilyCompletion(first.household.id, ids[1], true);
    assert.equal((await R.getActionInstanceFull(ids[0]))?.completed, true);
    assert.equal((await R.getActionInstanceFull(ids[1]))?.completed, true);
    assert.equal((await R.getActionInstanceFull(ids[2]))?.completed, false);
    await S.saveFamilyCompletion(first.household.id, ids[0], false);
    assert.equal((await R.getActionInstanceFull(ids[0]))?.completed, false);
    assert.equal((await R.getActionInstanceFull(ids[1]))?.completed, true);
    assert.deepEqual((await R.listEventsForAction(ids[0])).map(e => e.toState), ["complete", "not_started"]);
  });

  it("does not infer completion from workflow, evidence, time, view, or absent mail; only persisted family events affect counts", async () => {
    const [a, b] = ids;
    await R.updateActionInstance(a, { state: "submitted", dueAt: "2026-01-01T00:00:00Z" });
    await R.updateActionInstance(b, { state: "complete" }); // legacy/observation state is not checkbox authority
    await R.createActionEvent({ actionId: b, eventType: "observed_signal", fromState: "received", toState: "complete", actorType: "observation_engine" });
    await R.createActionEvent({ actionId: a, eventType: "email_signal", fromState: "submitted", toState: "complete", actorType: "system" });
    const before = await R.listActionInstancesForRelationship((await R.getActionInstanceFull(a))!.relationship.id, "Fall 2027");
    assert.equal(before.find(x => x.id === a)?.completed, false);
    assert.equal(before.find(x => x.id === b)?.completed, true); // previous test left B checked
    assert.equal(partitionTasks(before).completedCount, 1);
    await S.saveFamilyCompletion(first.household.id, b, false);
    const after = await R.listActionInstancesForRelationship((await R.getActionInstanceFull(a))!.relationship.id, "Fall 2027");
    assert.equal(partitionTasks(after).completedCount, 0);
    assert.equal(partitionTasks(after).open.length, 2);
    // Terminal-looking workflow labels must neither inflate progress nor hide an applicable task.
    await R.updateActionInstance(a, { state: "waived" });
    await R.updateActionInstance(b, { state: "missed" });
    const terminal = partitionTasks(await R.listActionInstancesForRelationship((await R.getActionInstanceFull(a))!.relationship.id, "Fall 2027"));
    assert.equal(terminal.completedCount, 0);
    assert.deepEqual(terminal.open.map(x => x.id).sort(), [a, b].sort());
    await S.saveFamilyCompletion(first.household.id, a, true);
    assert.equal(partitionTasks(await R.listActionInstancesForRelationship((await R.getActionInstanceFull(a))!.relationship.id, "Fall 2027")).completedCount, 1);
    await S.saveFamilyCompletion(first.household.id, a, false);
    assert.equal((await R.getActionInstanceFull(a))?.state, "waived", "undo preserves the distinct workflow state");
    await R.updateActionInstance(a, { state: "submitted" });
    await R.updateActionInstance(b, { state: "complete" });
    await S.saveFamilyCompletion(first.household.id, a, true);
    const checked = await R.listActionInstancesForRelationship((await R.getActionInstanceFull(a))!.relationship.id, "Fall 2027");
    assert.equal(checked.find(x => x.id === a)?.state, "submitted");
    assert.equal(partitionTasks(checked).completedCount, 1);
    assert.deepEqual(partitionTasks(checked).open.map(x => x.id), [b]);
    await S.saveFamilyCompletion(first.household.id, a, false);
    assert.equal(partitionTasks(await R.listActionInstancesForRelationship((await R.getActionInstanceFull(a))!.relationship.id, "Fall 2027")).completedCount, 0);
  });

  it("keeps sibling, term, and household markers separate", async () => {
    const sibling = await R.upsertStudent({ householdId: first.household.id, name: "Sibling", gradYear: 2027 });
    const school = (await R.getActionInstanceFull(ids[0]))!.relationship.institution;
    const rel = await R.upsertRelationship({ studentId: sibling.id, institutionId: school.id });
    const siblingAction = await R.createActionInstance({ relationshipId: rel.id, ruleId: rule.id, dueAt: null, applicabilityReason: "sibling", priority: "normal" });
    await S.saveFamilyCompletion(first.household.id, ids[0], true);
    assert.equal((await R.getActionInstanceFull(ids[0]))?.completed, true);
    assert.equal((await R.getActionInstanceFull(siblingAction.id))?.completed, false);
    assert.equal((await R.getActionInstanceFull(ids[2]))?.completed, false);
    await assert.rejects(S.saveFamilyCompletion(second.household.id, ids[0], true), /Action not found/);
    await S.saveFamilyCompletion(first.household.id, ids[0], false);
  });

  it("denies another household's task and invalid toggle values without changing state", async () => {
    await assert.rejects(S.saveFamilyCompletion(second.household.id, ids[0], true), /Action not found/);
    await assert.rejects(S.saveFamilyCompletion(first.household.id, ids[2], true), /Action not found/);
    await assert.rejects(S.saveFamilyCompletion(first.household.id, ids[0], "yes" as unknown as boolean), /Invalid completion/);
    assert.equal((await R.getActionInstance(ids[2]))?.state, "not_started");
  });

  it("links only safe verified official sources and distinguishes sensitive information from portals", () => {
    assert.equal(verifiedOfficialUrl(source), "https://fiction.example.edu/aid");
    assert.equal(verifiedOfficialUrl({ ...source, authorityLevel: "unverified" }), null);
    for (const url of ["http://fiction.example.edu/aid", "javascript:alert(1)", "https://user:pass@fiction.example.edu", "https://127.0.0.1/aid"]) assert.equal(verifiedOfficialUrl({ ...source, url }), null);
    const html = renderToStaticMarkup(<OfficialDestination source={source} rule={{ ...rule, title: "Pay deposit in portal" }} schoolName="Fiction University" />);
    assert.match(html, /portal\/login\/payment-sensitive task/);
    assert.match(html, /href="https:\/\/fiction\.example\.edu\/aid"/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /not a verified direct login or payment endpoint/);
    assert.match(html, /Fall 2027.*last checked/);
    assert.match(html, /Research evidence:.*Official aid instructions/);
    const wrongAudience = renderToStaticMarkup(<OfficialDestination source={{ ...source, url: "https://www.ou.edu/admissions/counselor-resources/slate-account" }} rule={{ ...rule, title: "Check application portal" }} schoolName="University of Oklahoma" />);
    assert.match(wrongAudience, /Official destination unavailable/);
    assert.doesNotMatch(wrongAudience, /counselor-resources|href=/);
    const unavailable = renderToStaticMarkup(<OfficialDestination source={null} rule={rule} schoolName="Fiction University" />);
    assert.match(unavailable, /Official destination unavailable/);
    assert.doesNotMatch(unavailable, /href=/);
    const preview = renderToStaticMarkup(<OfficialDestination source={null} rule={rule} schoolName="Lakeview College" illustrative />);
    assert.match(preview, /<details/);
    assert.match(preview, /<summary[^>]*>How official destinations work<\/summary>/);
    assert.match(preview, /no external destination or source-check claim/);
    assert.doesNotMatch(preview, /href=/);
  });

  it("withholds imported or altered off-domain source rows even if marked official", async () => {
    const { exec } = await import("../lib/db/client");
    await exec("UPDATE sources SET url=$1 WHERE id=$2", ["https://lookalike.example.net/aid", source.id]);
    try {
      assert.equal((await R.getActionInstanceFull(ids[0]))?.source, null);
      const full = await R.getActionInstanceFull(ids[0]);
      assert.equal((await R.listActionInstancesForRelationship(full!.relationship.id, rule.researchTerm))[0].source, null);
    } finally {
      await exec("UPDATE sources SET url=$1 WHERE id=$2", [source.url, source.id]);
    }
  });

  it("keeps landing/sample visuals structurally honest relative to signed-in completion and destination", () => {
    const base = new URL("../", import.meta.url);
    const dashboard = readFileSync(new URL("app/dashboard/page.tsx", base), "utf8");
    const detail = readFileSync(new URL("app/action/[id]/page.tsx", base), "utf8");
    const queue = readFileSync(new URL("components/ActionListItem.tsx", base), "utf8");
    const landing = readFileSync(new URL("components/CampusPassageLanding.tsx", base), "utf8");
    const preview = readFileSync(new URL("components/LandingTaskPreview.tsx", base), "utf8");
    const sample = readFileSync(new URL("components/SamplePlan.tsx", base), "utf8");
    const css = readFileSync(new URL("app/globals.css", base), "utf8");
    const toggle = readFileSync(new URL("components/CompletionToggle.tsx", base), "utf8");
    assert.match(toggle, /<label[^>]*min-h-11[^>]*>/, "visible label has a touch-sized native target");
    assert.match(toggle, /<input type="checkbox" aria-label="Completed" checked=\{checked\} disabled=\{readOnly \|\| pending\}/, "native checkbox is keyboard-operable and exposes a name/state");
    assert.match(toggle, /<\/input>|\/>\s*Completed/, "the completion label is visibly printed");
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.hero-plan-card \{ display: block; max-width: 700px; width: 100%; \}/, "mobile breakpoint retains the task preview");
    assert.match(dashboard, /readOnly=\{base\.isDemo\}/);
    assert.match(dashboard, /partitionTasks/);
    for (const rendered of [queue, detail, preview]) { assert.match(rendered, /<CompletionToggle/); assert.match(rendered, /<OfficialDestination/); }
    assert.match(landing, /<LandingTaskPreview/);
    assert.match(preview, /readOnly \/>/);
    assert.match(preview, /illustrative \/>/);
    assert.match(preview, /Review final transcript submission instructions/);
    assert.match(preview, /first-year housing application window/);
    assert.match(preview, /Fall 2027 date not yet published/);
    for (const placeholder of ["Fictional transcript step", "Housing date", "School-side wait", "Scholarship listing"]) assert.doesNotMatch(preview, new RegExp(placeholder));
    assert.doesNotMatch(preview, /https?:\/\//);
    assert.match(css, /\.hero-plan-card \{ display: block;/);
    assert.match(sample, /Completed/);
    assert.doesNotMatch(sample, /href="https:\/\//);
  });
});
