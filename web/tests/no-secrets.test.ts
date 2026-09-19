// Fails if a real-looking secret is typed into source code, which is how a
// production key ended up in a public repo once. Run with: npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(process.cwd(), "..");
const SKIP = new Set(["node_modules", ".next", ".git", "data", "__pycache__", "tests"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|py|yml|yaml|json|sql)$/.test(name) && !/package(-lock)?\.json$/.test(name)) out.push(p);
  }
  return out;
}

// name that sounds secret, then a quoted 24+ character token-looking value
const ASSIGNMENT = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Za-z_]*["']?\s*[:=]\s*\n?\s*["'`]([A-Za-z0-9_\-+/=.]{24,})["'`]/i;
const KNOWN_PREFIXES = /\b(sk-ant-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|sbp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.)/;

describe("no secrets in source", () => {
  it("finds no hard-coded keys, tokens or passwords", () => {
    const hits: string[] = [];
    for (const dir of ["web", "agents", ".github"]) {
      let files: string[] = [];
      try {
        files = walk(path.join(REPO, dir));
      } catch {
        continue;
      }
      for (const f of files) {
        const src = readFileSync(f, "utf-8");
        const rel = path.relative(REPO, f).split(path.sep).join("/");
        if (ASSIGNMENT.test(src) || KNOWN_PREFIXES.test(src)) hits.push(rel);
      }
    }
    assert.deepEqual(hits, [], `possible secrets typed into: ${hits.join(", ")}`);
  });
});
