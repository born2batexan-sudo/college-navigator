import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialIntake, personalizedPlan, updateStudentAnswer, type IntakeAnswers, type IntakeByStudent } from "../lib/sample-intake";

const copy = readFileSync(new URL("../components/SamplePlan.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const clone = (): IntakeByStudent => structuredClone(initialIntake);
const titles = (plan: ReturnType<typeof personalizedPlan>) => plan.surfaced.map((item) => `${item.student}: ${item.title}`);
const aside = (plan: ReturnType<typeof personalizedPlan>) => plan.setAside.map((item) => `${item.student}: ${item.title}`);

describe("fictional adaptive intake", () => {
  it("changes only the chosen student's answers without mutating the defaults or sibling", () => {
    const original = clone();
    const changed = updateStudentAnswer(original, "priya", "living", "commute");
    assert.equal(changed.priya.living, "commute");
    assert.equal(changed.mateo, original.mateo);
    assert.equal(original.priya.living, "campus");
    assert.equal(initialIntake.priya.living, "campus");
    assert.notDeepEqual(changed.priya, changed.mateo);
    const single = personalizedPlan("priya", changed);
    assert.ok(single.surfaced.every((item) => item.student === "priya"));
    assert.ok(single.setAside.every((item) => item.student === "priya"));
    const both = personalizedPlan("household", changed);
    assert.deepEqual(titles(personalizedPlan("mateo", changed)), titles(personalizedPlan("mateo", original)));
    assert.ok(both.surfaced.some((item) => item.student === "priya") && both.surfaced.some((item) => item.student === "mateo"));
  });

  it("offers four different living paths; preference cannot suppress an applicable school rule", () => {
    for (const living of ["campus", "offCampus", "commute", "undecided"] as const) {
      const a = updateStudentAnswer(clone(), "priya", "living", living);
      const plan = personalizedPlan("priya", a);
      const required = plan.surfaced.find((item) => item.title === "Review first-year residence requirement");
      assert.ok(required);
      assert.equal(required.school, "North Valley University");
      assert.equal(required.exception, living !== "campus");
      if (living !== "campus") assert.equal(plan.surfaced[0].title, required.title, "conflict should be prominent");
      assert.ok(plan.surfaced.some((item) => item.title === "Housing date not posted yet"), "critical housing unknown is never suppressed");
      assert.ok(!plan.setAside.some((item) => item.title === required.title || item.title === "Housing date not posted yet"));
      if (living === "commute") assert.ok(titles(plan).includes("priya: Plan a commuting route"));
      if (living === "offCampus") assert.ok(titles(plan).includes("priya: Consider off-campus housing questions"));
      if (living === "undecided") assert.ok(titles(plan).includes("priya: Keep the living plan open"));
    }
    const commuter = personalizedPlan("mateo", clone());
    assert.ok(!titles(commuter).includes("mateo: Explore campus housing choices"));
    assert.ok(aside(commuter).includes("mateo: Explore campus housing choices"));
    assert.ok(!titles(commuter).includes("mateo: Review first-year residence requirement"), "do not infer a second school's requirement");
  });

  it("every intake choice changes a surfaced item into a specifically explained set-aside item", () => {
    const cases: { key: keyof IntakeAnswers; value: IntakeAnswers[keyof IntakeAnswers]; title: string }[] = [
      { key: "aid", value: false, title: "Compare aid requirements" },
      { key: "schoolScholarships", value: false, title: "Review school scholarship routes" },
      { key: "outsideScholarships", value: false, title: "A regional scholarship is posted" },
      { key: "educationSavings", value: false, title: "Plan a 529 or prepaid-plan question" },
      { key: "transport", value: "other", title: "Check student parking options" },
      { key: "access", value: true, title: "Ask about accommodations" },
      { key: "studentLife", value: true, title: "Explore student organizations" },
      { key: "visits", value: true, title: "Consider a campus visit" },
      { key: "orientation", value: false, title: "Watch for orientation information" },
      { key: "familyMoveIn", value: false, title: "Plan family and move-in logistics" },
    ];
    for (const { key, value, title } of cases) {
      const before = personalizedPlan("priya", clone());
      const changed = personalizedPlan("priya", updateStudentAnswer(clone(), "priya", key, value));
      assert.notEqual(titles(before).includes(`priya: ${title}`), titles(changed).includes(`priya: ${title}`), `${key} must change ${title}`);
      const hidden = changed.setAside.find((item) => item.title === title) ?? before.setAside.find((item) => item.title === title);
      assert.ok(hidden?.reason.startsWith("Set aside because"), `${title} needs a reason`);
    }
  });

  it("keeps horizon and item filtering in sync, without hiding non-optional statuses", () => {
    let a = updateStudentAnswer(clone(), "mateo", "visits", false);
    a = updateStudentAnswer(a, "mateo", "access", false);
    const plan = personalizedPlan("mateo", a);
    assert.ok(!titles(plan).includes("mateo: Register for the campus-visit day"));
    assert.ok(!plan.horizon.some((event) => event.label === "Campus-visit registration" || event.label === "Accessibility conversation"));
    assert.ok(aside(plan).includes("mateo: Campus-visit registration"));
    assert.ok(titles(plan).includes("mateo: Test-optional policy not posted for this cycle"));
    assert.ok(plan.horizon.some((event) => event.label === "Test-optional policy update" && event.date === undefined));
  });

  it("makes controls discoverable, per-student, native, and honest about its status", () => {
    for (const label of ["Live on campus", "Off-campus housing", "Commute", "Not sure yet", "Financial aid", "School scholarships", "Community or other outside scholarships", "529 or prepaid plan", "Bring a car", "Access or accommodations", "Greek or other student life", "Campus visits", "Orientation", "Family access or move-in"]) assert.ok(copy.includes(label), label);
    assert.match(copy, /<fieldset|<legend|type="radio"|type="checkbox"/);
    assert.match(copy, /setEditingStudent\(entry.id\)/);
    assert.match(copy, /updateStudentAnswer\(current, editor, key, value\)/);
    assert.match(copy, /<details className="intake-more">/);
    assert.match(copy, /No answers are submitted or saved/);
    assert.match(copy, /Fictional sample\. No live source checked/);
    assert.match(overview, /commuter need not sift through optional dorm steps/);
    assert.match(overview, /school requirements stay visible/);
    assert.doesNotMatch(copy, /144|checkpoint|live personalized service[^.]*is available/i);
  });
});
