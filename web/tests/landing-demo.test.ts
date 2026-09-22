// Guards the fictional same-cycle household illustration used by the public
// interactive demo (lib/landing-demo.ts, rendered by components/CampusPassageLanding.tsx):
// two or more qualifying students are supported, while this fixed illustration
// uses two Class of 2027 / Fall 2027 applicants with distinct pathways,
// schools, priorities, preferences, and deadlines.
// Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actionsFor,
  demoHiddenWork,
  demoHorizon,
  demoStudents,
  hiddenWorkFor,
  horizonFor,
  summarizeSelection,
} from "../lib/landing-demo";

describe("public household demo: same-cycle applicant pathways", () => {
  it("keeps the fixed illustration same-year and same-cycle while allowing two or more students", () => {
    assert.ok(demoStudents.length >= 2);
    assert.ok(demoStudents.every((student) => student.graduationYear === 2027));
    assert.ok(demoStudents.every((student) => student.term === "Fall 2027"));
    assert.ok(demoStudents.every((student) => student.pathway.length > 0));
    assert.ok(demoStudents.every((student) => student.priority.length > 0));
  });

  it("gives applicants genuinely different schools, priorities, preferences, and pathways", () => {
    const [a, b] = demoStudents;
    assert.notEqual(a.name, b.name);
    assert.notDeepEqual([...a.schools].sort(), [...b.schools].sort());
    assert.notEqual(a.priority, b.priority);
    assert.notEqual(a.pathway, b.pathway);
    assert.notDeepEqual(a.preferences, b.preferences);

    const aDeadlines = actionsFor(a.id).map((row) => row.status).filter((status) => /Due:|deadline|review by/i.test(status));
    const bDeadlines = actionsFor(b.id).map((row) => row.status).filter((status) => /Due:|deadline|review by/i.test(status));
    assert.ok(aDeadlines.length > 0 && bDeadlines.length > 0);
    assert.notDeepEqual(aDeadlines, bDeadlines);
  });

  it("gives every action row a real, single-student owner with its own school, kind, and source", () => {
    for (const student of demoStudents) {
      const rows = actionsFor(student.id);
      assert.ok(rows.length > 0, `${student.id} should have at least one action`);
      assert.ok(rows.every((row) => row.student === student.id));
      assert.ok(rows.every((row) => row.source.length > 0));
      assert.ok(rows.every((row) => row.school.length > 0 && row.kind.length > 0));
    }
  });

  it("combines every illustrated student in the household view without losing attribution", () => {
    const household = actionsFor("household");
    const expectedCount = demoStudents.reduce((total, student) => total + actionsFor(student.id).length, 0);
    assert.equal(household.length, expectedCount);
    for (const student of demoStudents) assert.ok(household.some((row) => row.student === student.id));
  });

  it("shows every responsibility/waiting tone honestly: family action, school wait, complete, and awareness", () => {
    const tones = new Set(actionsFor("household").map((row) => row.tone));
    assert.deepEqual(tones, new Set(["action", "waiting", "complete", "aware"]));
  });

  it("models Horizon certainty per student and never invents an unpublished date", () => {
    for (const event of demoHorizon) {
      if (event.state === "Not yet published") assert.equal(event.date, undefined, `${event.label} must not have a fabricated date`);
      else assert.ok(event.date, `${event.label} should carry a date when its state is known`);
    }
    for (const student of demoStudents) assert.ok(horizonFor(student.id).length > 0);
  });

  it("gives a real, specific reason for every intentionally hidden item, per student", () => {
    assert.ok(demoHiddenWork.length > 0);
    assert.ok(demoHiddenWork.every((item) => item.hideReason.startsWith("Hidden because")));
    for (const student of demoStudents) {
      assert.ok(hiddenWorkFor(student.id).length > 0);
      assert.ok(hiddenWorkFor(student.id).every((item) => item.student === student.id));
    }
  });

  it("summarizes counts consistently for every student and the household total", () => {
    const household = summarizeSelection("household");
    const total = demoStudents.reduce((result, student) => {
      const counts = summarizeSelection(student.id);
      return {
        dueThisWeek: result.dueThisWeek + counts.dueThisWeek,
        waiting: result.waiting + counts.waiting,
        complete: result.complete + counts.complete,
        awareness: result.awareness + counts.awareness,
      };
    }, { dueThisWeek: 0, waiting: 0, complete: 0, awareness: 0 });
    assert.deepEqual(household, total);
  });
});
