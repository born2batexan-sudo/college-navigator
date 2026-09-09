// Dual-backend database client.
//
// - No DATABASE_URL set -> Node 22's built-in node:sqlite, zero external
//   dependencies. This is the "clone and run" local-dev path: no accounts,
//   no network, works the moment you run `npm run db:seed`.
// - DATABASE_URL set -> real Postgres via `pg` (e.g. a Supabase project).
//   This is what a real deployment (Vercel, or anywhere else) should use —
//   serverless platforms don't give you a persistent local disk to put a
//   SQLite file on, so production always needs a real database server.
//
// lib/db/repo.ts is the only other file that touches SQL, and it's written
// once, in Postgres-style `$1, $2, ...` placeholders — this file adapts
// that same SQL to SQLite's `?` placeholders internally when running
// without a DATABASE_URL, so nothing above this file needs to know which
// backend is active.
//
// IMPORTANT: this file does NOT run schema.sql against Postgres. Applying
// the schema to a Supabase project is a one-time step you run yourself in
// Supabase's own SQL Editor (see README.md) — a server-side function
// re-running DDL on every cold start is unnecessary overhead and requires
// schema-modifying permissions on every request, not just once.

import { Pool } from "pg";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "lib", "db", "dev.sqlite3");
const SCHEMA_PATH = path.join(process.cwd(), "lib", "db", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __cnPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __cnSqliteDb: DatabaseSync | undefined;
}

export const usingPostgres = !!DATABASE_URL;

// ---------- SQLite backend (local dev, zero setup) ----------

function openSqlite(): DatabaseSync {
  const isNew = !existsSync(DB_PATH);
  const sqliteDb = new DatabaseSync(DB_PATH);
  sqliteDb.exec("PRAGMA foreign_keys = ON;");
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  sqliteDb.exec(schema); // CREATE TABLE IF NOT EXISTS — safe to run every boot
  if (isNew) {
    console.log(`[db] created new SQLite database at ${DB_PATH} (no DATABASE_URL set — using local SQLite)`);
  }
  return sqliteDb;
}

function getSqlite(): DatabaseSync {
  if (!globalThis.__cnSqliteDb) {
    globalThis.__cnSqliteDb = openSqlite();
  }
  return globalThis.__cnSqliteDb;
}

// repo.ts is written in Postgres-style "$1, $2, ..." positional
// placeholders throughout; node:sqlite (like better-sqlite3) uses
// positional "?" instead. Since both are strictly positional and in the
// same left-to-right order as the params array, a straight regex swap is
// sufficient — no reordering needed.
function toSqlitePlaceholders(sql: string): string {
  return sql.replace(/\$\d+/g, "?");
}

const sqliteStmtCache = new Map<string, StatementSync>();
function sqliteStatement(sql: string): StatementSync {
  const converted = toSqlitePlaceholders(sql);
  let stmt = sqliteStmtCache.get(converted);
  if (!stmt) {
    stmt = getSqlite().prepare(converted);
    sqliteStmtCache.set(converted, stmt);
  }
  return stmt;
}

// ---------- Postgres backend (production) ----------

function getPgPool(): Pool {
  if (!globalThis.__cnPgPool) {
    // Supabase (and most managed Postgres) terminate TLS with a
    // certificate that Node's default trust store doesn't chain to;
    // rejectUnauthorized: false keeps the connection encrypted without
    // requiring you to vendor their CA bundle. Fine for this app's threat
    // model (no on-path attacker within Vercel's / Supabase's own network).
    const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL!);
    globalThis.__cnPgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 3, // small pool — serverless functions run many short-lived instances, not one long-lived process
    });
  }
  return globalThis.__cnPgPool;
}

// ---------- Unified query surface used by repo.ts ----------

export async function queryRows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (DATABASE_URL) {
    const result = await getPgPool().query(sql, params);
    return result.rows as T[];
  }
  return sqliteStatement(sql).all(...params) as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  if (DATABASE_URL) {
    const result = await getPgPool().query(sql, params);
    return (result.rows[0] as T) ?? null;
  }
  const row = sqliteStatement(sql).get(...params);
  return (row as T) ?? null;
}

export async function exec(sql: string, params: any[] = []): Promise<void> {
  if (DATABASE_URL) {
    await getPgPool().query(sql, params);
    return;
  }
  sqliteStatement(sql).run(...params);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
