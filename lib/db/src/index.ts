/**
 * @workspace/db — the Drizzle schema, and a lazy connection for anything
 * that wants one.
 *
 * NOTHING HAPPENS AT IMPORT TIME. The scaffold this replaced read
 * DATABASE_URL at module load and threw when it was unset, which meant that
 * every file importing a TABLE (the api-server's routes, its libraries, and
 * every one of their test suites) could not even be loaded on a machine
 * with no database. That silently broke the "n pass, 78 skipped" outcome
 * CLAUDE.md promises for a database-less checkout: the suites failed at
 * import instead of skipping, and nobody noticed because the workspace
 * always has DATABASE_URL set. The api-server keeps its own lazy client in
 * src/db.ts for the same reason; this one exists so the package is still
 * usable on its own (scripts, a future worker) without duplicating that.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** The pool, created on first call. Throws — with a message that says what
 *  to do — only when something actually needs the database. */
export function getPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  }
  pool = new Pool({ connectionString: url });
  return pool;
}

/** The Drizzle client over that pool, created on first call. */
export function getDb() {
  if (db) return db;
  db = drizzle(getPool(), { schema });
  return db;
}

export * from "./schema";
