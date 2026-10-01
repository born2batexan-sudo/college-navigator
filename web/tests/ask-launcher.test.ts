import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askLauncherForPath } from "../lib/ask-launcher";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const launcher = read("../components/AskLauncher.tsx");
const layout = read("../app/layout.tsx");
const css = read("../app/globals.css");
const landing = read("../components/CampusPassageLanding.tsx");
const nav = read("../components/HeaderNav.tsx");

describe("route-aware Ask shortcut", () => {
  it("links public routes and unfinished household flows to general Ask", () => {
    for (const path of ["/", "/sample-plan", "/login", "/onboarding", "/account", "/account/mail-privacy"]) {
      assert.deepEqual(askLauncherForPath(path), { href: "/ask", label: "Ask about Campus Passage" }, path);
    }
  });
  it("links onboarded Passage routes to guarded personalized Ask", () => {
    for (const path of ["/dashboard", "/welcome", "/intake", "/request", "/feedback", "/school/sample", "/action/abc-123"]) {
      assert.deepEqual(askLauncherForPath(path), { href: "/ask/research", label: "Ask about your journey" }, path);
    }
  });
  it("never duplicates on Ask, technical, admin, demo, or unknown routes", () => {
    for (const path of ["/ask", "/ask/research", "/api/ask", "/admin/demo", "/demo/abc", "/not-a-real-page", "/school/a/b"]) {
      assert.equal(askLauncherForPath(path), null, path);
    }
  });
  it("keeps the existing navigation and uses a labeled, focusable link", () => {
    assert.match(nav, /href="\/ask"[^>]*>Ask about Campus Passage/);
    assert.match(layout, /<AskLauncher \/>/);
    assert.match(launcher, /<Link[^>]*href=\{destination\.href\} aria-label=\{destination\.label\}/);
    assert.match(launcher, /<svg aria-hidden="true"/);
    assert.match(css, /\.ask-launcher-link:focus-visible/);
    assert.match(css, /min-height: 48px/);
  });
  it("reserves a desktop rail, mobile safe-area dock and scroll clearance", () => {
    assert.match(css, /body:has\(\.ask-launcher\) \{ padding-right: 94px;/);
    assert.match(css, /body:has\(\.ask-launcher\) \{ padding-bottom: calc\(84px \+ env\(safe-area-inset-bottom/);
    assert.match(css, /html:has\(\.ask-launcher\) \{ scroll-padding-bottom:/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe("12² Standard headline", () => {
  it("promotes the precise squared typography into the semantic heading, not a decorative metric", () => {
    assert.match(landing, /<h2 id="standard-title" className="display standard-title">THE 12² STANDARD<\/h2>/);
    assert.match(landing, /<p className="standard-subtitle">Up to 144 checks per school, per term\.<\/p>/);
    assert.doesNotMatch(landing, /className="big144"|aria-hidden="true">12²<\/div>/);
    assert.doesNotMatch(css, /\.big144\s*\{/);
  });
});
