/**
 * lib/costBrake.ts — the DAILY brakes on paid model calls (Oct 3).
 *
 * The hourly throttle in routes/recipes.ts (`overLimit`) is per client and per
 * instance, in memory, and fails open across instances — the right shape for
 * a brake on bursts, and no ceiling at all on a day: Autoscale runs several
 * instances, a signed-out trial is a cookie anyone can mint by not sending
 * one, and with the wall off a signed-in account has no allowance that bites.
 * So nothing bounded what one day could cost. These three do:
 *
 *   EXTRACTION_DAILY_BUDGET_USD  everyone's estimated spend today (UTC), the
 *                                circuit breaker; applies to search as well
 *   SIGNED_OUT_DAILY_EXTRACTIONS fresh extractions with no account, all of
 *                                them together — trials are free to re-mint,
 *                                so a per-trial count would bound nothing
 *   ACCOUNT_DAILY_EXTRACTIONS    fresh extractions by one account
 *
 * Each is a number, or `off`. Unset means the default below.
 *
 * READ FROM extraction_events, NEVER FROM PROCESS MEMORY. A request on one
 * instance has to see what another instance spent, which is the CLAUDE.md
 * rule about anything spanning two requests. The table already carries the
 * cost (est_cost_usd, list price, an estimate) and the account, indexed by
 * `at` and by (user_id, at). Only FRESH rows count — a cache hit cost
 * nothing — and a failed fresh row counts, because it spent tokens.
 *
 * FAILS OPEN on a database error, with one line in the log: an extraction
 * whose brake cannot be read is no worse than before this file existed, and
 * a database that is down fails the extraction anyway.
 *
 * THE ALARM is a log line, once per instance per UTC day, as the spend passes
 * half and then 80% of the budget. Replit's logs are the only sink this
 * server has; the real alarm is the spend limit and email notification on
 * the Anthropic Console workspace, which no bug here can switch off.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";

export interface BrakeLimits {
  budgetUsd: number | null;
  signedOutPerDay: number | null;
  accountPerDay: number | null;
}

export const DEFAULT_LIMITS: BrakeLimits = {
  budgetUsd: 100,
  signedOutPerDay: 150,
  accountPerDay: 40,
};

/** A positive number, `off` for no limit, or the default for anything else
 *  (a typo must never mean "unlimited"). */
function limitFrom(raw: string | undefined, fallback: number | null): number | null {
  const s = raw?.trim().toLowerCase();
  if (!s) return fallback;
  if (s === "off") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function brakeLimits(env: NodeJS.ProcessEnv = process.env): BrakeLimits {
  return {
    budgetUsd: limitFrom(env.EXTRACTION_DAILY_BUDGET_USD, DEFAULT_LIMITS.budgetUsd),
    signedOutPerDay: limitFrom(env.SIGNED_OUT_DAILY_EXTRACTIONS, DEFAULT_LIMITS.signedOutPerDay),
    accountPerDay: limitFrom(env.ACCOUNT_DAILY_EXTRACTIONS, DEFAULT_LIMITS.accountPerDay),
  };
}

export interface TodaysUse {
  /** Estimated dollars spent today, everyone, fresh rows. */
  usd: number;
  /** Fresh extractions today with no account. */
  signedOutFresh: number;
  /** Fresh extractions today by this account; 0 when signed out. */
  accountFresh: number;
}

export type BrakeKind = "extract" | "search";

export interface Refusal {
  status: number;
  body: { error: string; code: string };
}

/** PURE: whether today's use refuses this call. Search is held only by the
 *  budget — the two counts are of extractions. */
export function brakeDecision(
  limits: BrakeLimits,
  today: TodaysUse,
  userId: string | null,
  kind: BrakeKind
): Refusal | null {
  if (limits.budgetUsd !== null && today.usd >= limits.budgetUsd)
    return {
      status: 503,
      body: {
        error: "Reading new recipes is paused for the rest of today. Recipes you have saved still work.",
        code: "daily_budget",
      },
    };
  if (kind === "search") return null;
  if (userId) {
    if (limits.accountPerDay !== null && today.accountFresh >= limits.accountPerDay)
      return {
        status: 429,
        body: { error: "You have read a lot of recipes today. Try again tomorrow.", code: "account_daily_limit" },
      };
    return null;
  }
  if (limits.signedOutPerDay !== null && today.signedOutFresh >= limits.signedOutPerDay)
    return {
      status: 429,
      body: { error: "Free tries are used up for today. Sign in to keep going.", code: "signed_out_daily_limit" },
    };
  return null;
}

/** Midnight UTC at the start of `now`'s day. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function todaysUse(userId: string | null, now: Date = new Date()): Promise<TodaysUse> {
  const since = startOfUtcDay(now);
  const result = await getDb().execute(sql`
    select
      coalesce(sum(est_cost_usd) filter (where not cached), 0) as usd,
      count(*) filter (where not cached and user_id is null) as signed_out,
      count(*) filter (where not cached and user_id = ${userId ?? ""}) as mine
    from extraction_events
    where at >= ${since.toISOString()}`);
  const row = (result.rows[0] ?? {}) as { usd?: unknown; signed_out?: unknown; mine?: unknown };
  return {
    usd: Number(row.usd ?? 0),
    signedOutFresh: Number(row.signed_out ?? 0),
    accountFresh: userId ? Number(row.mine ?? 0) : 0,
  };
}

// Once per instance per day per threshold. Process memory on purpose: a miss
// is one more log line, which is the harmless direction.
const warned = new Set<string>();
let warnedFailure = false;

function alarm(limits: BrakeLimits, today: TodaysUse, now: Date): void {
  if (limits.budgetUsd === null) return;
  const day = startOfUtcDay(now).toISOString().slice(0, 10);
  for (const share of [0.5, 0.8, 1]) {
    const key = `${day}:${share}`;
    if (today.usd < limits.budgetUsd * share || warned.has(key)) continue;
    warned.add(key);
    console.warn(
      `[cost] estimated spend today $${today.usd.toFixed(2)} has passed ${Math.round(share * 100)}% of ` +
        `EXTRACTION_DAILY_BUDGET_USD ($${limits.budgetUsd})${share === 1 ? "; new extractions and searches are paused until 00:00 UTC" : ""}`
    );
  }
}

/** The one call a route makes before a paid model call: a refusal to send,
 *  or null to go ahead. */
export async function costBrake(
  userId: string | null,
  kind: BrakeKind,
  limits: BrakeLimits = brakeLimits()
): Promise<Refusal | null> {
  if (limits.budgetUsd === null && limits.signedOutPerDay === null && limits.accountPerDay === null) return null;
  const now = new Date();
  let today: TodaysUse;
  try {
    today = await todaysUse(userId, now);
  } catch (e) {
    if (!warnedFailure) {
      warnedFailure = true;
      console.warn("[cost] daily brake unavailable, failing open:", (e as Error).message);
    }
    return null;
  }
  alarm(limits, today, now);
  return brakeDecision(limits, today, userId, kind);
}

/** Test seam: the alarm's once-a-day memory. */
export function resetCostAlarmForTests(): void {
  warned.clear();
  warnedFailure = false;
}
