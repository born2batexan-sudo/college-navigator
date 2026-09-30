import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/CampusPassageLanding.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/MarketingHeader.tsx", import.meta.url), "utf8");
const logo = readFileSync(new URL("../components/RouteLogo.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../components/HeaderNav.tsx", import.meta.url), "utf8");

describe("immersive overview and accessible presentation", () => {
  it("keeps three campus photographs with non-specific attribution and efficient image sizing", () => {
    assert.match(source, /import Image from "next\/image"/);
    for (const path of ["hero", "guidance", "pathways"]) assert.match(source, new RegExp(`/images/campus-passage-${path}\\.webp`));
    assert.match(source, /alt="Illustrative campus photography — not a specific school\." fill priority sizes="100vw"/);
    assert.match(source, /alt="A parent and student reviewing a laptop/);
    assert.match(source, /alt="Students walking along different paths/);
    // Captions are no longer visible text; the attribution lives in the images' alt attributes only.
    assert.equal((source.match(/Illustrative campus photography — not a specific school\./g) ?? []).length, 2);
    assert.doesNotMatch(source, /className="photo-caption/);
  });
  it("reproduces the approved mockup visual system: palette, type, hero composition, banner, and provisional Route identity", () => {
    for (const token of ["--paper: #fbf9f4", "--ink: #18273d", "--navy: #123b55", "--coral: #e8875b", "--muted: rgba(24,39,61,.7)", "--line: rgba(24,39,61,.12)", "--hero-bg: #0d2234"]) assert.ok(css.includes(token), token);
    assert.match(css, /\.site-shell \{[^}]*max-width: 1120px[^}]*padding-inline: 24px/);
    assert.match(css, /\.section \{[^}]*padding: 88px 0[^}]*border-bottom: 1px solid var\(--line\)/);
    assert.match(css, /h2\.display \{[^}]*font-size: clamp\(28px,4vw,40px\)[^}]*line-height: 1\.15/);
    assert.match(css, /\.hero-title \{[^}]*font-size: clamp\(34px,5\.2vw,58px\)[^}]*line-height: 1\.05[^}]*color: #fff/);
    assert.match(css, /\.hero-subhead \{[^}]*clamp\(20px,2\.4vw,26px\)/);
    assert.match(css, /\.hero-inner \{[^}]*grid-template-columns: 1\.25fr \.85fr[^}]*gap: 48px[^}]*padding-top: 96px[^}]*padding-bottom: 88px/);
    assert.match(css, /\.hero-media-img \{[^}]*opacity: \.45/);
    assert.match(css, /\.hero-plan-card \{[^}]*rgba\(251,249,244,\.97\)[^}]*border-radius: 16px[^}]*padding: 22px/);
    assert.match(css, /\.card \{[^}]*border-radius: 14px[^}]*padding: 22px/);
    assert.match(css, /\.grid4 \{[^}]*repeat\(4,1fr\)[^}]*gap: 16px/);
    assert.match(css, /\.split \{[^}]*grid-template-columns: 1fr 1fr[^}]*gap: 48px/);
    assert.match(css, /\.button, \.nav-cta|\.nav-cta, \.button/);
    assert.match(css, /border-radius: 8\.8px/);
    assert.match(css, /\.banner \{[^}]*background: var\(--navy\)[^}]*font-size: 14px/);
    assert.match(css, /\.final \{[^}]*background: var\(--navy\)/);
    assert.match(css, /\.topbar \{[^}]*height: 68px/);
    assert.match(css, /\.faq-question button \{[^}]*font: 600 19px var\(--serif\)/);
    assert.match(css, /\.hero-plan-card \{ display: none; \}/, "the illustrative card is hidden at mobile widths, as in the mockup");
    assert.doesNotMatch(css, /\.hero-scrim|hero-kenburns|hero-card-float|backdrop-filter/, "the mockup has no scrim, drift, or blur");
    assert.match(source, /className="banner"|MarketingHeader/);
    assert.match(header, /className="banner"/);
    assert.match(source, /className="section final"/);
    for (const color of ["#123B55", "#FBF9F4", "#E8875B"]) assert.match(logo, new RegExp(color));
    assert.match(logo, /PROVISIONAL/);
  });
  it("keeps mobile navigation, focus visibility, and reduced-motion support", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /animation-duration: \.01ms !important/);
    assert.match(css, /button:focus-visible/);
    assert.match(css, /@media \(max-width: 480px\)/);
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /\.nav-toggle \{ display: inline-flex; \}/);
    assert.match(css, /@media \(max-width: 400px\)/);
    assert.match(nav, /aria-label="Primary navigation"/);
    assert.match(css, /\.site-header \{ position: sticky/);
    assert.match(css, /clamp\(34px,5\.2vw,58px\)/, "H1 bottoms out at 34px on phones");
  });
});
