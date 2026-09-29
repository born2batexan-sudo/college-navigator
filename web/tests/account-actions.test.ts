import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("account server actions", () => {
  it("does not catch a successful add-student redirect as a domain error", () => {
    const source = readFileSync(path.join(process.cwd(), "app/account/actions.ts"), "utf8");
    const start = source.indexOf("export async function addStudent");
    const end = source.indexOf("export async function makeInvite", start);
    const action = source.slice(start, end);
    const catchEnd = action.indexOf("\n  }\n", action.indexOf("catch (error)"));
    const successRedirect = action.indexOf("redirect(`/welcome?student=");
    assert.ok(catchEnd > 0 && successRedirect > catchEnd, "success redirect must remain outside the catch block");
    assert.ok(!action.slice(action.indexOf("try {"), catchEnd).includes("redirect(`/welcome?student="));
  });
});
