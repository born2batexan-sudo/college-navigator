// Static checks that keep the sign-in wall from being quietly removed.
// They read the source files; nothing runs. Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

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

const GUARD = /require(?:Writable(?:Onboarded)?Household|OnboardedHousehold|Household|User|DemoOwner)\(/;

// Pages that are allowed without sign-in.
const PUBLIC_PAGES = new Set(["app/page.tsx", "app/login/page.tsx", "app/debug-page-check/page.tsx"]); // homepage is public; the debug page is an inert 404 stub
// Server-action files whose functions may run without sign-in (signing in itself).
const PUBLIC_ACTIONS = new Set(["app/login/actions.ts"]);
// Route handlers that authenticate some other way.
const PUBLIC_ROUTES = new Set(["app/auth/callback/route.ts"]);

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

  it("agent routes check the agent key", () => {
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
        PUBLIC_ROUTES.has(r);
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
    assert.deepEqual(listed, ["/_next/", "/api/agent/", "/api/debug/", "/auth/", "/favicon.ico", "/login"]);
    assert.match(env, /pathname === "\/"/);
    assert.match(read(path.join(ROOT, "proxy.ts")), /!isPublicPath\(pathname\)/);
  });

  it("dev sign-in cannot be enabled in a production build", () => {
    const env = read(path.join(ROOT, "lib", "auth", "env.ts"));
    assert.match(env, /devLoginEnabled = process\.env\.NODE_ENV !== "production"/);
  });
});
