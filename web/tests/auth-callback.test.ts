import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { callbackLoginLocation, isNoCodeSignupReturn } from "../lib/auth/callback";

const ROOT = process.cwd();

describe("email authentication callback", () => {
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
