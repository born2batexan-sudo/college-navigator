import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("browser security headers", () => {
  it("ships a restrictive content security policy on every route", async () => {
    const source = await readFile(new URL("../next.config.js", import.meta.url), "utf8");

    assert.match(source, /poweredByHeader:\s*false/);
    assert.match(source, /Content-Security-Policy/);
    assert.match(source, /default-src 'self'/);
    assert.match(source, /object-src 'none'/);
    assert.match(source, /frame-ancestors 'none'/);
    assert.match(source, /form-action 'self'/);
    assert.match(source, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/);
    assert.match(source, /upgrade-insecure-requests/);
  });
});
