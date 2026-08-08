/**
 * server/db.ts — Postgres connection + Drizzle client.
 *
 * Fails loudly (with a clear message) the first time something tries to use
 * the database if DATABASE_URL is missing, but never crashes at import time
 * — that would take down routes that don't need the database (health check,
 * etc.) just because of a config problem elsewhere.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function init() {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision a Postgres database and restart."
    );
  }
  pool = new Pool({ connectionString: url });
  db = drizzle(pool, { schema });
  return db;
}

/** Lazily-initialized Drizzle client. Import and call methods on `.db`. */
export const getDb = () => init();
