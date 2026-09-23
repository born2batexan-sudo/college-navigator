import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const overview = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const sample = readFileSync(new URL("../components/SamplePlan.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/MarketingHeader.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

function visibleText(source: string) { return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""); }

describe("public copy boundaries", () => {
  it("leads with the approved opportunity, not fear or household multiplicity", () => {
    assert.match(overview, /<h1[^>]*>Protect the opportunity\.<\/h1>/);
    assert.doesNotMatch(overview, /Don&apos;t miss the moment|Don't miss the moment|two kids|two timelines/i);
    assert.match(overview, /from interest to move-in\./i);
    assert.match(overview, /Campus Passage connects what schools, sponsors, and vendors publish to your family&apos;s own plan—so the next meaningful step is clear/);
  });
  it("keeps four marketing essentials and all seven details inside each sample item", () => {
    assert.equal((overview.match(/\["(?:What it is|Whose move|By when|What's at stake)"/g) ?? []).length, 4);
    assert.doesNotMatch(visibleText(overview), /honest facts|seven facts/i);
    for (const item of ["What it is", "Student, school, term", "Whose move", "By when", "Official source", "Freshness"]) assert.match(sample, new RegExp(`<dt>${item}</dt>`));
    assert.match(sample, /<dt>What&apos;s at stake<\/dt>/);
  });
  it("groups capability claims by truth state without claiming operation", () => {
    const labels = ["In the private preview", "In development", "Planned"];
    const positions = labels.map((label) => overview.indexOf(`<h3>${label}</h3>`));
    assert.ok(positions.every((idx) => idx >= 0));
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
    assert.match(overview, /not a live school feed/);
    assert.match(overview, /None is interactive or offered for purchase/);
    assert.doesNotMatch(overview, /badge-live|tone="live"|>Live</);
  });
  it("preserves substantive boundaries, reserved phrase, and no synthetic video", () => {
    assert.match(overview, /144 checks\. Every college\. Every applicable term\./);
    assert.doesNotMatch(overview, /checkpoint/i);
    for (const verb of ["apply", "submit", "decide", "pay", "change"]) assert.match(overview, new RegExp(verb, "i"));
    assert.match(overview, /No school-portal passwords/);
    assert.doesNotMatch(overview + sample, /concierge|over the horizon|autofill|<video|product-story\.mp4/i);
    assert.doesNotMatch(overview + sample + header + layout, /CampusPassage(?!Landing|\.com)/);
  });
  it("keeps exact customer pathway choices and same-cycle rule", () => {
    assert.match(sample, />Single Student<\/button>/);
    assert.match(sample, />Multiple Students<\/button>/);
    assert.match(sample, /two or more students/);
    assert.match(sample, /same high-school graduation year and admissions cycle/);
    assert.match(sample, /genuine caregiving responsibility/);
    assert.match(sample, /No live source checked/);
    assert.match(sample, /Fictional sample/);
    assert.match(overview + sample, /aria-live="polite"|aria-pressed=/);
    assert.match(overview, /className="skip-link"/);
  });
});
