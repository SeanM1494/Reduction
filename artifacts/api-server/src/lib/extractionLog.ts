/**
 * server/lib/extractionLog.ts — one row per extraction attempt or cache hit.
 *
 * This exists so that cost tuning starts from numbers rather than instinct.
 * `meta.via` and `meta.attempts` have been on the wire since extraction was
 * built and nothing has ever recorded them, so two questions that decide real
 * money are currently unanswerable:
 *
 *   -- what fraction takes the expensive path
 *   select via, count(*) from extraction_events
 *    where not cached and source = 'url' group by via;
 *
 *   -- how often the repair retry fires, and on which path
 *   select via, attempts, count(*) from extraction_events
 *    where not cached group by via, attempts order by via, attempts;
 *
 *   -- which sites force the expensive path (the next question)
 *   select host, count(*) from extraction_events
 *    where via = 'claude' group by host order by count(*) desc limit 20;
 *
 * WHY A TABLE AND NOT A LOG LINE. The questions are about proportions over
 * days. A console line gives a log tail that rotates and cannot be aggregated;
 * an in-memory counter resets on every restart, and this app restarts often.
 * Neither answers "what fraction", which is the only form of the question that
 * decides anything.
 *
 * WHAT IT MUST NEVER DO IS FAIL A REQUEST. Every write is fire-and-forget and
 * swallows its own errors. A missing row is a gap in a statistic; a thrown
 * error here would be a recipe the user did not get.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { extractionEvents } from "@workspace/db";
import { estimateCostUsd, promptTokens } from "./extractionCost";
import type { CallUsage } from "./extractionConfig";

export interface ExtractionEvent {
  /** "page": a page the phone's in-app browser already had (Sep 28).
   *  "warmup": the owner warming the reel's curated list (Sep 30). */
  source: "url" | "text" | "file" | "reextract" | "page" | "warmup";
  cached: boolean;
  via?: "self" | "claude" | null;
  attempts?: number | null;
  repaired?: number | null;
  host?: string | null;
  ok: boolean;
  ms?: number | null;
  /** The signed-in account; null for a signed-out trial. */
  userId?: string | null;
  /** What the model calls reported. Absent on a fresh attempt that failed
   *  before any call answered: the cost is then unknown, not zero. Ignored
   *  on a cache hit, which is always zero. */
  usage?: CallUsage | null;
}

/** The row as written: tokens and the ESTIMATED cost from the usage. */
export function eventRow(event: ExtractionEvent) {
  const priced = event.cached
    ? { inputTokens: 0, outputTokens: 0, estCostUsd: "0" }
    : event.usage
      ? {
          inputTokens: promptTokens(event.usage),
          outputTokens: event.usage.outputTokens,
          estCostUsd: estimateCostUsd(event.usage).toFixed(6),
        }
      : { inputTokens: null, outputTokens: null, estCostUsd: null };
  return {
    source: event.source,
    cached: event.cached,
    via: event.via ?? null,
    attempts: event.attempts ?? null,
    repaired: event.repaired ?? null,
    // Capped HERE rather than in hostOf, so no caller can route round it.
    // `host` is the only column fed by a user-supplied string, `text` has
    // no length limit in Postgres, and this table's whole premise is that
    // it is cheap to keep for ever. 253 is the DNS maximum.
    host: event.host ? event.host.slice(0, 253) : null,
    ok: event.ok,
    ms: event.ms ?? null,
    userId: event.userId ?? null,
    ...priced,
  };
}

type Row = ReturnType<typeof eventRow>;

/** Postgres' "undefined_column", however the driver wraps it. */
export function isMissingColumn(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "42703";
}

/**
 * The write, with its fallback. The Sep 30 columns are hand-run DDL, and a
 * Drizzle insert names every column in the schema, so against a database
 * that has not had the ALTER yet the full insert fails outright. Rather than
 * lose every row until someone runs the SQL, it writes the columns that
 * have always existed. Injected for the test; production passes the db.
 */
export async function writeEvent(
  row: Row,
  full: (row: Row) => Promise<unknown>,
  legacy: (row: Row) => Promise<unknown>
): Promise<"full" | "legacy"> {
  try {
    await full(row);
    return "full";
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    await legacy(row);
    return "legacy";
  }
}

/**
 * The host, without the path.
 *
 * `www.` is stripped so a site is one row rather than two, matching what
 * `normalizeUrl` does for cache keys. This is NOT a public-suffix-aware
 * registrable domain — `blog.example.co.uk` stays as it is — because getting
 * that exactly right needs the PSL, and a dependency is not worth it for a
 * column whose only job is to rank which sites are expensive.
 */
export function hostOf(rawUrl: string): string | null {
  try {
    const h = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return h || null;
  } catch {
    return null;
  }
}

/**
 * Records one event. Never throws, never rejects, never awaited by a request
 * path.
 *
 * Deliberately not awaited at the call site: the response has already been
 * sent by the time this runs, so a slow insert cannot add latency to an
 * extraction that was already the slow part of someone's day.
 *
 * The promise is returned for the TEST, which has to know when the write has
 * landed. It used to sleep a fixed 300ms and hope, and on a busy machine the
 * insert can take longer than that; awaiting the write itself is the only
 * wait that cannot be too short. It resolves on success and on a swallowed
 * failure alike, so awaiting it can never fail a request either.
 */
export function recordExtraction(event: ExtractionEvent): Promise<void> {
  return (async () => {
    try {
      const db = getDb();
      const how = await writeEvent(
        eventRow(event),
        (row) => db.insert(extractionEvents).values(row),
        (row) =>
          db.execute(sql`
            insert into extraction_events (source, cached, via, attempts, repaired, host, ok, ms)
            values (${row.source}, ${row.cached}, ${row.via}, ${row.attempts}, ${row.repaired}, ${row.host}, ${row.ok}, ${row.ms})`)
      );
      if (how === "legacy" && !warnedLegacy) {
        warnedLegacy = true;
        console.warn('[extractionLog] cost columns missing; writing without them (README "Extraction costs")');
      }
    } catch (e) {
      // Deliberately quiet beyond one line. If the table is missing — the
      // migration has not been run — this would otherwise print on every
      // single extraction and bury everything else in the log.
      console.warn("[extractionLog]", (e as Error).message);
    }
  })();
}

/** Once per process: the missing-column fallback is a state, not an event. */
let warnedLegacy = false;
