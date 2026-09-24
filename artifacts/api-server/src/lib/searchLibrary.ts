/**
 * server/lib/searchLibrary.ts — the half of a search that is ours.
 *
 * A search answers with at most FIVE results: up to three recipes this app
 * has already read (the extraction cache, matched on title), then the live
 * web search's results to fill the rest. Fewer than three cached matches
 * means more from the web; the total never passes five (`mergeResults`).
 *
 * WHY THE CACHED HALF COSTS NO TIME. The web half is one model call with
 * web search — seconds. Everything here is a database read — milliseconds —
 * and the route starts it BEFORE the web call and awaits both together, so
 * it adds nothing to the time a search takes. The usage counts are one more
 * read, over at most five URLs, after both land. See README "Search".
 *
 * WHAT MAY SURFACE, AND WHAT MAY NOT. Libraries are private (ROADMAP,
 * "Visibility — settled"): nobody browses anyone else's recipes, and only
 * aggregate counts cross between accounts. The cache is not a library — it
 * is keyed by page, linked to no account — but two things keep it from
 * becoming one:
 *
 *   - ONLY PAGES READ FROM A URL. A pasted recipe or a photographed page is
 *     cached too, under a hash of its text, and it is somebody's own; it has
 *     no `sourceUrl` and is never matched here.
 *   - ONLY URLS THAT LOOK PUBLIC (`surfaceableUrl`). Somebody may have
 *     extracted a shared document, a cloud-drive file or a link carrying a
 *     token; surfacing that to a stranger searching the dish's name would
 *     hand out their private link. A query string, a document or drive host,
 *     an IP address or an unusual port keeps a page out of search. That
 *     costs a few real recipe pages (a WordPress `?p=123`); they still reach
 *     people through the web search.
 *
 * THE COUNTS HAVE A FLOOR, for two reasons that agree: "Saved by 1 person"
 * looks broken rather than reassuring, and a count of one or two is close
 * enough to a person to be worth not publishing. Below the floor nothing is
 * said at all (`proofLine`).
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { normalizeUrl } from "./urlKey";
import type { SearchResult } from "./searchRecipes";

export const SEARCH_LIMIT = 5;
export const LIBRARY_LIMIT = 3;

/** The floors below which a count is not shown. */
export const PROOF_FLOOR = { saves: 3, cooks: 5, rated: 5 } as const;

/** Hosts whose pages are somebody's documents rather than published recipes. */
const PRIVATE_HOSTS = [
  "docs.google.com",
  "drive.google.com",
  "dropbox.com",
  "dropboxusercontent.com",
  "notion.so",
  "notion.site",
  "icloud.com",
  "onedrive.live.com",
  "1drv.ms",
  "sharepoint.com",
  "evernote.com",
  "box.com",
  "mail.google.com",
];

/** May this cached page be offered to somebody who did not extract it? */
export function surfaceableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  if (u.search) return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (PRIVATE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;
  return true;
}

const siteOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** One identity per page, so a page cached under two raw URLs is offered once
 *  and never twice beside its own web result. */
const pageKey = (url: string): string => normalizeUrl(url) ?? url;

/**
 * Cached pages whose TITLE matches the query, best match first. English
 * stemming, every word required ("best brownies" finds "Best Homemade
 * Brownies", not every brownie). Deduplicated by page and filtered to what
 * may surface before the limit is applied, so a hidden page never costs a
 * slot.
 */
export async function libraryMatches(query: string, limit = LIBRARY_LIMIT): Promise<SearchResult[]> {
  const rows = (await getDb().execute(sql`
    select recipe->>'title' as title, recipe->>'sourceUrl' as url, recipe->>'source' as site
      from extraction_cache
     where recipe->>'sourceUrl' is not null
       and to_tsvector('english', coalesce(recipe->>'title', '')) @@ plainto_tsquery('english', ${query})
     order by ts_rank(to_tsvector('english', coalesce(recipe->>'title', '')), plainto_tsquery('english', ${query})) desc,
              created_at desc
     limit 25
  `)).rows as unknown as Array<{ title: string | null; url: string; site: string | null }>;

  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!surfaceableUrl(r.url)) continue;
    const key = pageKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: r.title || r.url, url: r.url, site: r.site || siteOf(r.url), note: "", cached: true });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Ours first (at most `libraryLimit`), then the web's in its own order, minus
 * any page already offered, to `limit` in all. Pure.
 */
