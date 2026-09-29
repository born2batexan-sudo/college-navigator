import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CHOICE_OPTIONS, HOUSING_OPTIONS, INTAKE_QUESTIONS, intakeRuleDefaults, intakeSummary, parseIntakeForm, readIntake } from "../lib/intake";
import { evaluateRule, evaluatePopulation, resolveAttributes } from "../lib/rules-engine";
import type { InstitutionRelationship, Rule, Student } from "../lib/db/types";

const dir = mkdtempSync(path.join(tmpdir(), "cn-intake-"));
process.env.DB_PATH = path.join(dir, "test.sqlite3");
delete process.env.DATABASE_URL;
const fullForm = () => {
  const f = new FormData(); f.set("studentId", "student_one");
  for (const q of INTAKE_QUESTIONS) f.set(q.key, "ask_later");
  return f;
};
const student = (attributes: object): Student => ({ id: "student_one", householdId: "hh_one", name: "One", gradYear: 2027, applicantType: "freshman", residency: "unknown", attributes: JSON.stringify(attributes), createdAt: "" });
const rel = (attributes = "{}"): InstitutionRelationship => ({ id: "rel_one", studentId: "student_one", institutionId: "inst_one", lifecycleState: "considering", decisionDate: null, commitDate: null, attributes, active: true, createdAt: "" });
const rule = (population: string, critical = false): Rule => ({ id: "rule_one", institutionId: "inst_one", checkpointCode: "T-1", domain: "Housing", title: "Review the school's requirement", critical, population, requirement: "Review official instructions", trigger: null, dependsOnCode: null, deadlineExpr: null, actor: "student", costCents: null, refundable: "unknown", consequence: null, status: "verified", confidence: "high", researchTerm: "Fall 2027", cycleState: "current", applicability: "applies", evidenceQuote: "Official instructions", verifiedAt: null, sourceId: "src_one", createdAt: "", updatedAt: "" });

describe("student intake contract", () => {
  it("has exactly twelve distinct areas and explicit choices", () => {
    assert.equal(INTAKE_QUESTIONS.length, 12);
    assert.equal(new Set(INTAKE_QUESTIONS.map(q => q.key)).size, 12);
    assert.deepEqual(CHOICE_OPTIONS.map(o => o.value), ["yes", "no", "unsure", "ask_later"]);
    assert.ok(HOUSING_OPTIONS.some(o => o.value === "undecided"));
    assert.ok(HOUSING_OPTIONS.some(o => o.value === "ask_later"));
  });
  it("parses strict complete forms and leaves invalid stored fields out", () => {
    const f = fullForm(); f.set("housing", "commuter"); f.set("vehicle", "no");
    f.set("$ACTION_ID_test", "framework-value");
    const parsed = parseIntakeForm(f);
    assert.equal(parsed.housing, "commuter"); assert.equal(parsed.vehicle, "no");
    const stored = readIntake(student({ enteringTerm: "Fall 2027", intake: { ...parsed, vehicle: "bad", unknown: "yes" } }));
    assert.equal(stored.vehicle, undefined); assert.equal(stored.housing, "commuter");
    assert.deepEqual(readIntake({ attributes: "{broken" }), {});
    assert.deepEqual(readIntake({ attributes: JSON.stringify({ intake: [] }) }), {});
    f.delete("vehicle"); assert.throws(() => parseIntakeForm(f), /vehicle/i);
    f.set("vehicle", "true"); assert.throws(() => parseIntakeForm(f), /vehicle/i);
    f.set("vehicle", "no"); f.append("vehicle", "yes"); assert.throws(() => parseIntakeForm(f), /vehicle/i);
    f.delete("vehicle"); f.set("vehicle", "no"); f.set("unknownField", "yes"); assert.throws(() => parseIntakeForm(f), /Unexpected/);
  });
  it("maps yes/no to conditional defaults and uncertainty to visible, never false", () => {
    const f = fullForm(); f.set("housing", "undecided"); f.set("vehicle", "unsure"); f.set("accessibility", "no");
    const mapped = intakeRuleDefaults(parseIntakeForm(f));
    assert.equal(mapped.housingPlan, "undecided"); assert.equal(mapped.bringingCar, null); assert.equal(mapped.disabilityAccommodation, false);
    assert.equal(evaluatePopulation(rule("bringing_car"), mapped, student({})), true);
    assert.equal(evaluatePopulation(rule("disability_accommodation"), mapped, student({})), false);
    assert.equal(evaluatePopulation(rule("campus_housing"), mapped, student({})), true);
    assert.equal(evaluatePopulation(rule("all"), mapped, student({})), true);
    const counts = intakeSummary(readIntake(student({ intake: parseIntakeForm(f) })));
    assert.ok(counts.setAside.includes("Accessibility")); assert.ok(counts.open.includes("Vehicle"));
  });
  it("preserves official school-wide and critical requirements against conflicting preferences", () => {
    const s = student({ intake: { housing: "commuter", vehicle: "no", campusLife: "no" } });
    assert.equal(evaluateRule(rule("all"), rel(), s).applicable, true);
    assert.equal(evaluateRule(rule("campus_housing", true), rel(), s).applicable, true);
    assert.equal(evaluateRule(rule("campus_housing"), rel(), s).applicable, false);
    assert.equal(evaluateRule(rule("greek_pnm"), rel(), s).applicable, false);
    assert.equal(evaluateRule(rule("greek_pnm"), rel(JSON.stringify({ greekInterest: true })), s).applicable, true, "school-specific preference takes precedence");
    assert.equal(evaluateRule(rule("out_of_state", true), rel(), s).applicable, false, "critical does not override residency or unknown segments");
    assert.equal(resolveAttributes(rel(JSON.stringify({ housingPlan: "on_campus" })), s).housingPlan, "on_campus");
  });
});

