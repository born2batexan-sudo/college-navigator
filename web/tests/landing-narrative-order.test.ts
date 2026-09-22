// Guards the public narrative sequence on the marketing page: the hero makes
// the category promise, the problem and the product model are explained
// before the interactive demo ever appears, the full passage sets up what
// the demo then shows, and differentiators/trust/boundaries/CTA close things
// out in that order. This is a structural regression guard, not a copy
// check — earlier landing-copy.test.ts already covers exact wording.
// Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");

/** Index of a section's opening id attribute in the public story, or -1 if absent. */
function sectionIndex(id: string): number {
  const marker = `id="${id}"`;
  return source.indexOf(marker);
}

describe("public landing narrative sequence", () => {
  const order = [
    "top", // 1. hero: category promise
    "problem", // 2. problem: scattered, hard to tell relevant/current/consequential/whose-move
    "outcome", // 3. emotional/practical outcome
    "how-it-works", // 4. what Campus Passage is + the anatomy of an item
    "journey", // 5. full passage, pre-submission through career
    "proof", // 6. interactive proof
    "differentiators", // 7. differentiators (same-cycle multi-student is one of several)
    "trust", // 7b. trust closes the differentiators section
    "boundaries", // 8. boundaries and coming capabilities
    "closing", // 9. call to action
  ];

  it("finds every required narrative section exactly once, in the DOM", () => {
    for (const id of order) {
      const idx = sectionIndex(id);
      assert.notEqual(idx, -1, `expected to find id="${id}" in the public story`);
    }
  });

  it("keeps the required narrative order: hero, problem, outcome, product model, journey, proof, differentiators, trust, boundaries, CTA", () => {
    const indices = order.map(sectionIndex);
    for (let i = 1; i < indices.length; i += 1) {
      assert.ok(
        indices[i] > indices[i - 1],
        `expected id="${order[i]}" (index ${indices[i]}) to appear after id="${order[i - 1]}" (index ${indices[i - 1]})`,
      );
    }
  });

  it("never lets the interactive demo precede the problem statement or the product model", () => {
    const proofIdx = sectionIndex("proof");
    const problemIdx = sectionIndex("problem");
    const howItWorksIdx = sectionIndex("how-it-works");
    const journeyIdx = sectionIndex("journey");
    assert.ok(proofIdx > problemIdx, "the demo must not precede the problem statement");
    assert.ok(proofIdx > howItWorksIdx, "the demo must not precede the product-model explanation");
    assert.ok(proofIdx > journeyIdx, "the demo must not precede the full-passage overview it illustrates");
  });

  it("names the same-cycle multi-student pathway as one differentiator among several — not the section's sole framing device — followed by Horizon, then aid/scholarship/billing", () => {
    const multiStudentIdx = source.indexOf('title: "Every student, every desired school"');
    const householdHorizonIdx = source.indexOf('title: "Household Horizon"');
    const aidIdx = source.indexOf('title: "Financial aid & scholarship awareness"');
    const billingIdx = source.indexOf('title: "Billing & 529 awareness"');
    assert.ok(multiStudentIdx !== -1 && householdHorizonIdx !== -1 && aidIdx !== -1 && billingIdx !== -1, "expected all four differentiators to be present");
    // The instructed order: multi-student pathways, then Horizon, then aid/scholarship/billing.
    assert.ok(multiStudentIdx < householdHorizonIdx, "multi-student pathway should be listed before Household Horizon");
    assert.ok(householdHorizonIdx < aidIdx, "Household Horizon should be listed before financial aid & scholarship awareness");
    assert.ok(aidIdx < billingIdx, "financial aid & scholarship awareness should be listed before billing & 529 awareness");
    // Trust, not the multi-student pathway, closes out the differentiators section.
    const trustIdx = sectionIndex("trust");
    assert.ok(trustIdx > billingIdx, "trust should close the differentiators section, after every differentiator");
  });

  it("does not lead the hero with the two-kids/multi-student framing", () => {
    const heroIdx = sectionIndex("top");
    const problemIdx = sectionIndex("problem");
    const heroSection = source.slice(heroIdx, problemIdx);
    assert.doesNotMatch(heroSection, /two kids|two timelines/i);
  });
});
