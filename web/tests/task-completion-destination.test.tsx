import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { OfficialDestination, verifiedOfficialUrl } from "../components/OfficialDestination";
import type { Rule, Source } from "../lib/db/types";

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
    assert.equal((await R.getActionInstance(ids[0]))?.state, "complete");
    assert.equal((await R.getActionInstance(ids[1]))?.state, "not_started");
    assert.equal((await R.getActionInstance(ids[2]))?.state, "not_started");
    await S.saveFamilyCompletion(first.household.id, ids[1], true);
    assert.equal((await R.getActionInstance(ids[0]))?.state, "complete");
    assert.equal((await R.getActionInstance(ids[1]))?.state, "complete");
    await S.saveFamilyCompletion(first.household.id, ids[0], false);
    assert.equal((await R.getActionInstance(ids[0]))?.state, "not_started");
    assert.equal((await R.getActionInstance(ids[1]))?.state, "complete");
    assert.deepEqual((await R.listEventsForAction(ids[0])).map(e => e.toState), ["complete", "not_started"]);
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
    const unavailable = renderToStaticMarkup(<OfficialDestination source={null} rule={rule} schoolName="Fiction University" />);
    assert.match(unavailable, /Official destination unavailable/);
    assert.doesNotMatch(unavailable, /href=/);
  });

  it("keeps landing/sample visuals structurally honest relative to signed-in completion and destination", () => {
    const base = new URL("../", import.meta.url);
    const dashboard = readFileSync(new URL("app/dashboard/page.tsx", base), "utf8");
    const detail = readFileSync(new URL("app/action/[id]/page.tsx", base), "utf8");
    const queue = readFileSync(new URL("components/ActionListItem.tsx", base), "utf8");
    const landing = readFileSync(new URL("components/CampusPassageLanding.tsx", base), "utf8");
    const sample = readFileSync(new URL("components/SamplePlan.tsx", base), "utf8");
    assert.match(dashboard, /readOnly=\{base\.isDemo\}/);
    for (const rendered of [queue, detail]) { assert.match(rendered, /<CompletionToggle/); assert.match(rendered, /<OfficialDestination/); }
    for (const rendered of [landing, sample]) { assert.match(rendered, /Completed/); assert.match(rendered, /Official destination unavailable/); assert.match(rendered, /disabled/); }
    assert.doesNotMatch(sample, /href="https:\/\//);
  });
});
