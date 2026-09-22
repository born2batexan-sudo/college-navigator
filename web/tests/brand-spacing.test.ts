// The brand reads as two words, "Campus Passage", everywhere a person or a
// crawler can read it — copy, metadata, alt text, comments. The only
// exception is a literal campuspassage.com domain string (always lowercase
// in this codebase) and the CampusPassageLanding component/file identifier,
// which is code, not brand copy. Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LANDING = readFileSync(path.join(ROOT, "components", "CampusPassageLanding.tsx"), "utf8");
const APP_ICON = readFileSync(path.join(ROOT, "app", "icon.svg"), "utf8");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);
const SCAN_DIRS = ["app", "components", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// Case-sensitive: matches "CampusPassage" only when NOT immediately followed by
// a word character (so "CampusPassageLanding" the identifier is exempt, while
// "CampusPassage" as a standalone brand mention, "CampusPassage:", "CampusPassage.",
// "CampusPassage's", etc. is caught).
const UNSPACED_BRAND = /CampusPassage(?![A-Za-z0-9])/;

describe("brand name reads as two words", () => {
  it("finds no unspaced 'CampusPassage' brand mention outside the component identifier", () => {
    const hits: { file: string; line: number; text: string }[] = [];
    for (const dir of SCAN_DIRS) {
      let files: string[] = [];
      try {
        files = walk(path.join(ROOT, dir));
      } catch {
        continue;
      }
      for (const f of files) {
        const rel = path.relative(ROOT, f).split(path.sep).join("/");
        const lines = readFileSync(f, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (UNSPACED_BRAND.test(line)) hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
        });
      }
    }
    assert.deepEqual(hits, [], `unspaced "CampusPassage" found: ${hits.map((h) => `${h.file}:${h.line}`).join(", ")}`);
  });

  it("uses the two-word brand name at least once in the key user-facing surfaces", () => {
    const surfaces = ["app/layout.tsx", "app/login/page.tsx", "app/welcome/page.tsx", "app/dashboard/page.tsx", "components/CampusPassageLanding.tsx", "app/review-lab/ReviewLab.tsx"];
    for (const rel of surfaces) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      assert.match(text, /Campus Passage/, `${rel} should mention "Campus Passage"`);
    }
  });
});

describe("provisional Converging Routes identity", () => {
  it("replaces the placeholder diamond with an accessible decorative route mark", () => {
    assert.doesNotMatch(LANDING, /◇/, "the old placeholder diamond must not remain");
    assert.match(LANDING, /function ConvergingRoutesMark\(\)/);
    assert.match(LANDING, /<svg className="brand-mark brand-mark-svg"[^>]*aria-hidden="true"[^>]*focusable="false"/);
    assert.match(LANDING, /className="brand-mark-boundary"/);
    for (const route of ["coral", "gold", "teal", "violet"]) {
      assert.match(LANDING, new RegExp(`brand-route-${route}`), `expected a ${route} route stroke`);
    }
    assert.match(LANDING, /aria-label="Campus Passage home"[^>]*>\s*<ConvergingRoutesMark \/>Campus Passage/);
  });

  it("keeps the favicon as small-size vector geometry with no embedded text", () => {
    assert.match(APP_ICON, /^<!--[^]*?-->/, "the icon should document its provisional status in a code comment");
    assert.match(APP_ICON, /<svg\b[^>]*viewBox="0 0 64 64"/);
    assert.match(APP_ICON, /<circle\b/);
    assert.match(APP_ICON, /<path\b/);
    assert.doesNotMatch(APP_ICON, /<(?:text|image|foreignObject)\b/i);
    assert.doesNotMatch(APP_ICON, /Campus Passage/);
  });
});
