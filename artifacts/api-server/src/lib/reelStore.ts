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
import { REEL, assembleReel, cardFrom, rankPages, usageByPage, type Reel, type ReelCard, type UsageRow } from "./reel";
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
  /** Counts only, for the admin preview: why candidates were left out. */
  excluded: { belowMinimums: number; notCached: number; notClean: number; hidden: number };
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
  const excluded = { belowMinimums: usage.size - ranked.length, notCached: 0, notClean: 0, hidden: 0 };

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
  const reel = assembleReel(data, curated, hidden);

  // Pictures: what is stored is shown; what is missing is fetched for the
  // builds that follow (lib/reelPhotos.ts).
  const keyed = reel.cards.map((card) => ({ card, urlKey: urlKeyOf(card.url), imageUrl: images.get(card.url) ?? null }));
  const stored = await reelPhotoMetas(keyed.flatMap((k) => (k.urlKey ? [k.urlKey] : [])));
  const cards = keyed.map(({ card, urlKey }) => {
    const meta = urlKey ? stored.get(urlKey) : undefined;
    return meta ? { ...card, photo: reelPhotoPath(urlKey!, meta.version) } : card;
  });
  const photoFill = fillReelPhotos(
    keyed.flatMap((k) => (k.urlKey ? [{ urlKey: k.urlKey, imageUrl: k.imageUrl }] : [])),
    stored
  ).catch(() => []);
  return { ...reel, cards, excluded, restored, photoFill };
}
