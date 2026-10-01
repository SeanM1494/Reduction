/**
 * lib/reelStore.ts — the reel's database half: the usage aggregation, the
 * owner's list (reel_entries), the cache lookups and the pinned copies.
 * The rules are lib/reel.ts; this only fetches what they judge.
 *
 * reel_entries is HAND-RUN DDL (README "Starter recipes reel"). Without it
 * the reel is data-backed only and nothing can be hidden or curated — the
 * reel still works, which is the same failure mode as every other
 * decoration here (CLAUDE.md, "A picture may never take down the library").
 */

import { sql } from "drizzle-orm";
import type { Recipe } from "@workspace/recipe-model";
import { getDb } from "../db";
import { normalizeUrl, urlKeyOf } from "./urlKey";
import { REEL, assembleReel, cardFrom, withMinimum, rankPages, usageByPage, type Reel, type ReelCard, type UsageRow } from "./reel";
import { cacheGetUrlRow, cacheSetUrl } from "../routes/recipes";
import { fillReelPhotos, pageImageOf, reelPhotoMetas, reelPhotoPath } from "./reelPhotos";

export type EntryStatus = "curated" | "hidden";

export interface ReelEntry {
  urlKey: string;
  url: string;
  status: EntryStatus;
  pinned: Recipe | null;
  note: string | null;
  updatedAt: string;
}

type Rows<T> = { rows: T[] };

/** Every saved recipe with a source URL that somebody cooked or rated.
 *  Signed-in accounts only, removed recipes excluded — the same population
 *  search counts (lib/searchLibrary.ts usageFor). */
export async function loadUsageRows(): Promise<UsageRow[]> {
  const rows = ((await getDb().execute(sql`
    select recipe->>'sourceUrl' as url, user_id,
           coalesce(jsonb_array_length(cooked), 0) > 0 as cooked,
           rating
      from recipes
     where user_id is not null
       and removed_at is null
       and recipe->>'sourceUrl' is not null
       and (coalesce(jsonb_array_length(cooked), 0) > 0 or rating is not null)`)) as unknown as Rows<{
    url: string;
    user_id: string;
    cooked: boolean;
    rating: number | null;
  }>).rows;
  return rows.map((r) => ({ url: r.url, userId: r.user_id, cooked: !!r.cooked, rating: r.rating === null ? null : Number(r.rating) }));
}

