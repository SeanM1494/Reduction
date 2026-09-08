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
 *
 * AND IT IS NOT FOR PRODUCTION AT ALL. `npm test` reads DATABASE_URL, which on
 * a deployed host is the live database — so the suite will refuse a non-local
 * one outright unless ALLOW_REMOTE_TEST_DB=1 is set. See assertWritable.
 */

import type { TestContext } from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

let reachable: boolean | null = null;

/**
 * A database this suite is allowed to write to.
 *
 * THIS EXISTS BECAUSE IT HAPPENED. `npm test` reads DATABASE_URL, and on a
 * deployed host that variable is production. Running the suite there pointed
 * every database-backed test at real data. Nothing was damaged — each suite
 * works inside its own random `test-owner-<uuid>` / `cache-test.invalid` /
 * random trial id and deletes only what it made — but that was luck holding,
 * not a guarantee, and one test of the day did leave a row behind.
 *
 * So the gate is now explicit rather than implicit. Local hosts pass. A
 * remote one has to be opted into with ALLOW_REMOTE_TEST_DB=1, which is a
 * thing you can only type on purpose.
 */
function looksLocal(raw: string): boolean {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    // An empty hostname is a Unix socket (postgres:///db), which is local by
    // construction.
    return (
      h === "" ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "[::1]" ||
      h.endsWith(".local")
    );
  } catch {
    // Not parseable as a URL. Refuse rather than guess: the failure mode of
    // guessing wrong here is writing to somebody's production database.
    return false;
  }
}

function assertWritable(raw: string): void {
  if (looksLocal(raw)) return;
  if (process.env.ALLOW_REMOTE_TEST_DB === "1") return;
  let where = "that host";
  try {
    where = new URL(raw).hostname;
  } catch {
    /* keep the generic phrasing */
  }
  throw new Error(
    `Refusing to run database tests against ${where}, which is not local.\n` +
      `These suites write and delete rows. They scope everything to their own ` +
      `random ids, but "scoped" is not the same as "safe against production", ` +
      `and this guard exists because the suite was once pointed at a live ` +
      `database by a DATABASE_URL that happened to be in the environment.\n` +
      `If you really mean it — a throwaway branch, a staging copy — set ` +
      `ALLOW_REMOTE_TEST_DB=1.`
  );
}

/**
 * Is there a database at all? Deliberately schema-independent: `select 1`
 * needs no table to exist, so this cannot be turned into a false "no
 * database" by a pending migration.
 */
export async function hasDatabase(): Promise<boolean> {
  if (reachable !== null) return reachable;
  const url = process.env.DATABASE_URL;
  if (!url) return (reachable = false);
  // Before connecting, not after: the point is to never touch it at all.
  // Throws rather than skipping, for the same reason requireTables does —
  // pointing the suite at production is a thing to go and fix, not a reason
  // to quietly prove nothing.
  assertWritable(url);
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