describe("persisted student intake and isolation", () => {
  it("edits one profile, preserves entering term, checks household ownership, and refreshes only that student's active relationships", async () => {
    const A = await import("../lib/db/accounts");
    const R = await import("../lib/db/repo");
    const { materializeActionsForRelationship } = await import("../lib/materialize");
    const owner = await A.provisionAccount({ authUserId: "intake-owner", email: "owner@example.com" });
    await A.completeOnboarding(owner, { role: "parent", students: [{ name: "One", enteringTerm: "Fall 2027" }, { name: "Two", enteringTerm: "Fall 2027" }], purchaserAttested: true });
    const profiles = await R.listStudentsForHousehold(owner.household.id);
    const other = await A.provisionAccount({ authUserId: "intake-other", email: "other@example.com" });
    const inst = await R.upsertInstitution({ name: "Intake Test College", slug: "intake-test", domains: ["example.edu"] });
    const src = await R.createSource({ institutionId: inst.id, url: "https://example.edu/admissions", label: "Admit" });
    const conditional = await R.upsertRule({ institutionId: inst.id, checkpointCode: "INT-01", domain: "Campus life", title: "Explore Greek life", requirement: "Optional recruitment", critical: false, population: "greek_pnm", status: "verified", confidence: "high", researchTerm: "Fall 2027", cycleState: "current", sourceId: src.id, evidenceQuote: "Recruitment information" });
    const mandatory = await R.upsertRule({ institutionId: inst.id, checkpointCode: "INT-02", domain: "Admissions", title: "Required application", requirement: "Required application", critical: false, population: "all", status: "verified", confidence: "high", researchTerm: "Fall 2027", cycleState: "current", sourceId: src.id, evidenceQuote: "Required application" });
    const r1 = await R.upsertRelationship({ studentId: profiles[0].id, institutionId: inst.id });
    const r2 = await R.upsertRelationship({ studentId: profiles[1].id, institutionId: inst.id });
    const f = fullForm(); f.set("campusLife", "yes");
    const ctx = { ...owner, student: profiles[0] };
    await A.updateStudentAttributes({ ...other, student: profiles[0] }, { intake: parseIntakeForm(f) });
    assert.deepEqual(readIntake((await R.getStudent(profiles[0].id))!), {}, "cross-household write changes no row");
    await A.updateStudentAttributes(ctx, { intake: parseIntakeForm(f) });
    await materializeActionsForRelationship(r1.id); await materializeActionsForRelationship(r2.id);
    assert.ok(await R.findActionInstance(r1.id, conditional.id));
    assert.ok(await R.findActionInstance(r2.id, conditional.id), "unanswered remains visible");
    f.set("campusLife", "no");
    await A.updateStudentAttributes(ctx, { intake: parseIntakeForm(f) });
    const active = await R.listRelationshipsForStudent(profiles[0].id);
    await Promise.all(active.map(r => materializeActionsForRelationship(r.id)));
    assert.equal((await R.findActionInstance(r1.id, conditional.id))?.state, "not_applicable");
    assert.equal((await R.findActionInstance(r1.id, mandatory.id))?.state, "not_started");
    assert.equal((await R.findActionInstance(r2.id, conditional.id))?.state, "not_started");
    const after = await R.getStudent(profiles[0].id);
    assert.equal(JSON.parse(after!.attributes).enteringTerm, "Fall 2027");
    assert.equal(readIntake(after!).campusLife, "no");
    assert.deepEqual(readIntake((await R.getStudent(profiles[1].id))!), {});
    assert.equal(await A.getStudentForHousehold(other.household.id, profiles[0].id), null);
  });
});
