// Guards two-student visual distinctness in the real, signed-in dashboard
// (not the public demo) and basic accessibility wiring that keeps the
// redesigned screens usable without a mouse or with a screen reader.
// Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { studentAccent } from "../components/StudentSwitcher";

const landing = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const switcher = readFileSync(new URL("../components/StudentSwitcher.tsx", import.meta.url), "utf8");
const actionItem = readFileSync(new URL("../components/ActionListItem.tsx", import.meta.url), "utf8");
const reviewLab = readFileSync(new URL("../app/review-lab/ReviewLab.tsx", import.meta.url), "utf8");

describe("same-cycle students stay visually distinct and the family model scales", () => {
  it("states that the fixed illustration is not a maximum and names same-cycle eligibility", () => {
    assert.match(landing, /two or more students/);
    assert.match(landing, /genuine caregiving responsibility/);
    assert.match(landing, /same high-school graduation year and admissions cycle/);
    assert.doesNotMatch(landing, /senior.*sophomore|sophomore.*senior/i);
    assert.doesNotMatch(landing, /Fall 2029|Class of 2028/);
  });
  it("assigns a stable, distinct accent color per student index", () => {
    const first = studentAccent(0);
    const second = studentAccent(1);
    assert.notEqual(first.dot, second.dot);
    assert.notEqual(first.border, second.border);
    // Stable across repeat calls (not randomized per render).
    assert.deepEqual(studentAccent(0), first);
  });

  it("shows a color dot per student in the switcher, plan cards, and the combined queue", () => {
    assert.match(switcher, /StudentDot/);
    assert.match(dashboard, /<StudentDot index=\{index\}/);
    assert.match(dashboard, /border-t-4 bg-white\/80 p-5 shadow-card \$\{accent\.border\}/);
    assert.match(actionItem, /studentIndex !== undefined && <StudentDot/);
  });

  it("passes each household queue item its owning student's index, not a shared/default one", () => {
    assert.match(dashboard, /studentIndex=\{planIndex === -1 \? undefined : planIndex\}/);
  });
});

describe("accessibility basics on the redesigned protected review experience", () => {
  it("keeps the owner review lab's toggles and controls keyboard- and screen-reader-usable", () => {
    assert.match(reviewLab, /aria-pressed=\{entry\.id === selectedId\}/);
    assert.match(reviewLab, /aria-live="polite"/);
    assert.match(reviewLab, /htmlFor="review-guide-question"/);
    assert.match(reviewLab, /<label className="sr-only" htmlFor="review-guide-question">/);
  });

  it("keeps the household switcher an accessible nav landmark", () => {
    assert.match(switcher, /aria-label="Student plan switcher"/);
  });
});
