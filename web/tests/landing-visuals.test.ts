// Guards the cinematic, campus-grounded visual treatment added to the public
// landing page: the three supplied photographs are wired up with efficient,
// accessible next/image usage, placed with narrative purpose (hero mood,
// pathways metaphor inside the proof section, guidance photo humanizing the
// product-model section), captioned so no specific/endorsed school is ever
// implied, and the hero's text-contrast and reduced-motion safeguards stay
// in place. This is a structural/accessibility guard, not a pixel check.
// Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const HERO_PATH = "/images/campus-passage-hero.webp";
const PATHWAYS_PATH = "/images/campus-passage-pathways.webp";
const GUIDANCE_PATH = "/images/campus-passage-guidance.webp";

function indexOfId(id: string): number {
  const idx = source.indexOf(`id="${id}"`);
  assert.notEqual(idx, -1, `expected to find id="${id}"`);
  return idx;
}

describe("landing page campus photography", () => {
  it("uses next/image for all three supplied photographs", () => {
    assert.match(source, /import Image from "next\/image"/);
    for (const p of [HERO_PATH, PATHWAYS_PATH, GUIDANCE_PATH]) {
      assert.match(source, new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `expected ${p} to be referenced`);
    }
  });

  it("loads the hero photograph efficiently as a full-bleed, decorative background", () => {
    const heroBlock = source.slice(source.indexOf(HERO_PATH) - 400, source.indexOf(HERO_PATH) + 400);
    assert.match(heroBlock, /alt=""/, "hero photo should be decorative (empty alt)");
    assert.match(heroBlock, /\bfill\b/, "hero photo should use next/image fill for the full-bleed background");
    assert.match(heroBlock, /\bpriority\b/, "hero photo should be marked priority for fast LCP loading");
    assert.match(heroBlock, /sizes="100vw"/);
    assert.match(source, /className="hero-media" aria-hidden="true"/, "hero photo wrapper should be hidden from assistive tech since it is purely atmospheric");
  });

  it("gives the pathways and guidance photographs meaningful, non-empty alt text", () => {
    const pathwaysBlock = source.slice(source.indexOf(PATHWAYS_PATH) - 300, source.indexOf(PATHWAYS_PATH) + 300);
    const guidanceBlock = source.slice(source.indexOf(GUIDANCE_PATH) - 300, source.indexOf(GUIDANCE_PATH) + 300);
    assert.doesNotMatch(pathwaysBlock, /alt=""/);
    assert.doesNotMatch(guidanceBlock, /alt=""/);
    assert.match(pathwaysBlock, /alt="[^"]*path/i);
    assert.match(guidanceBlock, /alt="[^"]*(laptop|reviewing|student)/i);
    // Non-hero photos are given explicit intrinsic dimensions and responsive sizes for efficient loading.
    assert.match(pathwaysBlock, /width=\{1536\}/);
    assert.match(pathwaysBlock, /height=\{864\}/);
    assert.match(pathwaysBlock, /sizes="/);
    assert.match(guidanceBlock, /width=\{1536\}/);
    assert.match(guidanceBlock, /height=\{864\}/);
    assert.match(guidanceBlock, /sizes="/);
  });

  it("never lets any photo caption or alt text claim or imply a specific, identifiable, or endorsing school", () => {
    const captionCount = (source.match(/Illustrative campus photography — not a specific school\./g) ?? []).length;
    assert.ok(captionCount >= 2, "expected the non-specific-school caption near the hero and the pathways banner");
    assert.doesNotMatch(source, /\b(University of|State University|College of)\b/);
  });

  it("places the pathways photograph inside the proof section, ahead of the interactive demo, as a pathway metaphor", () => {
    const proofIdx = indexOfId("proof");
    const pathwaysIdx = source.indexOf(PATHWAYS_PATH);
    const widgetIdx = source.indexOf("<HouseholdHorizonProof");
    assert.ok(pathwaysIdx > proofIdx, "pathways photo should be inside the proof section");
    assert.ok(pathwaysIdx < widgetIdx, "pathways photo should introduce the demo, not follow it");
    assert.match(source, /different pathways/i, "the pathways photo's caption should tie explicitly to the two-pathways story");
  });

  it("places the guidance photograph inside the how-it-works section, humanizing the product model before the anatomy ledger", () => {
    const howItWorksIdx = indexOfId("how-it-works");
    const journeyIdx = indexOfId("journey");
    const guidanceIdx = source.indexOf(GUIDANCE_PATH);
    const anatomyIdx = source.indexOf('<ol className="anatomy">');
    assert.ok(guidanceIdx > howItWorksIdx && guidanceIdx < journeyIdx, "guidance photo should live inside the how-it-works section");
    assert.ok(guidanceIdx < anatomyIdx, "guidance photo should humanize the model before the numbered anatomy ledger");
  });

  it("keeps the hero readable over any part of the photograph with a scrim and explicit light text colors", () => {
    assert.match(css, /\.hero-scrim\s*\{[^}]*background:/);
    assert.match(css, /\.hero-cinematic \.hero-title\s*\{[^}]*color:\s*#fff/);
    assert.match(css, /\.hero-cinematic \.lede\s*\{[^}]*color:/);
  });

  it("keeps subtle hero/photo motion governed by the site-wide prefers-reduced-motion safeguard", () => {
    assert.match(css, /@keyframes hero-kenburns/);
    assert.match(css, /@keyframes hero-card-float/);
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{[^}]*animation-duration: \.01ms !important;[^}]*animation-iteration-count: 1 !important;/,
      "the universal reduced-motion rule must still neutralize any animation on the page, including the new hero motion",
    );
  });

  it("retains layered, overlapping card compositions instead of flat, identical stacked cards", () => {
    // Each photo-driven panel below overlaps its own image with a distinct card,
    // rather than repeating one uniform card shape across the page.
    assert.match(css, /\.hero-plan-card\s*\{[^}]*margin-bottom:\s*-3\.6rem/);
    assert.match(css, /\.guidance-panel-note\s*\{[^}]*margin-left:\s*-2\.6rem/);
    assert.match(css, /\.passage-banner-caption\s*\{[^}]*bottom:\s*-2\.6rem/);
  });
});
