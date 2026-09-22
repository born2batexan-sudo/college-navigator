// Guards the corrected CampusPassage marketing boundary on the public landing
// page: the 12² Standard phrase is exact and un-explained, forbidden category
// language stays out, and every not-yet-live capability names itself plainly.
// Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

describe("landing page copy boundary", () => {
  it("states the 12² Standard only as the exact reserved phrase", () => {
    assert.match(source, /144 checks\. Every college\. Every applicable term\./);
    // No exposed checkpoint count/category vocabulary near the standard.
    assert.doesNotMatch(source, /checkpoint/i);
  });

  it("never uses the forbidden category or feature framing", () => {
    assert.doesNotMatch(source, /concierge/i);
    assert.doesNotMatch(source, /over the horizon/i);
    // Draft/auto-fill suggestions are built-disabled and must not be marketed.
    assert.doesNotMatch(source, /draft/i);
    assert.doesNotMatch(source, /autofill/i);
  });

  it("never implies CampusPassage applies, submits, processes, or logs into a portal on the household's behalf", () => {
    assert.doesNotMatch(source, /CampusPassage\s+(submits|processes|files|pays|applies for)\b/i);
    assert.doesNotMatch(source, /log(s|ging)?\s+in(to)?\s+(a|the|your)\s+portal/i);
    assert.doesNotMatch(source, /\bfills? (in|out) (a|the|your) form\b/i);
  });

  it("labels Guide, Horizon, Page Assist, multi-student, and reminders as planned or roadmap wherever they appear", () => {
    assert.match(source, /Planned:\s*CampusPassage Guide/);
    assert.match(source, /CampusPassage Horizon/);
    assert.match(source, /Planned:\s*a calm view of upcoming school announcements/);
    assert.match(source, /Planned premium capability/);
    assert.match(source, /Page Assist/);
    assert.match(source, /Planned:\s*switch cleanly between every student/);
    assert.match(source, /Planned:\s*switch to another student/);
    assert.match(source, /Email · planned/);
    assert.match(source, /SMS · planned/);
    assert.doesNotMatch(source, /Email · core/);
    // A single explicit backstop statement in addition to each inline label.
    assert.match(source, /named on this page as planned or roadmap architecture — none are part of this preview today/);
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

  it("keeps video, captions, and transcript access wired up", () => {
    assert.match(source, /product-story\.mp4/);
    assert.match(source, /product-story\.vtt/);
    assert.match(source, /product-story-transcript\.txt/);
  });

  it("keeps accessible landmarks: skip link, tab roles, and focus targets", () => {
    assert.match(source, /className="skip-link"/);
    assert.match(source, /role="tablist"/);
    assert.match(source, /role="tabpanel"/);
  });

  it("keeps the root SEO metadata aligned with the corrected, broader mission", () => {
    assert.doesNotMatch(layout, /concierge/i);
    assert.doesNotMatch(layout, /over the horizon/i);
    assert.match(layout, /before, during, and after applications/);
  });
});
