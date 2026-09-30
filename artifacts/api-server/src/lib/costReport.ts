/**
 * lib/costReport.ts — what extraction is costing, for GET /api/admin/costs.
 *
 * Read from extraction_events: one row per extraction attempt or cache hit,
 * with an ESTIMATED cost at list price since Sep 30 (lib/extractionCost.ts).
 * Every figure here is that estimate; the Anthropic Console's invoice is
 * the truth, and rows written before the columns existed carry no cost at
 * all (`unpriced` counts them, so a low total is never mistaken for a cheap
 * week).
 *
 * Accounts appear as ids only — never an email — and signed-out trials,
 * which have no id, are a total rather than a row.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";

export const TOP_ACCOUNTS = 20;

export interface SourceTotals {
  fresh: number;
  cached: number;
  estCostUsd: number;
}

export interface AccountSpend {
  userId: string;
  fresh: number;
  estCostUsd: number;
}

export interface WindowReport {
  days: number;
  /** Fresh = a model call was made (cache misses), ok or not. */
  fresh: number;
  freshFailed: number;
  cached: number;
  estCostUsd: number;
  /** Per fresh extraction that has a cost: what one typically costs. */
  perFresh: { mean: number | null; median: number | null; p90: number | null };
  /** Fresh rows with no cost recorded (written before Sep 30, or failed
   *  before any model call answered). */
  unpriced: number;
  signedOut: { fresh: number; estCostUsd: number };
  bySource: Record<string, SourceTotals>;
  topByFresh: AccountSpend[];
  topBySpend: AccountSpend[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 1_000_000) / 1_000_000);
const usd = (v: unknown): number => Math.round(num(v) * 1_000_000) / 1_000_000;

type Rows = { rows: Record<string, unknown>[] };

export async function windowReport(days: number): Promise<WindowReport> {
  const db = getDb();
  const since = sql`now() - make_interval(days => ${days})`;
  const totals = ((await db.execute(sql`
    select
      count(*) filter (where not cached) as fresh,
      count(*) filter (where not cached and not ok) as fresh_failed,
      count(*) filter (where cached) as cached,
      coalesce(sum(est_cost_usd), 0) as cost,
      avg(est_cost_usd) filter (where not cached and est_cost_usd is not null) as mean,
      percentile_cont(0.5) within group (order by est_cost_usd) filter (where not cached and est_cost_usd is not null) as median,
      percentile_cont(0.9) within group (order by est_cost_usd) filter (where not cached and est_cost_usd is not null) as p90,
      count(*) filter (where not cached and est_cost_usd is null) as unpriced,
      count(*) filter (where not cached and user_id is null) as signed_out_fresh,
      coalesce(sum(est_cost_usd) filter (where user_id is null), 0) as signed_out_cost
    from extraction_events where at >= ${since}`)) as unknown as Rows).rows[0];

  const sources = ((await db.execute(sql`
    select source,
      count(*) filter (where not cached) as fresh,
      count(*) filter (where cached) as cached,
      coalesce(sum(est_cost_usd), 0) as cost
    from extraction_events where at >= ${since}
    group by source order by source`)) as unknown as Rows).rows;

  const top = async (order: "fresh" | "cost") =>
    ((await db.execute(sql`
      select user_id,
        count(*) filter (where not cached) as fresh,
        coalesce(sum(est_cost_usd), 0) as cost
      from extraction_events
      where at >= ${since} and user_id is not null
      group by user_id
      having count(*) filter (where not cached) > 0
      order by ${order === "fresh" ? sql`fresh desc, cost desc` : sql`cost desc, fresh desc`}, user_id
      limit ${TOP_ACCOUNTS}`)) as unknown as Rows).rows.map((r) => ({
      userId: String(r.user_id),
      fresh: num(r.fresh),
      estCostUsd: usd(r.cost),
    }));

  return {
    days,
    fresh: num(totals.fresh),
    freshFailed: num(totals.fresh_failed),
    cached: num(totals.cached),
    estCostUsd: usd(totals.cost),
    perFresh: { mean: numOrNull(totals.mean), median: numOrNull(totals.median), p90: numOrNull(totals.p90) },
    unpriced: num(totals.unpriced),
    signedOut: { fresh: num(totals.signed_out_fresh), estCostUsd: usd(totals.signed_out_cost) },
    bySource: Object.fromEntries(
      sources.map((r) => [String(r.source), { fresh: num(r.fresh), cached: num(r.cached), estCostUsd: usd(r.cost) }])
    ),
    topByFresh: await top("fresh"),
    topBySpend: await top("cost"),
  };
}
