import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/MarketingHeader.tsx", import.meta.url), "utf8");

describe("immersive overview and accessible presentation", () => {
  it("keeps three campus photographs with non-specific attribution and efficient image sizing", () => {
    assert.match(source, /import Image from "next\/image"/);
    for (const path of ["hero", "guidance", "pathways"]) assert.match(source, new RegExp(`/images/campus-passage-${path}\\.webp`));
    assert.match(source, /className="hero-media" aria-hidden="true"/);
    assert.match(source, /alt="" fill priority sizes="100vw"/);
    assert.match(source, /alt="A parent and student reviewing a laptop/);
    assert.match(source, /alt="Students walking along different paths/);
    assert.equal((source.match(/Illustrative campus photography — not a specific school\./g) ?? []).length, 2);
  });
  it("uses visually distinct chapters, photo depth, readable hero, and provisional Route identity", () => {
    for (const part of ["question", "method", "passage", "example", "trust", "boundaries"]) assert.match(css, new RegExp(`\\.chapter-${part}\\s*\\{[^}]*background:`));
    assert.match(css, /\.hero-scrim\s*\{[^}]*background:/);
    assert.match(css, /\.hero-cinematic \.hero-title\s*\{[^}]*color:\s*#fff/);
    assert.match(css, /\.hero-cinematic \.lede\s*\{[^}]*color:/);
    assert.match(css, /\.hero-plan-card\s*\{[^}]*margin-bottom:\s*-3\.6rem/);
    assert.match(css, /\.guidance-panel-note\s*\{[^}]*margin-left:\s*-2\.6rem/);
    assert.match(css, /\.passage-banner-caption\s*\{[^}]*bottom:\s*-2\.6rem/);
    assert.match(header, /brand-route-coral/);
    assert.match(header, /brand-route-violet/);
  });
  it("keeps mobile navigation, focus visibility, and reduced-motion support", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /animation-duration: \.01ms !important/);
    assert.match(css, /button:focus-visible/);
    assert.match(css, /@media \(max-width: 480px\)/);
    assert.match(css, /\.navlinks \{ font-size: \.77rem; \}/);
    assert.match(header, /aria-label="Primary navigation"/);
  });
});
