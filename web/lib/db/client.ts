// Dual Postgres/SQLite database client. Production uses Postgres; SQLite is
// deliberately retained for local development and deterministic unit tests.
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
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
type TxContext = { pg?: PoolClient; sqlite?: DatabaseSync };
const transactionContext = new AsyncLocalStorage<TxContext>();

function openSqlite(): DatabaseSync {
  const isNew = !existsSync(/* turbopackIgnore: true */ DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  if (isNew) console.log(`[db] created new SQLite database at ${DB_PATH}`);
  return db;
}
function getSqlite(): DatabaseSync {
  if (!globalThis.__cnSqliteDb) globalThis.__cnSqliteDb = openSqlite();
  return globalThis.__cnSqliteDb;
}
function toSqlitePlaceholders(sql: string): string { return sql.replace(/\$\d+/g, "?"); }
const sqliteStmtCache = new Map<string, StatementSync>();
function sqliteStatement(sql: string, db = getSqlite()): StatementSync {
  const converted = toSqlitePlaceholders(sql);
  // There is one process-global SQLite handle. Caching is safe and avoids
  // invalid statement reuse across transaction handles.
  let stmt = sqliteStmtCache.get(converted);
  if (!stmt) { stmt = db.prepare(converted); sqliteStmtCache.set(converted, stmt); }
  return stmt;
}
function getPgPool(): Pool {
  if (!globalThis.__cnPgPool) {
    const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL!);
    globalThis.__cnPgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: isLocal ? false : { rejectUnauthorized: true },
      max: 3,
    });
  }
  return globalThis.__cnPgPool;
}

export async function queryRows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const ctx = transactionContext.getStore();
  if (DATABASE_URL) return ((ctx?.pg ? await ctx.pg.query(sql, params) : await getPgPool().query(sql, params)).rows as T[]);
  return sqliteStatement(sql, ctx?.sqlite).all(...params) as T[];
}
export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await queryRows<T>(sql, params);
  return rows[0] ?? null;
}
export async function exec(sql: string, params: any[] = []): Promise<void> {
  const ctx = transactionContext.getStore();
  if (DATABASE_URL) {
    if (ctx?.pg) await ctx.pg.query(sql, params); else await getPgPool().query(sql, params);
    return;
  }
  sqliteStatement(sql, ctx?.sqlite).run(...params);
}

/** All repository calls inside fn share one real database transaction. */
let sqliteTransactionTail: Promise<void> = Promise.resolve();

export async function withTransaction<T>(fn: () => Promise<T>, mode: "deferred" | "immediate" = "immediate"): Promise<T> {
  if (transactionContext.getStore()) return fn();
  if (DATABASE_URL) {
    const client = await getPgPool().connect();
    try {
      await client.query("BEGIN");
      const value = await transactionContext.run({ pg: client }, fn);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  // DatabaseSync has one connection; serialize top-level async transactions
  // so test/dev concurrency has the same atomic semantics as Postgres.
  let release!: () => void;
  const prior = sqliteTransactionTail;
  sqliteTransactionTail = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  const db = getSqlite();
  db.exec(mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const value = await transactionContext.run({ sqlite: db }, fn);
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { release(); }
}

export function newId(prefix: string): string { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }
export function nowIso(): string { return new Date().toISOString(); }
