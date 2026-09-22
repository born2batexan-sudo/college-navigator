// Guards the Campus Passage marketing boundary on the public landing page:
// the 12² Standard phrase is exact and un-explained, forbidden category
// language stays out, every not-yet-live capability is marked with the
// Live/Preview/Coming badge vocabulary (not repeated hedge words in prose),
// and the flawed synthetic-voiceover video is not a featured proof point.
// Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("landing page copy boundary", () => {
  it("states the 12² Standard only as the exact reserved phrase, with no exposed mechanics", () => {
    assert.match(source, /144 checks\. Every college\. Every applicable term\./);
    // No exposed checkpoint count/category vocabulary, and no rendered checklist, near the standard.
    assert.doesNotMatch(source, /checkpoint/i);
  });

  it("never uses the forbidden category or feature framing", () => {
    assert.doesNotMatch(source, /concierge/i);
    assert.doesNotMatch(source, /over the horizon/i);
    assert.doesNotMatch(source, /\bdraft\b/i);
    assert.doesNotMatch(source, /autofill/i);
  });

  it("never implies Campus Passage applies, submits, processes, or logs into a portal on the household's behalf", () => {
    assert.doesNotMatch(source, /Campus Passage\s+(submits|processes|files|pays|applies for)\b/i);
    assert.doesNotMatch(source, /log(s|ging)?\s+in(to)?\s+(a|the|your)\s+portal/i);
    assert.doesNotMatch(source, /\bfills? (in|out) (a|the|your) form\b/i);
  });

  it("uses one Live/Preview/Coming badge vocabulary instead of repeated inline hedge words", () => {
    // The Badge component is the single source of the three tiers.
    assert.match(source, /function Badge\(/);
    assert.match(source, /"live" \? "Live" : tone === "preview" \? "Preview" : "Coming"/);
    assert.match(source, /badge badge-\$\{tone\}/);
    assert.match(css, /\.badge-live/);
    assert.match(css, /\.badge-preview/);
    assert.match(css, /\.badge-coming/);
    // Household Horizon and multi-student switching are the interactive, "Live" capabilities of this preview.
    assert.match(source, /title: "Household Horizon", tone: "live"/);
    assert.match(source, /title: "Every student, every desired school", tone: "live"/);
    // Ask Campus Passage, Page Assist, and reminders stay named-but-not-interactive ("Coming").
    assert.match(source, /Ask Campus Passage will explain/);
    assert.match(source, /Page Assist will help a person understand/);
    // A single explicit backstop statement, not a repeated hedge word in every sentence.
    assert.match(source, /Ask Campus Passage, Page Assist, and email\/SMS reminders are Coming/);
  });

  it("keeps the scholarship/aid boundary: awareness only, never an eligibility or qualification claim", () => {
    assert.match(source, /never states or predicts that a student qualifies or will be selected/);
    assert.doesNotMatch(source, /\byou qualify\b/i);
    assert.doesNotMatch(source, /\bguaranteed (scholarship|aid|funding)\b/i);
  });

  it("retains the request-access, portal-password, and source-context truthfulness cues", () => {
    assert.match(source, /No school-portal passwords/);
    assert.match(source, /read-only demonstration, not enrollment in a live service/);
    assert.match(source, /Request private-preview access/);
  });

  it("does not feature the flawed synthetic-voiceover video as a public proof point", () => {
    assert.doesNotMatch(source, /product-story\.mp4/);
    assert.doesNotMatch(source, /product-story\.vtt/);
    assert.doesNotMatch(source, /product-story-transcript\.txt/);
    assert.doesNotMatch(source, /<video/);
    // No claim that a replacement video exists either.
    assert.doesNotMatch(source, /narrated/i);
  });

  it("keeps accessible landmarks: skip link, tab roles, and focus targets", () => {
    assert.match(source, /className="skip-link"/);
    assert.match(source, /role="tablist"/);
    assert.match(source, /role="tabpanel"/);
    assert.match(source, /aria-live="polite"/);
  });

  it("writes the brand name as two words everywhere except a literal domain string", () => {
    assert.doesNotMatch(source, /CampusPassage(?!Landing)/);
    assert.match(source, /Campus Passage/);
  });

  it("keeps the root SEO metadata aligned with the corrected, broader mission", () => {
    assert.doesNotMatch(layout, /concierge/i);
    assert.doesNotMatch(layout, /over the horizon/i);
    assert.match(layout, /before, during, and after applications/);
    assert.doesNotMatch(layout, /CampusPassage(?!\.com)/);
  });
});
