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
const LANDING = readFileSync(path.join(ROOT, "components", "RouteLogo.tsx"), "utf8");
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

describe("provisional Route identity (owner brief File B)", () => {
  it("renders the exact Route geometry as a decorative icon beside the accessible wordmark link", () => {
    assert.doesNotMatch(LANDING, /◇/, "the old placeholder diamond must not remain");
    assert.match(LANDING, /function RouteIcon\(/);
    assert.match(LANDING, /<svg className="route-icon" viewBox="0 0 48 48"[^>]*aria-hidden="true"[^>]*focusable="false"/);
    assert.match(LANDING, /<rect width="48" height="48" rx="11" fill="#123B55" \/>/);
    assert.match(LANDING, /d="M18,82 L40,64 L58,40 L84,20"/);
    assert.match(LANDING, /<circle cx="84" cy="20" r="10" fill="#E8875B" \/>/);
    assert.match(LANDING, /aria-label="Campus Passage home"/);
    assert.match(LANDING, /brand-wordmark">Campus Passage</);
    assert.match(LANDING, /PROVISIONAL/);
  });

  it("keeps the favicon as small-size vector geometry with no embedded text, identical to the header icon", () => {
    assert.match(APP_ICON, /^<!--[^]*?PROVISIONAL[^]*?-->/, "the icon should document its provisional status in a code comment");
    assert.match(APP_ICON, /<svg\b[^>]*viewBox="0 0 48 48"/);
    assert.match(APP_ICON, /<rect\b[^>]*fill="#123B55"/);
    assert.match(APP_ICON, /<path\b/);
    assert.doesNotMatch(APP_ICON, /<(?:text|image|foreignObject)\b/i);
    assert.doesNotMatch(APP_ICON, /aria-label|role=/);
  });

  it("uses Epilogue only for the wordmark and retires the old circular mark", () => {
    const css = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
    assert.equal((css.match(/--font-epilogue/g) ?? []).length, 1);
    assert.doesNotMatch(css, /brand-route|brand-mark/);
    assert.match(readFileSync(path.join(ROOT, "app", "layout.tsx"), "utf8"), /Epilogue\(\{ subsets: \["latin"\], weight: "600"/);
  });
});
