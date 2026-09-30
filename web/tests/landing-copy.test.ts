import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const overview = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const sample = readFileSync(new URL("../components/SamplePlan.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/MarketingHeader.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const robots = readFileSync(new URL("../app/robots.ts", import.meta.url), "utf8");
const sitemap = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");

function visibleText(source: string) { return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""); }

describe("public copy boundaries", () => {
  it("leads with the owner-brief WHY headline and keeps the product-truth explanation", () => {
    assert.match(overview, /<h1[^>]*>Be their parent, not their project manager\.<\/h1>/);
    assert.match(overview, /Every college step, in one plan, with whose move it is\./);
    assert.match(overview, /College application &amp; deadline tracker for parents/);
    assert.doesNotMatch(overview + layout, /Protect the opportunity/);
    assert.doesNotMatch(overview, /Don&apos;t miss the moment|Don't miss the moment|two kids|two timelines/i);
    assert.match(overview, /From the first application to move-in day, Campus Passage brings verified dates, school-side waits, and family next steps into one clear plan/);
  });
  it("keeps email connectivity outside the core flow and labels it Coming Soon", () => {
    assert.match(overview, /Tell us what matters to your family/);
    assert.match(overview, /Follow one clear, verified plan/);
    assert.doesNotMatch(overview, /Connect an inbox, if you choose/);
    assert.match(overview, /Email Connectivity — Coming Soon/);
    assert.match(overview, /optional paid add-on/);
    assert.match(overview, /Created by families who have been there/);
    assert.doesNotMatch(overview, /co-founder with a legal background/);
  });
  it("keeps four marketing essentials and all seven details inside each sample item", () => {
    assert.equal((overview.match(/\["(?:What it is|Whose move|By when|What's at stake)"/g) ?? []).length, 4);
    assert.doesNotMatch(visibleText(overview), /honest facts|seven facts/i);
    for (const item of ["What it is", "Student, school, term", "Whose move", "By when", "Official source", "Freshness"]) assert.match(sample, new RegExp(`<dt>${item}</dt>`));
    assert.match(sample, /<dt>What&apos;s at stake<\/dt>/);
  });
  it("no longer carries roadmap sub-blocks or a claimed review standard", () => {
    for (const label of ["In the public sample", "In development", "Planned"]) assert.doesNotMatch(overview, new RegExp(`<h3>${label}</h3>`));
    assert.doesNotMatch(overview, /None is interactive or offered for purchase|No eligibility, award, or qualified-expense decision is made here/);
    assert.doesNotMatch(overview, /badge-live|tone="live"|>Live</);
  });
  it("preserves substantive boundaries, reserved phrase, and no synthetic video", () => {
    assert.match(visibleText(overview), /Up to 144/, "approved up-to-144 public standard is shown");
    assert.doesNotMatch(overview, /checkpoint/i);
    for (const verb of ["apply", "submit", "decide", "pay", "change"]) assert.match(overview, new RegExp(verb, "i"));
    assert.match(overview, /No portal passwords/);
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
  it("allows indexing only for the approved public homepage", () => {
    assert.match(layout, /index:\s*true/);
    assert.match(layout, /follow:\s*true/);
    assert.doesNotMatch(layout, /noindex|index:\s*false/);
    assert.match(robots, /allow:\s*"\/"/);
    assert.doesNotMatch(robots, /disallow:\s*"\/"/);
    assert.match(robots, /https:\/\/www\.campuspassage\.com\/sitemap\.xml/);
    assert.match(sitemap, /https:\/\/www\.campuspassage\.com\//);
    assert.doesNotMatch(sitemap, /request-access|sample-plan|dashboard|login/);
  });
});