/** Postgres "undefined_table", however the driver wraps it. */
export const isMissingTable = (e: unknown): boolean =>
  ((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "42P01";

/** The owner's list; empty when the table is not there yet. */
export async function loadEntries(): Promise<ReelEntry[]> {
  try {
    const rows = ((await getDb().execute(sql`
      select url_key, url, status, pinned, note, updated_at::text as updated_at
        from reel_entries order by updated_at`)) as unknown as Rows<{
      url_key: string;
      url: string;
      status: string;
      pinned: Recipe | null;
      note: string | null;
      updated_at: string;
    }>).rows;
    return rows
      .filter((r) => r.status === "curated" || r.status === "hidden")
      .map((r) => ({ urlKey: r.url_key, url: r.url, status: r.status as EntryStatus, pinned: r.pinned, note: r.note, updatedAt: r.updated_at }));
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

export async function upsertEntry(url: string, status: EntryStatus, note: string | null, pinned?: Recipe | null): Promise<string> {
  const key = urlKeyOf(url);
  if (!key) throw Object.assign(new Error("That is not a web address."), { status: 400 });
  await getDb().execute(sql`
    insert into reel_entries (url_key, url, status, pinned, note, updated_at)
    values (${key}, ${url}, ${status}, ${pinned === undefined ? null : JSON.stringify(pinned)}::jsonb, ${note}, now())
    on conflict (url_key) do update set
      url = excluded.url,
      status = excluded.status,
      pinned = ${pinned === undefined ? sql`reel_entries.pinned` : sql`excluded.pinned`},
      note = coalesce(excluded.note, reel_entries.note),
      updated_at = now()`);
  return key;
}

export async function deleteEntry(url: string): Promise<boolean> {
  const key = urlKeyOf(url);
  if (!key) return false;
  const r = (await getDb().execute(sql`delete from reel_entries where url_key = ${key} returning url_key`)) as unknown as Rows<unknown>;
  return r.rows.length > 0;
}

/**
 * A curated page's tree: the cache row if it is there; otherwise its pinned
 * copy, PUT BACK into the cache first so the tap that follows is the same
 * free cache hit. A re-read (/reextract) that failed is what empties a row;
 * this is the only thing that refills one without a model call.
 */
export async function curatedTree(entry: ReelEntry): Promise<{ recipe: Recipe | null; restored: boolean }> {
  const row = await cacheGetUrlRow(entry.url);
  if (row) return { recipe: row.recipe, restored: false };
  if (!entry.pinned) return { recipe: null, restored: false };
  await cacheSetUrl(entry.url, entry.pinned);
  return { recipe: entry.pinned, restored: true };
}

export interface ReelBuild extends Reel {
  /** Counts only, for the admin preview: why candidates were left out.
   *  `noPicture`: a page with no picture stored in reel_photos (Oct 1: a
   *  card is offered only with its page's own picture). `tooFewCards`:
   *  cards that qualified but were withheld because fewer than the minimum
   *  did. */
  excluded: { belowMinimums: number; notCached: number; notClean: number; hidden: number; noPicture: number; tooFewCards: number };
  /** For the admin preview only: the pages left out for want of a stored
   *  picture (public pages; no account in them), and the cards withheld
   *  below the minimum. Never sent by GET /api/reel. */
  missingPicture: Array<{ url: string; title: string; site: string; kind: ReelCard["kind"] }>;
  withheld: ReelCard[];
  restored: number;
  /** Picture fetches this build started (fire-and-forget), for the tests. */
  photoFill: Promise<unknown>;
}

/** The reel as it stands, from the database. */
export async function buildReel(): Promise<ReelBuild> {
  const entries = await loadEntries();
  const hidden = new Set(entries.filter((e) => e.status === "hidden").map((e) => normalizeUrl(e.url) ?? e.url));
  const usage = usageByPage(await loadUsageRows());
  const ranked = rankPages(usage);
  const excluded = { belowMinimums: usage.size - ranked.length, notCached: 0, notClean: 0, hidden: 0, noPicture: 0, tooFewCards: 0 };

  const data: Array<{ card: ReelCard; usage: (typeof ranked)[number] }> = [];
  // Each card's page picture, as its cached tree names it.
  const images = new Map<string, string | null>();
  for (const page of ranked.slice(0, REEL.candidateLimit)) {
    if (hidden.has(normalizeUrl(page.url) ?? page.url)) {
      excluded.hidden++;
      continue;
    }
    const row = await cacheGetUrlRow(page.url);
    if (!row) {
      excluded.notCached++;
      continue;
    }
    const card = cardFrom(row.recipe, "data", page);
    if (!card) {
      excluded.notClean++;
      continue;
    }
    images.set(card.url, pageImageOf(row.recipe));
    data.push({ card, usage: page });
  }

  const curated: ReelCard[] = [];
  let restored = 0;
  for (const e of entries.filter((x) => x.status === "curated")) {
    const { recipe, restored: r } = await curatedTree(e);
    if (r) restored++;
    const card = cardFrom(recipe, "curated", undefined);
    if (card) {
      images.set(card.url, pageImageOf(recipe));
      curated.push(card);
    } else if (!recipe) excluded.notCached++;
    else excluded.notClean++;
  }
  // Pictures FIRST, before the reel is assembled (Oct 1): a card is offered
  // only with its page's own picture stored in reel_photos. Filtering the
  // candidates rather than the finished reel lets the next candidate take a
  // dropped card's place instead of leaving the reel one short.
  const candidates = [...data.map((d) => d.card), ...curated];
  const keyOf = new Map(candidates.map((c) => [c.url, urlKeyOf(c.url)] as const));
  const stored = await reelPhotoMetas([...new Set([...keyOf.values()].flatMap((k) => (k ? [k] : [])))]);
  const missingPicture: ReelBuild["missingPicture"] = [];
  const seenMissing = new Set<string>();
  const pictured = (card: ReelCard): ReelCard | null => {
    const urlKey = keyOf.get(card.url);
    const meta = urlKey ? stored.get(urlKey) : undefined;
    if (meta) return { ...card, photo: reelPhotoPath(urlKey!, meta.version) };
    const page = normalizeUrl(card.url) ?? card.url;
    if (!seenMissing.has(page) && !hidden.has(page)) {
      seenMissing.add(page);
      missingPicture.push({ url: card.url, title: card.title, site: card.site, kind: card.kind });
    }
    return null;
  };
  const withPictures = data.flatMap((d) => {
    const card = pictured(d.card);
    return card ? [{ card, usage: d.usage }] : [];
  });
  const curatedWithPictures = curated.flatMap((c) => {
    const card = pictured(c);
    return card ? [card] : [];
  });
  const { reel, withheld } = withMinimum(assembleReel(withPictures, curatedWithPictures, hidden));
  excluded.noPicture = missingPicture.length;
  excluded.tooFewCards = withheld.length;

  // The pictures still missing are fetched for the builds that follow
  // (lib/reelPhotos.ts), those first; a stored one whose page now names a
  // different image is refreshed after them. Never for a hidden page: hiding
  // deleted its picture, and a fill would quietly fetch it back.
  const missingFirst = candidates.filter((c) => !hidden.has(normalizeUrl(c.url) ?? c.url)).sort((a, b) => Number(!!stored.get(keyOf.get(a.url) ?? "")) - Number(!!stored.get(keyOf.get(b.url) ?? "")));
  const photoFill = fillReelPhotos(
    missingFirst.flatMap((c) => {
      const urlKey = keyOf.get(c.url);
      return urlKey ? [{ urlKey, imageUrl: images.get(c.url) ?? null }] : [];
    }),
    stored
  ).catch(() => []);
  return { ...reel, excluded, restored, missingPicture, withheld, photoFill };
}
