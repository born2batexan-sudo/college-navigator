import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { START_TERMS, isStartTerm, termNotice } from "../lib/terms";

describe("entering-term safety", () => {
  it("supports a Fall 2026 fixture without treating Fall 2027 research as current", () => {
    assert.equal(START_TERMS[0], "Fall 2026");
    assert.equal(isStartTerm("Fall 2026"), true);
    assert.match(termNotice("Fall 2026") ?? "", /will not present it as current for Fall 2026/);
    assert.equal(termNotice("Fall 2027"), null);
  });
});
