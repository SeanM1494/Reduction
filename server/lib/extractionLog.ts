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

import { getDb } from "../db";
import { extractionEvents } from "../../shared/schema";

export interface ExtractionEvent {
  source: "url" | "text" | "file" | "reextract";
  cached: boolean;
  via?: "self" | "claude" | null;
  attempts?: number | null;
  repaired?: number | null;
  host?: string | null;
  ok: boolean;
  ms?: number | null;
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
 * Records one event. Never throws, never awaited by a request path.
 *
 * Deliberately not awaited at the call site: the response has already been
 * sent by the time this runs, so a slow insert cannot add latency to an
 * extraction that was already the slow part of someone's day.
 */
export function recordExtraction(event: ExtractionEvent): void {
  void (async () => {
    try {
      await getDb().insert(extractionEvents).values({
        source: event.source,
        cached: event.cached,
        via: event.via ?? null,
        attempts: event.attempts ?? null,
        repaired: event.repaired ?? null,
        host: event.host ?? null,
        ok: event.ok,
        ms: event.ms ?? null,
      });
    } catch (e) {
      // Deliberately quiet beyond one line. If the table is missing — the
      // migration has not been run — this would otherwise print on every
      // single extraction and bury everything else in the log.
      console.warn("[extractionLog]", (e as Error).message);
    }
  })();
}
