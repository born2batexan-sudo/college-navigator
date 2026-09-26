import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const overview = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const sample = readFileSync(new URL("../components/SamplePlan.tsx", import.meta.url), "utf8");
const root = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const sampleRoute = readFileSync(new URL("../app/sample-plan/page.tsx", import.meta.url), "utf8");

const sections = ["top", "why-it-matters", "how-it-helps", "the-journey", "sample", "trust", "boundaries", "next-step"];

describe("public routes and chapter sequence", () => {
  it("keeps why, stakes, better way, example, trust, and next step in order on the overview", () => {
    const positions = sections.map((id) => overview.indexOf(`id="${id}"`));
    assert.ok(positions.every((n) => n >= 0));
    for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1], `${sections[i]} should follow ${sections[i - 1]}`);
  });
  it("separates the interactive fictional sample from the overview route", () => {
    assert.doesNotMatch(root, /getSessionUser\(\)|redirect\("\/dashboard"\)/, "overview remains open even for signed-in visitors");
    assert.match(root, /<CampusPassageLanding \/>/);
    assert.doesNotMatch(overview, /actionsFor\(|useState\(|<SamplePlan \/>/);
    assert.match(overview, /href="\/sample-plan"/);
    assert.match(sampleRoute, /dynamic = "force-static"/);
    assert.match(sampleRoute, /<SamplePlan \/>/);
    assert.doesNotMatch(sampleRoute, /getSessionUser|@\/lib\/db|redirect\(/);
    assert.match(sample, /personalizedPlan\(active, intake\)/);
  });
  it("uses customer navigation, not internal authoring labels or old anchors", () => {
    const header = readFileSync(new URL("../components/MarketingHeader.tsx", import.meta.url), "utf8");
    for (const label of ["Overview", "Why it matters", "How it helps", "Sample plan", "Trust"]) assert.match(header, new RegExp(`>${label}<`));
    assert.doesNotMatch(overview + sample + header, /id="problem"|id="proof"|>Public story<|>Family plan<|>Recognize<|>Reframe<|>Proof</);
  });
});
