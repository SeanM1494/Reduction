/**
 * lib/schemaCheck.ts — is the database the code expects actually there?
 *
 * Production schema changes are hand-run DDL (CLAUDE.md), so for every one
 * of them there is a window where the deployed code is ahead of the
 * database. Twice that window has looked like something else entirely:
 * `recipe_photos` missing read as "photos never appear", with nothing in
 * any response to say why; and `recipes.removed_at` missing would fail
 * EVERY recipes query, because drizzle's `select()` names each schema
 * column — an empty shelf over a library that is perfectly intact.
 *
 * So the hand-run DDL is registered here, once, and `/api/health` reports
 * whatever is absent. Checking it is one request from anywhere; the fix is
 * the DDL in the README section each entry names.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";

export interface Required {
  table: string;
  /** Omitted: the table itself must exist. */
  column?: string;
  /** Where the DDL lives, for the operator reading the report. */
  readme: string;
}

/** Every piece of hand-run DDL the code depends on. Add to it with the DDL. */
export const REQUIRED_SCHEMA: readonly Required[] = [
  { table: "recipe_photos", readme: 'README "Recipe photos"' },
  { table: "recipes", column: "removed_at", readme: 'README "The recipe box"' },
];

export interface SchemaReport {
  ok: boolean;
  missing: string[];
}

export async function checkSchema(required: readonly Required[] = REQUIRED_SCHEMA): Promise<SchemaReport> {
  const db = getDb();
  const missing: string[] = [];
  for (const r of required) {
    const found = r.column
      ? await db.execute(
          sql`select 1 from information_schema.columns
               where table_schema = current_schema() and table_name = ${r.table} and column_name = ${r.column}`
        )
      : await db.execute(
          sql`select 1 from information_schema.tables
               where table_schema = current_schema() and table_name = ${r.table}`
        );
    if (!found.rows.length) missing.push(`${r.column ? `${r.table}.${r.column}` : r.table} (${r.readme})`);
  }
  return { ok: missing.length === 0, missing };
}

// Health is polled; the schema changes only when someone runs DDL.
const TTL_MS = 60_000;
let cached: { at: number; report: SchemaReport } | null = null;

/** For /api/health: cached for a minute, and never throws — a database
 *  that cannot be asked is reported as unknown, not as a crashed route. */
export async function schemaForHealth(): Promise<SchemaReport | { ok: null; error: string }> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.report;
  try {
    const report = await checkSchema();
    cached = { at: Date.now(), report };
    return report;
  } catch (e) {
    return { ok: null, error: (e as Error).message.split("\n")[0] };
  }
}

/** At boot: say it loudly, once, in the log an operator actually reads. */
export async function logSchemaAtBoot(): Promise<void> {
  const r = await schemaForHealth();
  if (r.ok === false) {
    console.error(`[schema] the database is BEHIND this code. Missing: ${r.missing.join("; ")}. Run the DDL named — the code will fail until you do.`);
  } else if (r.ok === null) {
    console.error(`[schema] could not check the schema: ${(r as { error: string }).error}`);
  }
}
