/**
 * lib/counters.ts — anonymous daily counts of how often parts of the app are
 * used (Sep 30, launch readiness item 3b).
 *
 * ONE ROW PER (DAY, NAME), AND NOTHING ELSE. No user id, no device, no
 * request: a count that says "12 saves on Oct 3" and cannot say whose. That
 * is what privacy.html promises ("totals ... not linked to your account or
 * device"), so a column that identified anyone would break the policy, not
 * extend the table. Days are UTC.
 *
 * WHAT MAY BE COUNTED is a closed list. The server counts its own events
 * (a new save, a wall hit, a coupon redeemed); the app may report only the
 * names in `CLIENT_COUNTERS` (the reel's, and since Oct 3 the cooking view's),
 * through POST /api/counters. Extractions are
 * NOT counted here: extraction_events already records every one by route,
 * and a second count of the same thing would only drift from it — the admin
 * read joins the two.
 *
 * IT MUST NEVER FAIL A REQUEST. Every increment is fire-and-forget and
 * swallows its error; a missing table (hand-run DDL, README "Usage
 * counters") warns once per process and counts nothing.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";

/** Counted by the server itself. */
export const SERVER_COUNTERS = [
  "save",
  "wall_hit.subscription_required",
  "wall_hit.trial_spent",
  "coupon_redeemed",
] as const;

/**
 * The cooking view's events (Oct 3): which view people cook in. Each is
 * reported at most once per visit to a saved recipe, except a finish, which
 * is once per cook — so a total is "visits that did X", never taps.
 */
export const COOK_COUNTERS = [
  "recipe_opened",
  "view_steps",
  "ticked_diagram",
  "ticked_steps",
  "finished_diagram",
  "finished_steps",
] as const;

/** The only names the app may report. */
export const CLIENT_COUNTERS = [
  "reel_shown",
  "reel_tap_data",
  "reel_tap_curated",
  "reel_saved_data",
  "reel_saved_curated",
  ...COOK_COUNTERS,
] as const;

export type CounterName = (typeof SERVER_COUNTERS)[number] | (typeof CLIENT_COUNTERS)[number];

export const isClientCounter = (name: unknown): name is (typeof CLIENT_COUNTERS)[number] =>
  typeof name === "string" && (CLIENT_COUNTERS as readonly string[]).includes(name);

let warned = false;

/**
 * Adds one to today's count. Returns the write's promise so a test can wait
 * for it; every request path calls it with `void` and never waits.
 */
export async function countEvent(name: CounterName): Promise<void> {
  try {
    await getDb().execute(sql`
      insert into daily_counters (day, name, count)
      values ((now() at time zone 'utc')::date, ${name}, 1)
      on conflict (day, name) do update set count = daily_counters.count + 1`);
  } catch (e) {
    if (!warned) {
      warned = true;
      // The driver's own sentence ("relation ... does not exist"), not the
      // wrapper's, which repeats the whole query.
      const err = e as Error & { cause?: Error };
      console.warn('[counters] not counting (README "Usage counters"):', (err.cause ?? err).message);
    }
  }
}

export interface CounterDay {
  day: string;
  counts: Record<string, number>;
}

/** The last `days` days of counts, newest first, and extractions per day by
 *  route from extraction_events (fresh and cached separately). */
export async function readCounters(days: number): Promise<{ days: number; counters: CounterDay[]; extractions: CounterDay[] }> {
  const db = getDb();
  const since = sql`(now() at time zone 'utc')::date - ${days - 1}::int`;
  const rows = ((await db.execute(sql`
    select day::text as day, name, count from daily_counters
     where day >= ${since} order by day desc, name`)) as unknown as { rows: Array<{ day: string; name: string; count: number }> }).rows;
  const ex = ((await db.execute(sql`
    select (at at time zone 'utc')::date::text as day,
           source || case when cached then '.cached' else '.fresh' end as name,
           count(*)::int as count
      from extraction_events
     where (at at time zone 'utc')::date >= ${since}
     group by 1, 2 order by 1 desc, 2`)) as unknown as { rows: Array<{ day: string; name: string; count: number }> }).rows;
  const fold = (list: Array<{ day: string; name: string; count: number }>): CounterDay[] => {
    const byDay = new Map<string, Record<string, number>>();
    for (const r of list) byDay.set(r.day, { ...(byDay.get(r.day) ?? {}), [r.name]: Number(r.count) });
    return [...byDay].map(([day, counts]) => ({ day, counts }));
  };
  return { days, counters: fold(rows), extractions: fold(ex) };
}
