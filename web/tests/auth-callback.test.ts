import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { callbackLoginLocation, isNoCodeSignupReturn } from "../lib/auth/callback";
import { canonicalPreviewLocation } from "../lib/auth/origin";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const ROOT = process.cwd();

describe("email authentication callback", () => {
  it("canonicalizes only this protected Preview branch to its allowlisted auth origin", () => {
    const previewUrl = new URL("https://college-navigator-gubxjz7d3-j-dock.vercel.app/welcome?tab=schools");
    const alias = "https://college-navigator-git-review-mvp-school-research-queue-j-dock.vercel.app";
    const canonical = canonicalPreviewLocation(
      previewUrl,
      "preview",
      "review/mvp-school-research-queue",
      alias,
    );
    assert.equal(canonical?.href, `${alias}/welcome?tab=schools`);
    assert.equal(canonicalPreviewLocation(new URL(`${alias}/login?next=%2Fwelcome`), "preview", "review/mvp-school-research-queue", alias), null);
    assert.equal(canonicalPreviewLocation(previewUrl, "production", "main", alias), null);
    assert.equal(canonicalPreviewLocation(previewUrl, "preview", "other/review-branch", alias), null);
    assert.throws(
      () => canonicalPreviewLocation(previewUrl, "preview", "review/mvp-school-research-queue", "https://www.campuspassage.com"),
      /allowlisted review-branch origin/,
    );

    const proxy = readFileSync(path.join(ROOT, "proxy.ts"), "utf8");
    assert.match(proxy, /canonicalPreviewLocation\(request\.nextUrl\)/);
    assert.ok(proxy.includes('(pathname === "/login" || isProtected)'));
    assert.match(proxy, /"code", "token_hash", "access_token", "refresh_token"/);
    assert.match(proxy, /request\.method === "GET" \|\| request\.method === "HEAD"/);
  });

  it("redirects immutable protected Preview visits before login and does not forward callback codes", async () => {
    const alias = "https://college-navigator-git-review-mvp-school-research-queue-j-dock.vercel.app";
    const previous = {
      vercelEnv: process.env.VERCEL_ENV,
      gitRef: process.env.VERCEL_GIT_COMMIT_REF,
      appOrigin: process.env.APP_ORIGIN,
    };
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "review/mvp-school-research-queue";
    process.env.APP_ORIGIN = alias;
    try {
      const protectedResponse = await proxy(new NextRequest("https://college-navigator-gubxjz7d3-j-dock.vercel.app/welcome?tab=schools"));
      assert.equal(protectedResponse.status, 307);
      assert.equal(protectedResponse.headers.get("location"), `${alias}/welcome?tab=schools`);
      assert.match(protectedResponse.headers.get("cache-control") ?? "", /private/);

      const callbackResponse = await proxy(new NextRequest("https://college-navigator-gubxjz7d3-j-dock.vercel.app/auth/callback?code=one-time-code"));
      assert.equal(callbackResponse.headers.get("location"), null);
    } finally {
      for (const [key, value] of Object.entries({
        VERCEL_ENV: previous.vercelEnv,
        VERCEL_GIT_COMMIT_REF: previous.gitRef,
        APP_ORIGIN: previous.appOrigin,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("recognizes only an explicit no-code signup return without provider errors", () => {
    assert.equal(isNoCodeSignupReturn(new URLSearchParams("type=signup")), true);
    assert.equal(isNoCodeSignupReturn(new URLSearchParams("type=signup&token_hash=secret")), true);
    assert.equal(isNoCodeSignupReturn(new URLSearchParams("type=signup&code=pkce")), false);
    assert.equal(isNoCodeSignupReturn(new URLSearchParams("type=signup&error=access_denied")), false);
    assert.equal(isNoCodeSignupReturn(new URLSearchParams("type=signup&error_code=otp_expired")), false);
    assert.equal(isNoCodeSignupReturn(new URLSearchParams("type=magiclink")), false);
    assert.equal(isNoCodeSignupReturn(new URLSearchParams("next=%2Finvite%2Fsafe")), false);
  });

  it("returns to sign-in on the same-origin safe destination without carrying auth material", () => {
    const confirmation = callbackLoginLocation("https://campus.example", "/invite/safe?from=mail", true);
    assert.equal(confirmation.origin, "https://campus.example");
    assert.equal(confirmation.pathname, "/login");
    assert.equal(confirmation.searchParams.get("next"), "/invite/safe?from=mail");
    assert.equal(confirmation.searchParams.get("notice"), "email-confirmation");
    for (const secret of ["code", "token_hash", "email", "type"]) assert.equal(confirmation.searchParams.has(secret), false);

    const malformed = callbackLoginLocation("https://campus.example", "https://attacker.example/path", false);
    assert.equal(malformed.searchParams.get("next"), "/dashboard");
    const error = malformed.searchParams.get("error") ?? "";
    assert.match(error, /If you just confirmed a new email address/);
    assert.match(error, /request a sign-in email below/);
    assert.match(error, /open it in the same browser/);
    for (const secret of ["code", "token_hash", "email", "type"]) assert.equal(malformed.searchParams.has(secret), false);
  });

  it("only exchanges a callback code, fails closed without one, and explains the no-code return", () => {
    const route = readFileSync(path.join(ROOT, "app/auth/callback/route.ts"), "utf8");
    assert.match(route, /if \(code && supabaseConfigured\)/);
    assert.match(route, /exchangeCodeForSession\(code\)/);
    assert.match(route, /isNoCodeSignupReturn\(searchParams\)/);
    assert.match(route, /callbackLoginLocation\(origin, next,/);
    assert.doesNotMatch(route, /verifyOtp\(|setSession\(|token_hash/);

    const login = readFileSync(path.join(ROOT, "app/login/page.tsx"), "utf8");
    assert.match(login, /query\.notice === "email-confirmation"/);
    assert.match(login, /may have completed/);
    assert.match(login, /did not sign you in/);
    assert.match(login, /request a sign-in email below/);
    assert.match(login, /name="next" value=\{next\}/);
    assert.match(login, /<form action=\{sendEmailCode\}/);

    const actions = readFileSync(path.join(ROOT, "app/login/actions.ts"), "utf8");
    assert.match(actions, /signInWithOtp\(/);
    assert.match(actions, /shouldCreateUser: true/);
    assert.match(actions, /emailRedirectTo:.*\/auth\/callback\?next=/);
  });
});
