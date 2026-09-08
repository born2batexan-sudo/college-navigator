// Zero-dependency SQLite client using Node 22's built-in node:sqlite.
//
// Why not Prisma/better-sqlite3: this app's build environment blocks
// fetching prebuilt native binaries from third-party hosts. node:sqlite
// ships inside Node itself, so there is nothing to download and nothing to
// compile. It's marked experimental by Node but is a thin, stable wrapper
// over SQLite's C API — fine for local dev and small deployments.
//
// For a real production deploy, swap this file (and schema.sql's dialect,
// which is already Postgres-compatible DDL) for a Postgres client such as
// `pg` or `@supabase/supabase-js`; lib/db/repo.ts is the only other file
// that touches SQL, so the migration is contained to these two files.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "lib", "db", "dev.sqlite3");
const SCHEMA_PATH = path.join(process.cwd(), "lib", "db", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __collegeNavDb: DatabaseSync | undefined;
}

function openDb(): DatabaseSync {
  const isNew = !existsSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema); // CREATE TABLE IF NOT EXISTS — safe to run every boot
  if (isNew) {
    console.log(`[db] created new SQLite database at ${DB_PATH}`);
  }
  return db;
}

// Reuse one connection across Next.js hot reloads / route invocations.
export const db: DatabaseSync = globalThis.__collegeNavDb ?? openDb();
if (process.env.NODE_ENV !== "production") {
  globalThis.__collegeNavDb = db;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
