/**
 * server/lib/testdb.ts — the one gate the database-backed suites skip behind.
 *
 * WHY THIS IS SHARED, AND WHY IT PROBES `select 1`
 *
 * Both suites used to carry their own copy of this, and each probed by
 * selecting from the table it was about to test — claim.db.test.ts from
 * `recipes`, trial.db.test.ts from `trials`. That looks equivalent and is not.
 * The probe answers "can I query this table?", but the answer was reported as
 * "is there a database?", and those come apart in exactly one case: a
 * reachable database whose schema is out of date.
 *
 * That case happened. `trials` was added to shared/schema.ts and `db:push`
 * had not been run, so the probe threw `relation "trials" does not exist`,
 * the catch swallowed it, and all nine trial-claim tests reported themselves
 * skipped for "no reachable DATABASE_URL" — in the same run where the library
 * claim's tests passed against the same database in the same process. The
 * suite was green and the trial claim was untested, which is the worst
 * possible combination for the second place in this codebase where a bug
 * loses someone's data.
 *
 * So the two questions are now asked separately:
 *
 *   - `select 1` answers "is there a database", and nothing else. It touches
 *     no table, so no schema change can ever make it lie.
 *   - `requireTables` answers "is its schema current", and a missing table is
 *     a THROWN ERROR, never a skip. A stale schema is a thing to go and fix,
 *     not a reason to quietly prove nothing.
 *
 * Skipping is for the machine that has no Postgres. It is not for the machine
 * that has one and forgot to migrate it.
 */

import type { TestContext } from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

let reachable: boolean | null = null;

/**
 * Is there a database at all? Deliberately schema-independent: `select 1`
 * needs no table to exist, so this cannot be turned into a false "no
 * database" by a pending migration.
 */
export async function hasDatabase(): Promise<boolean> {
  if (reachable !== null) return reachable;
  if (!process.env.DATABASE_URL) return (reachable = false);
  try {
    await getDb().execute(sql`select 1`);
    return (reachable = true);
  } catch {
    return (reachable = false);
  }
}

/**
 * Asserts the tables a suite needs are actually there.
 *
 * Throws rather than skips. If there is a database but it is missing a table
 * the suite is about to exercise, the schema is behind the code and the run
 * must say so loudly — that is a `npm run db:push` away from fixed, and
 * silence is what let it ship.
 */
export async function requireTables(...names: string[]): Promise<void> {
  const db = getDb();
  const found = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_name in (${sql.join(
          names.map((n) => sql`${n}`),
          sql`, `
        )})`
  );
  const present = new Set(found.rows.map((r) => r.table_name));
  const missing = names.filter((n) => !present.has(n));
  if (missing.length) {
    throw new Error(
      `Database is reachable but missing table(s): ${missing.join(", ")}. ` +
        `The schema in shared/schema.ts is ahead of this database — run ` +
        `\`npm run db:push\`. (Refusing to skip: these tests guard against ` +
        `data loss, and a skip here would report "no database" for what is ` +
        `really a stale one.)`
    );
  }
}

/**
 * The gate each test calls. Returns false (and marks the test skipped) only
 * when there is genuinely no database to talk to. If there is one, a missing
 * table throws out of here rather than skipping.
 */
export async function needsDatabase(
  t: TestContext,
  ...tables: string[]
): Promise<boolean> {
  if (!(await hasDatabase())) {
    t.skip("no reachable DATABASE_URL");
    return false;
  }
  await requireTables(...tables);
  return true;
}
