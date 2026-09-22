// Guards the follow-up requirement that the *seeded, signed-in* private
// demo household (lib/db/seed.ts) — not only the public marketing mock in
// lib/landing-demo.ts — contains two genuinely distinct, same-cycle fictional
// applicants, that re-running the seed is idempotent, and that the existing
// multi-student clone pipeline (acceptDemoInvite) still isolates each student
// correctly when the fixed fixture has more than one profile. The household
// model is intentionally not capped at two qualifying students.
// Run with: npm test

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "cn-demo-household-"));
process.env.DB_PATH = path.join(dir, "demo-household.sqlite3");
delete process.env.DATABASE_URL;
delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;
process.env.DEMO_OWNER_EMAIL = "owner@example.com";

type Seed = typeof import("../lib/db/seed");
type Repo = typeof import("../lib/db/repo");
type Accounts = typeof import("../lib/db/accounts");
let S: Seed, R: Repo, A: Accounts;

describe("the seeded private demo household models scalable same-cycle applicants", () => {
  before(async () => {
    S = await import("../lib/db/seed");
    R = await import("../lib/db/repo");
    A = await import("../lib/db/accounts");
    // Running the seed twice must not duplicate anything (upsert-by-fixed-id
    // all the way down); this is what makes re-seeding a shared dev/staging
    // database safe.
    await S.main();
    await S.main();
  });

  it("keeps exactly two fixed-id students in the demo household after a repeat seed", async () => {
    const students = await R.listStudentsForHousehold("demo-household");
    assert.equal(students.length, 2);
    assert.deepEqual(students.map((s) => s.id).sort(), ["demo-student", "demo-student-2"]);
  });

  it("never duplicates people, sources, or observation patterns on a repeat seed", async () => {
    // createPerson/createSource/createObservationPattern are plain inserts
    // elsewhere in the app (real account provisioning always wants a fresh
    // row), so this seed must guard its own calls itself. Re-running main()
    // a third time is the real regression test: if any guard were missing,
    // this count would keep growing every time the suite's `before` re-runs it.
    await S.main();
    const people = await R.listPeopleForHousehold("demo-household");
    assert.equal(people.length, 3, "Jordan, Dana, and Morgan — one row each, not duplicated across three seed runs");

    const alabama = (await R.getInstitutionBySlug("alabama"))!;
    const demoSchool = (await R.getInstitutionBySlug("example-demo-university"))!;
    const alabamaSources = await R.listSourcesForInstitution(alabama.id);
    assert.equal(alabamaSources.length, 8, "the 8 real Alabama research sources stay at 8, not 24, across three seed runs");
    const demoSources = await R.listSourcesForInstitution(demoSchool.id);
    assert.equal(demoSources.length, 1, "the one fictional demo source stays at 1 across three seed runs");

    const alabamaObservationPatterns = await R.listObservationPatternsForInstitution(alabama.id);
    assert.equal(alabamaObservationPatterns.length, 3, "the 3 Alabama observation patterns stay at 3, not 9, across three seed runs");
  });

  it("keeps every fixed-demo applicant in Class of 2027 / Fall 2027 while varying priorities and preferences", async () => {
    const students = await R.listStudentsForHousehold("demo-household");
    assert.ok(students.length >= 2);
    const jordan = students.find((s) => s.id === "demo-student")!;
    const morgan = students.find((s) => s.id === "demo-student-2")!;
    assert.notEqual(jordan.name, morgan.name);
    assert.notEqual(jordan.residency, morgan.residency);
    assert.equal(jordan.gradYear, 2027);
    assert.equal(morgan.gradYear, 2027);

    const jordanAttrs = JSON.parse(jordan.attributes);
    const morganAttrs = JSON.parse(morgan.attributes);
    assert.equal(jordanAttrs.enteringTerm, "Fall 2027");
    assert.equal(morganAttrs.enteringTerm, "Fall 2027");
    assert.notEqual(jordanAttrs.greekInterest, morganAttrs.greekInterest);
    assert.notEqual(jordanAttrs.disabilityAccommodation, morganAttrs.disabilityAccommodation);
    assert.notEqual(jordanAttrs.housingPlan, morganAttrs.housingPlan);
  });

  it("gives the two students different, non-identical tracked-school lists", async () => {
    const students = await R.listStudentsForHousehold("demo-household");
    const jordan = students.find((s) => s.id === "demo-student")!;
    const morgan = students.find((s) => s.id === "demo-student-2")!;
    const jordanRels = await R.listRelationshipsForStudent(jordan.id);
    const morganRels = await R.listRelationshipsForStudent(morgan.id);
    assert.ok(jordanRels.length > morganRels.length, "Jordan's and Morgan's same-cycle pathways should track different numbers of schools");
    const jordanInstitutionIds = new Set(jordanRels.map((r) => r.institutionId));
    const morganInstitutionIds = new Set(morganRels.map((r) => r.institutionId));
    assert.notDeepEqual([...jordanInstitutionIds].sort(), [...morganInstitutionIds].sort());
    // Every school Morgan tracks, Jordan also tracks (an overlapping subset,
    // as is common for siblings), but Morgan's set is strictly smaller.
    for (const id of morganInstitutionIds) assert.ok(jordanInstitutionIds.has(id));
  });

  it("gives the two students different lifecycle stages and statuses", async () => {
    const students = await R.listStudentsForHousehold("demo-household");
    const jordan = students.find((s) => s.id === "demo-student")!;
    const morgan = students.find((s) => s.id === "demo-student-2")!;
    const jordanRels = await R.listRelationshipsForStudent(jordan.id);
    const morganRels = await R.listRelationshipsForStudent(morgan.id);
    assert.ok(jordanRels.some((r) => r.lifecycleState === "admitted"), "Jordan should already be admitted somewhere");
    assert.ok(morganRels.every((r) => r.lifecycleState === "considering"), "Morgan should remain on a distinct considering pathway");
  });

  it("never fabricates verified real-school actions: Alabama stays at zero for both students", async () => {
    const students = await R.listStudentsForHousehold("demo-household");
    const jordan = students.find((s) => s.id === "demo-student")!;
    const morgan = students.find((s) => s.id === "demo-student-2")!;
    const alabama = (await R.getInstitutionBySlug("alabama"))!;
    const jordanAlabamaRel = (await R.listRelationshipsForStudent(jordan.id)).find((r) => r.institutionId === alabama.id)!;
    const jordanAlabamaActions = await R.listActionInstancesForRelationship(jordanAlabamaRel.id, "Fall 2027");
    assert.equal(jordanAlabamaActions.length, 0, "every real Alabama checkpoint stays unverified, so none should ever materialize into a customer-facing action");

    const morganAlabamaRel = (await R.listRelationshipsForStudent(morgan.id)).find((r) => r.institutionId === alabama.id)!;
    const morganActions = await R.listActionInstancesForRelationship(morganAlabamaRel.id, "Fall 2027");
    assert.equal(morganActions.length, 0, "Alabama's unverified source stays empty for Morgan too; no action is fabricated");
  });

  it("gives same-cycle applicants distinct illustrative-example queues for their different pathways", async () => {
    const students = await R.listStudentsForHousehold("demo-household");
    const jordan = students.find((s) => s.id === "demo-student")!;
    const morgan = students.find((s) => s.id === "demo-student-2")!;
    const demoSchool = (await R.getInstitutionBySlug("example-demo-university"))!;

    const jordanDemoRel = (await R.listRelationshipsForStudent(jordan.id)).find((r) => r.institutionId === demoSchool.id)!;
    const jordanDemoActions = await R.listActionInstancesForRelationship(jordanDemoRel.id, "Fall 2027");
    assert.ok(jordanDemoActions.length >= 4, "Jordan's admitted pathway should see the full illustrative-example checklist");
    assert.ok(jordanDemoActions.some((a) => a.state === "complete"), "at least one item should already be marked complete");
    assert.ok(jordanDemoActions.some((a) => a.state === "not_started"), "at least one item should still be not started");

    const morganDemoRel = (await R.listRelationshipsForStudent(morgan.id)).find((r) => r.institutionId === demoSchool.id)!;
    const morganDemoActions = await R.listActionInstancesForRelationship(morganDemoRel.id, "Fall 2027");
    assert.ok(morganDemoActions.length >= 1, "Morgan's considering pathway should still see an honestly scoped item, not an empty queue");
    assert.ok(morganDemoActions.length < jordanDemoActions.length, "Morgan's queue should be meaningfully shorter than Jordan's");
  });

  it("still isolates every student when a two-student template is cloned through the real invite pipeline", async () => {
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = "demo-household";
    try {
      const made = await A.createDemoInvite({ createdBy: "owner", createdEmail: "owner@example.com" });
      const joining = await A.provisionAccount({ authUserId: "clone-two-student", email: "clone-two-student@example.com" });
      const result = await A.acceptDemoInvite(joining, made.token);
      assert.deepEqual(result.ok, true);
      const cloned = (await A.getContextForUser("clone-two-student"))!;
      const clonedStudents = await R.listStudentsForHousehold(cloned.household.id);
      assert.equal(clonedStudents.length, 2, "both demo students should be cloned, not just the first");
      assert.deepEqual(clonedStudents.map((s) => s.name).sort(), ["Sample Student", "Sample Student 2"]);
      // Every cloned id is freshly generated; nothing points back at the template.
      const templateStudents = await R.listStudentsForHousehold("demo-household");
      for (const cs of clonedStudents) assert.ok(!templateStudents.some((ts) => ts.id === cs.id));
      // Each cloned applicant keeps its own distinct relationship count,
      // mirroring the fixed template's deliberately different pathways.
      const relCounts = (await Promise.all(clonedStudents.map((s) => R.listRelationshipsForStudent(s.id)))).map((r) => r.length).sort((a, b) => a - b);
      assert.deepEqual(relCounts, [3, 7]);
    } finally {
      delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;
    }
  });
});