export function mergeResults(
  library: SearchResult[],
  web: SearchResult[],
  limit = SEARCH_LIMIT,
  libraryLimit = LIBRARY_LIMIT
): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of library) {
    if (out.length >= Math.min(libraryLimit, limit)) break;
    const key = pageKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  for (const r of web) {
    if (out.length >= limit) break;
    const key = pageKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface UsageStats {
  /** Accounts with this page in their box. */
  saves: number;
  /** Times it has been cooked, across every account. */
  cooks: number;
  /** Accounts that rated it 👍, and that rated it at all. */
  loved: number;
  rated: number;
}

/**
 * Usage across every account, per result URL. Signed-in accounts only (a
 * trial parked under a cookie is not a person's box yet), and a recipe taken
 * out of the box is not "saved".
 *
 * A page is matched the way the cache matches it — through `normalizeUrl`,
 * so a copy saved from `?utm_source=newsletter`, over `http`, or without the
 * `www.` counts for the same page. SQL narrows the candidates by host and
 * path (ILIKE); the fold itself is `normalizeUrl` in JS, the one definition
 * the cache also uses, rather than a second copy of it written in SQL.
 */
export async function usageFor(urls: string[]): Promise<Map<string, UsageStats>> {
  const out = new Map<string, UsageStats>();
  const byForm = new Map<string, string[]>(); // normalised -> the result urls it answers for
  const patterns: string[] = [];
  for (const u of urls) {
    const n = normalizeUrl(u);
    if (!n) continue;
    byForm.set(n, [...(byForm.get(n) ?? []), u]);
    const p = new URL(n);
    const stem = `${p.hostname}${p.pathname === "/" ? "" : p.pathname}`.replace(/[\\%_]/g, "\\$&");
    patterns.push(`%${stem}%`);
  }
  if (!patterns.length) return out;

  const rows = (await getDb().execute(sql`
    select recipe->>'sourceUrl' as url, user_id,
           coalesce(jsonb_array_length(cooked), 0)::int as cooks,
           rating
      from recipes
     where user_id is not null
       and removed_at is null
       and recipe->>'sourceUrl' ilike any (array[${sql.join(patterns.map((p) => sql`${p}`), sql`, `)}])
  `)).rows as unknown as Array<{ url: string; user_id: string; cooks: number; rating: number | null }>;

  const acc = new Map<string, { users: Set<string>; cooks: number; loved: number; rated: number }>();
  for (const r of rows) {
    const n = normalizeUrl(r.url);
    if (!n || !byForm.has(n)) continue; // a neighbour the ILIKE let through
    const a = acc.get(n) ?? { users: new Set<string>(), cooks: 0, loved: 0, rated: 0 };
    a.users.add(r.user_id);
    a.cooks += r.cooks;
    if (r.rating !== null) {
      a.rated += 1;
      if (r.rating === 1) a.loved += 1;
    }
    acc.set(n, a);
  }
  for (const [n, a] of acc) {
    for (const u of byForm.get(n) ?? []) out.set(u, { saves: a.users.size, cooks: a.cooks, loved: a.loved, rated: a.rated });
  }
  return out;
}

/**
 * The one line a result may carry about how people found it, or null. Each
 * part is said only above its floor, at most two parts, in the order a cook
 * weighs them: how many kept it, how often it was made, how it went.
 */
export function proofLine(s: UsageStats | undefined): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (s.saves >= PROOF_FLOOR.saves) parts.push(`Saved by ${s.saves} people`);
  if (s.cooks >= PROOF_FLOOR.cooks) parts.push(`cooked ${s.cooks} times`);
  if (s.rated >= PROOF_FLOOR.rated) parts.push(`${Math.round((s.loved / s.rated) * 100)}% loved it`);
  if (!parts.length) return null;
  const line = parts.slice(0, 2).join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
