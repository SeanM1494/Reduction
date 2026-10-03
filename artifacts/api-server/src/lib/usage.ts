/**
 * lib/usage.ts — GET /api/admin/usage: do people come back and cook, what
 * share of saved recipes get cooked through, and which view they cook in
 * (Oct 3, Sean's three questions).
 *
 * TOTALS ONLY. The first two answers are read from what the library already
 * keeps for the app to work — `recipes.cooked` (a timestamp per completed
 * cook-through), `done`, `mode`, `created_at` — counted across accounts and
 * returned as numbers; no account id, email or recipe leaves this file. The
 * third comes from the anonymous daily counters (lib/counters.ts
 * COOK_COUNTERS), which name nobody to begin with.
 *
 * A COOK IS A FLOOR. It is recorded only when every step is ticked, so
 * someone who cooks from the diagram without ticking never counts. The
 * report says so rather than letting a low number read as low use.
 *
 * Small numbers are not trends: a share is printed only when its
 * denominator reaches MIN_FOR_SHARE, and the count beside it always is.
 */

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { COOK_COUNTERS } from "./counters";

export const MIN_FOR_SHARE = 10;

export interface UsageReport {
  days: number;
  /** How many accounts were left out by id (the ids themselves never are). */
  excluded: number;
  comingBack: {
    /** Accounts created in the window: everything below is out of these. */
    signedUp: number;
    cookedOne: number;
    cookedTwoRecipes: number;
    cookedTwoDays: number;
    cookedAfterWeek: number;
  };
  cookedThrough: Array<{ kind: "link" | "other"; saved: number; started: number; cooked: number; lastViewSteps: number }>;
  /** The six cooking-view counters, summed over the window. */
  views: Record<(typeof COOK_COUNTERS)[number], number>;
}

const rows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

/**
 * `scope` limits the account half to the given ids; only the tests pass it,
 * so they can measure their own rows in a database other suites share.
 */
export async function readUsage(
  days: number,
  exclude: string[] = [],
  scope?: string[]
): Promise<UsageReport> {
  const db = getDb();
  // UTC days, the same window as the daily counters.
  const since = sql`(now() at time zone 'utc')::date - ${days - 1}::int`;
  const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const who = (col: SQL): SQL =>
    sql.join(
      [
        exclude.length ? sql`${col} not in (${list(exclude)})` : sql`true`,
        scope ? (scope.length ? sql`${col} in (${list(scope)})` : sql`false`) : sql`true`,
      ],
      sql` and `
    );

  const [back] = rows<Record<string, number>>(
    await db.execute(sql`
      with cohort as (
        select id, created_at from users
         where (created_at at time zone 'utc')::date >= ${since} and ${who(sql`id`)}
      ),
      cooks as (
        select r.user_id, r.id as recipe_id, c.created_at as joined,
               to_timestamp(e.value::double precision / 1000) as at
          from recipes r
          join cohort c on c.id = r.user_id
          cross join lateral jsonb_array_elements_text(r.cooked) e(value)
      )
      select
        (select count(*) from cohort)::int as "signedUp",
        (select count(distinct user_id) from cooks)::int as "cookedOne",
        (select count(*) from (select user_id from cooks group by user_id
           having count(distinct recipe_id) >= 2) x)::int as "cookedTwoRecipes",
        (select count(*) from (select user_id from cooks group by user_id
           having count(distinct (at at time zone 'utc')::date) >= 2) x)::int as "cookedTwoDays",
        (select count(distinct user_id) from cooks
          where at >= joined + interval '7 days')::int as "cookedAfterWeek"`)
  );

  const through = rows<{ kind: "link" | "other"; saved: number; started: number; cooked: number; lastViewSteps: number }>(
    await db.execute(sql`
      select case when coalesce(recipe->>'sourceUrl', '') <> '' then 'link' else 'other' end as kind,
             count(*)::int as saved,
             count(*) filter (where jsonb_array_length(done) > 0 or jsonb_array_length(cooked) > 0)::int as started,
             count(*) filter (where jsonb_array_length(cooked) > 0)::int as cooked,
             count(*) filter (where mode = 'steps')::int as "lastViewSteps"
        from recipes
       where user_id is not null
         and (created_at at time zone 'utc')::date >= ${since}
         and ${who(sql`user_id`)}
       group by 1 order by 1`)
  );

  const counted = rows<{ name: string; total: number }>(
    await db.execute(sql`
      select name, sum(count)::int as total from daily_counters
       where day >= ${since} and name in (${list([...COOK_COUNTERS])})
       group by name`)
  );
  const views = Object.fromEntries(COOK_COUNTERS.map((n) => [n, 0])) as UsageReport["views"];
  for (const r of counted) views[r.name as keyof typeof views] = Number(r.total);

  const num = (v: unknown) => Number(v ?? 0);
  return {
    days,
    excluded: exclude.length,
    comingBack: {
      signedUp: num(back?.signedUp),
      cookedOne: num(back?.cookedOne),
      cookedTwoRecipes: num(back?.cookedTwoRecipes),
      cookedTwoDays: num(back?.cookedTwoDays),
      cookedAfterWeek: num(back?.cookedAfterWeek),
    },
    cookedThrough: through.map((r) => ({
      kind: r.kind,
      saved: num(r.saved),
      started: num(r.started),
      cooked: num(r.cooked),
      lastViewSteps: num(r.lastViewSteps),
    })),
    views,
  };
}

