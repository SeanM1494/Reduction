/**
 * lib/readHistory.ts — how a page was last READ, and what reading one
 * typically costs, for the reel's warm report (Oct 1). Read-only.
 *
 * WHY. A page our own fetch could not read goes through the fallback
 * (Anthropic's fetch, lib/readRecipe.ts), and that path never records the
 * page's image: such a page can never have a stored picture, so it can
 * never be in the reel (lib/reelStore.ts), and re-reading it buys nothing —
 * two refreshes on Oct 1 cost about 20 cents for exactly that.
 *
 * HOW, without a schema change. `extraction_events` keeps the HOST, not the
 * URL, so two signals are combined:
 * - the cached tree itself: our own fetch always writes an `image` key (the
 *   page's picture or null); the fallback never writes one. A tree WITH the
 *   key was read by our fetch, whatever the log says.
 * - the site's last fresh read in the log: for a tree WITHOUT the key, a
 *   last read through the fallback means this site refuses our server; a
 *   last read by our fetch means the tree only predates picture capture,
 *   and a refresh can store one.
 * Per site is the right grain anyway: it is the site that refuses us.
 */

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { extractionEvents } from "@workspace/db";
import { getDb } from "../db";

export type ReadPath = "self" | "fallback" | "unknown";

export interface HostRead {
  via: "self" | "claude";
  at: Date;
}

/** PURE: the decision above. */
export function readPathOf(recipe: unknown, hostLast: HostRead | null): { path: ReadPath; basis: "tree" | "site" | "none" } {
  if (recipe && typeof recipe === "object" && "image" in recipe) return { path: "self", basis: "tree" };
  if (!hostLast) return { path: "unknown", basis: "none" };
  return { path: hostLast.via === "claude" ? "fallback" : "self", basis: "site" };
}

/** The words the report prints for a path, and whether a refresh is refused. */
export function readPathNote(path: ReadPath, basis: "tree" | "site" | "none"): { note: string; refuseRefresh: boolean } {
  if (path === "fallback") return { note: "read through the fallback: no picture can be stored, skip", refuseRefresh: true };
  if (path === "self" && basis === "site") return { note: "read before pictures were recorded; this site lets our server in, so a refresh can store one", refuseRefresh: false };
  if (path === "self") return { note: "read by our own fetch", refuseRefresh: false };
  return { note: "no read of this site on record", refuseRefresh: false };
}

/** The site's most recent fresh (not cached) read that names a path. */
export async function lastHostRead(host: string | null): Promise<HostRead | null> {
  if (!host) return null;
  try {
    const [row] = await getDb()
      .select({ via: extractionEvents.via, at: extractionEvents.at })
      .from(extractionEvents)
      .where(and(eq(extractionEvents.host, host), eq(extractionEvents.cached, false), isNotNull(extractionEvents.via)))
      .orderBy(desc(extractionEvents.at))
      .limit(1);
    return row && (row.via === "self" || row.via === "claude") ? { via: row.via, at: row.at } : null;
  } catch {
    // No table or no cost columns yet: the report says "no read on record".
    return null;
  }
}

/** The average estimated cost of the last 50 successful fresh reads by
 *  that path, or null with no history. An ESTIMATE of an estimate: the
 *  per-read figures are list-price estimates (lib/extractionCost.ts). */
export async function typicalReadCost(via: "self" | "claude"): Promise<number | null> {
  try {
    const rows = await getDb().execute(sql`
      select avg(cost)::float as avg, count(*)::int as n from (
        select est_cost_usd as cost from extraction_events
         where cached = false and ok = true and via = ${via} and est_cost_usd is not null and est_cost_usd > 0
         order by at desc limit 50) recent`);
    const r = (rows as unknown as { rows: Array<{ avg: number | null; n: number }> }).rows[0];
    return r && r.n > 0 && r.avg !== null ? Math.round(r.avg * 10000) / 10000 : null;
  } catch {
    return null;
  }
}
