import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { answerReviewGuide, filterReviewWork, horizonEvents, pageAssistMode, reviewStudents } from "../lib/review-lab";

describe("owner review lab fixed-demo logic", () => {
  it("keeps every fixed-demo applicant in the same Class of 2027 / Fall 2027 cycle", () => {
    assert.ok(reviewStudents.length >= 2);
    assert.ok(reviewStudents.every((student) => student.year === "Class of 2027"));
    assert.ok(reviewStudents.every((student) => student.graduationYear === 2027));
    assert.ok(reviewStudents.every((student) => student.admissionsCycle === "Fall 2027"));
  });

  it("filters preference-dependent work and retains a reason for every hidden item", () => {
    const maya = reviewStudents[0];
    const filtered = filterReviewWork(maya);
    assert.ok(filtered.visible.some((item) => item.id === "housing"));
    assert.ok(filtered.visible.some((item) => item.id === "access"));
    assert.ok(filtered.hidden.some((item) => item.id === "parking"));
    assert.ok(filtered.hidden.some((item) => item.id === "greek"));
    assert.ok(filtered.hidden.every((item) => item.hideReason?.startsWith("Hidden because")));
  });

  it("models every certainty state without making an unpublished date up", () => {
    assert.deepEqual(new Set(horizonEvents.map((event) => event.state)), new Set(["Opens", "Due", "Expected announcement", "Window", "Actual release", "Response deadline", "Not yet published"]));
    const unpublished = horizonEvents.find((event) => event.state === "Not yet published");
    assert.equal(unpublished?.date, undefined);
  });

  it("answers only from topic-matched fictional facts and honestly refuses unknowns", () => {
    const aid = answerReviewGuide("When is the aid offer available?");
    assert.equal(aid.refused, false);
    assert.ok(aid.sources.length > 0);
    assert.match(aid.answer, /January 15/);
    const unknown = answerReviewGuide("Will I receive a scholarship?");
    assert.equal(unknown.refused, true);
    assert.equal(unknown.sources.length, 0);
    assert.match(unknown.answer, /can’t answer/i);
  });

  it("keeps Page Assist in explicit inactive or read-explain-only modes", () => {
    assert.equal(pageAssistMode(false), "inactive");
    assert.equal(pageAssistMode(true), "read-explain-only");
  });
});