/** "44%", or "—" when the denominator is too small to mean anything. */
export function share(part: number, whole: number): string {
  if (whole < MIN_FOR_SHARE) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const row = (label: string, ...cells: Array<string | number>) =>
  "  " + label.padEnd(36) + cells.map((c) => pad(c, 9)).join("");

/** The readable version (`format=text`), for a terminal. Pure. */
export function formatUsageText(r: UsageReport): string {
  const b = r.comingBack;
  const all = r.cookedThrough.reduce(
    (a, x) => ({ saved: a.saved + x.saved, started: a.started + x.started, cooked: a.cooked + x.cooked, steps: a.steps + x.lastViewSteps }),
    { saved: 0, started: 0, cooked: 0, steps: 0 }
  );
  const kind = (k: "link" | "other") => r.cookedThrough.find((x) => x.kind === k) ?? { saved: 0, started: 0, cooked: 0, lastViewSteps: 0 };
  const v = r.views;
  const ticks = v.ticked_diagram + v.ticked_steps;
  const finishes = v.finished_diagram + v.finished_steps;
  const lines = [
    `Usage, last ${r.days} days${r.excluded ? ` (leaving out ${r.excluded} account${r.excluded === 1 ? "" : "s"})` : ""}`,
    `A cook counts only when every step was ticked, so these are floors. A share shows once it is out of ${MIN_FOR_SHARE} or more.`,
    "",
    "COMING BACK (accounts that signed up in this window)",
    row("signed up", b.signedUp),
    row("cooked at least 1 recipe", b.cookedOne, share(b.cookedOne, b.signedUp)),
    row("cooked 2+ different recipes", b.cookedTwoRecipes, share(b.cookedTwoRecipes, b.signedUp)),
    row("cooked on 2+ different days", b.cookedTwoDays, share(b.cookedTwoDays, b.signedUp)),
    row("cooked 7+ days after signing up", b.cookedAfterWeek, share(b.cookedAfterWeek, b.signedUp)),
    "",
    "COOKED THROUGH (recipes saved in this window)",
    row("", "saved", "started", "cooked", ""),
    row("from a link (starters too)", kind("link").saved, kind("link").started, kind("link").cooked, share(kind("link").cooked, kind("link").saved)),
    row("pasted or photographed", kind("other").saved, kind("other").started, kind("other").cooked, share(kind("other").cooked, kind("other").saved)),
    row("all", all.saved, all.started, all.cooked, share(all.cooked, all.saved)),
    "",
    "DIAGRAM OR STEP-BY-STEP",
    row("", "diagram", "steps"),
    row("last view left in (recipes above)", share(all.saved - all.steps, all.saved), share(all.steps, all.saved)),
    `  from the app's daily counts: ${v.recipe_opened} recipe visits`,
    row("visits that opened Step-by-Step", "", share(v.view_steps, v.recipe_opened)),
    row(`visits with a tick (${ticks})`, share(v.ticked_diagram, ticks), share(v.ticked_steps, ticks)),
    row(`cooks finished in (${finishes})`, share(v.finished_diagram, finishes), share(v.finished_steps, finishes)),
    "",
  ];
  return lines.join("\n");
}
