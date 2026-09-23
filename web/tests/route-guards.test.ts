// Static checks that keep the sign-in wall from being quietly removed.
// They read the source files; nothing runs. Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { isPublicPath } from "../lib/auth/env";

const ROOT = process.cwd();
const APP = path.join(ROOT, "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const files = walk(APP);
const read = (p: string) => readFileSync(p, "utf-8");

const GUARD = /(?:require(?:Writable(?:Onboarded)?Household|WritableSelectedStudent|SelectedStudent|OnboardedHousehold|InvitationHousehold|Household|User|DemoOwner)|authorizedApiHousehold)\(/;

// Pages that are allowed without sign-in.
const PUBLIC_PAGES = new Set(["app/page.tsx", "app/sample-plan/page.tsx", "app/login/page.tsx", "app/request-access/page.tsx", "app/debug-page-check/page.tsx"]); // overview, fixed fictional sample, and generic access request are public; debug is an inert 404 stub
// Server-action files whose functions may run without sign-in (signing in itself or submitting a generic demo request).
const PUBLIC_ACTIONS = new Set(["app/login/actions.ts", "app/request-access/actions.ts"]);
// Route handlers that authenticate some other way.
const PUBLIC_ROUTES = new Set(["app/auth/callback/route.ts", "app/api/stripe/webhook/route.ts", "app/api/mail/maintenance/route.ts"]); // Stripe route verifies raw signed body and is disabled by default
const GUARDED_ROUTES = new Set(["app/api/ask/route.ts", "app/api/mail/callback/[provider]/route.ts"]);

describe("route guards", () => {
  it("every page requires a signed-in family unless it is on the public list", () => {
    const pages = files.filter((f) => f.endsWith("/page.tsx"));
    assert.ok(pages.length >= 8, "expected to find the app's pages");
    for (const f of pages) {
      if (PUBLIC_PAGES.has(rel(f))) continue;
      assert.match(read(f), GUARD, `${rel(f)} must call requireHousehold/requireOnboardedHousehold/requireUser`);
    }
  });

  it("every server action requires a signed-in family unless it is on the public list", () => {
    const actionFiles = files.filter((f) => /\/actions\.ts$/.test(f));
    assert.ok(actionFiles.length >= 4);
    for (const f of actionFiles) {
      if (PUBLIC_ACTIONS.has(rel(f))) continue;
      const src = read(f);
      const bodies = src.split(/export async function /).slice(1);
      assert.ok(bodies.length > 0, `${rel(f)} has no exported actions`);
      for (const body of bodies) {
        const name = body.slice(0, body.indexOf("("));
        assert.match(body, GUARD, `${rel(f)}: action ${name} must call a require... guard`);
      }
    }
  });

  it("no inline server action skips the ownership check", () => {
    // Inline "use server" functions inside pages delegate to advanceActionState, which checks ownership itself.
    const src = read(path.join(APP, "action", "[id]", "page.tsx"));
    assert.match(src, /actionBelongsToHousehold\(/);
    const actions = read(path.join(APP, "actions.ts"));
    assert.match(actions, /actionBelongsToHousehold\(/);
  });

  it("agent routes check the agent key and are disabled in production", () => {
    assert.match(read(path.join(ROOT, "app/api/agent/_auth.ts")), /NODE_ENV === "production"/);
    const routes = files.filter((f) => rel(f).startsWith("app/api/agent/") && f.endsWith("/route.ts"));
    assert.ok(routes.length >= 6);
    for (const f of routes) assert.match(read(f), /requireAgentAuth\(/, `${rel(f)} must call requireAgentAuth`);
  });

  it("every other route handler is on the reviewed list", () => {
    const routes = files.filter((f) => f.endsWith("/route.ts")).map(rel);
    for (const r of routes) {
      const ok =
        r.startsWith("app/api/agent/") ||
        r.startsWith("app/api/companion/") ||
        r.startsWith("app/api/debug/") ||
        PUBLIC_ROUTES.has(r) ||
        GUARDED_ROUTES.has(r);
      if (GUARDED_ROUTES.has(r) || r.startsWith("app/api/companion/")) assert.match(read(path.join(ROOT,r)), /authorizedApiHousehold\(/);
      assert.ok(ok, `${r} is a new route handler: add sign-in checks, then list it here`);
    }
  });

  it("the extension endpoints are production-disabled and never list households", () => {
    const companion = read(path.join(ROOT, "lib", "companion.ts"));
    assert.match(companion, /DEMO_HOUSEHOLD_ID = "demo-household"/);
    assert.match(read(path.join(ROOT, "app/api/companion/context/route.ts")), /NODE_ENV===?"production"/);
    assert.match(read(path.join(ROOT, "app/api/companion/observe/route.ts")), /NODE_ENV===?"production"/);
    for (const f of [...files, path.join(ROOT, "lib", "companion.ts")]) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      assert.doesNotMatch(read(f), /listHouseholds\(/, `${rel(f)} must not use listHouseholds()`);
    }
  });

  it("retired debug endpoints stay inert", () => {
    for (const f of ["app/api/debug/env-check/route.ts", "app/debug-page-check/page.tsx"]) {
      const p = path.join(ROOT, f);
      if (!existsSync(p)) continue;
      const src = read(p);
      assert.doesNotMatch(src, /process\.env/, `${f} must not read environment variables`);
    }
  });

  it("the proxy denies by default and its public list is the reviewed one", () => {
    const env = read(path.join(ROOT, "lib", "auth", "env.ts"));
    const block = env.slice(env.indexOf("PUBLIC_PATH_PREFIXES"), env.indexOf("];", env.indexOf("PUBLIC_PATH_PREFIXES")));
    const listed = [...block.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(listed, ["/_next/", "/api/agent/", "/api/stripe/webhook", "/auth/callback", "/favicon.ico", "/login", "/media/", "/request-access", "/robots.txt", "/sitemap.xml"]);
    assert.match(env, /pathname === "\/"/);
    assert.match(env, /pathname === "\/sample-plan"/);
    assert.doesNotMatch(block, /"\/sample-plan"/, "the sample page must be an exact-match exception, not a public prefix");
    assert.match(read(path.join(ROOT, "proxy.ts")), /!isPublicPath\(pathname\)/);
  });

  it("opens only the exact fictional sample path, not adjacent private routes", () => {
    assert.equal(isPublicPath("/sample-plan"), true);
    assert.equal(isPublicPath("/sample-plan/private"), false);
    assert.equal(isPublicPath("/sample-plan-other"), false);
    assert.equal(isPublicPath('/api/stripe/webhook'),true);
    assert.equal(isPublicPath('/api/stripe/webhook-other'),false);
    assert.equal(isPublicPath('/auth/callback'),true);
    assert.equal(isPublicPath('/auth/callback/other'),false);
    assert.equal(isPublicPath('/api/debug/unknown'),false);
  });

  it("dev sign-in cannot be enabled in a production build", () => {
    const env = read(path.join(ROOT, "lib", "auth", "env.ts"));
    assert.match(env, /devLoginEnabled = process\.env\.NODE_ENV !== "production"/);
  });
});
