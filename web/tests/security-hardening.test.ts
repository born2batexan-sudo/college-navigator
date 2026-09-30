import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isApplicationProtectedPath } from "../lib/auth/protected-routes";
import { APPLICATION_SECURITY_HEADERS, PRIVATE_NO_STORE, isUnsupportedApplicationMethod } from "../lib/security-headers";

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("application security response hardening", () => {
  it("uses one reviewed set of security headers and disables the powered-by banner", () => {
    const config = read("next.config.js");
    for (const header of Object.keys(APPLICATION_SECURITY_HEADERS)) assert.ok(config.includes(header), `${header} must be applied by Next config`);
    assert.match(config, /poweredByHeader:\s*false/);
    assert.match(APPLICATION_SECURITY_HEADERS["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.equal(APPLICATION_SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
    assert.match(config, /source:\s*"\/:path\*"/);
  });

  it("keeps login and the fictional sample explicitly non-indexable with route-appropriate canonicals", () => {
    const login = read("app/login/page.tsx");
    const sample = read("app/sample-plan/page.tsx");
    assert.match(login, /alternates:\s*\{\s*canonical:\s*"\/login"\s*\}/);
    assert.match(login, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
    assert.match(sample, /alternates:\s*\{\s*canonical:\s*"\/sample-plan"\s*\}/);
    assert.match(sample, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  });

  it("protects known household routes but lets unknown routes reach a 404", () => {
    for (const route of ["/dashboard", "/account", "/account/mail-privacy", "/api/ask", "/action/abc", "/invite/token", "/school/state-university"]) {
      assert.equal(isApplicationProtectedPath(route), true, `${route} should be authenticated`);
    }
    for (const route of ["/missing", "/settings", "/dashboard/extra", "/action/abc/extra", "/sample-plan/extra", "/api/not-a-route"]) {
      assert.equal(isApplicationProtectedPath(route), false, `${route} should not be mistaken for a protected route`);
    }
  });

  it("marks login private and no-store and keeps app-level 404s generic and non-indexable", () => {
    const config = read("next.config.js");
    const proxy = read("proxy.ts");
    const notFound = read("app/not-found.tsx");
    assert.ok(config.includes(PRIVATE_NO_STORE));
    assert.match(proxy, /Cache-Control/);
    assert.match(proxy, /PRIVATE_NO_STORE/);
    assert.match(notFound, /dynamic\s*=\s*"force-dynamic"/);
    assert.match(notFound, /Page not found/);
    assert.match(notFound, /index:\s*false/);
    assert.doesNotMatch(notFound, /household|student|account/i);
  });

  it("rejects unsupported methods while preserving the Next action and read methods", () => {
    for (const method of ["DELETE", "PATCH", "PUT", "TRACE", "CONNECT"]) assert.equal(isUnsupportedApplicationMethod(method), true);
    for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) assert.equal(isUnsupportedApplicationMethod(method), false);
    assert.match(read("proxy.ts"), /Allow:\s*"GET, HEAD, POST, OPTIONS"/);
  });
});
