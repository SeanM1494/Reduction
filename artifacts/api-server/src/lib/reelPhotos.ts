/**
 * lib/reelPhotos.ts — the starter reel's pictures: each page's OWN image,
 * fetched by this server and kept as our copy in `reel_photos` (one per
 * page), served at `/api/reel/photo/<url key>?v=<version>`.
 *
 * Where a picture may come from is the rule here: the URL the page's
 * extraction recorded (`recipe.image` in the cached tree), and nothing
 * else. Never an account's recipe_photos row — a `user` photo is a
 * person's own picture, and a `page` photo there is still an account's
 * copy — so nothing anyone attached can reach someone else's reel.
 *
 * Filled two ways: the warm-up stores a curated page's picture as it
 * curates it, and a reel build starts, fire-and-forget, the few a
 * data-backed card is still missing. Both are decoration, so both fail to
 * "no picture": the card shows its meal-type art (CLAUDE.md, "A picture
 * may never take down the library"). In-process memory remembers which
 * pages this instance already tried, so a picture that cannot be fetched
 * is not fetched on every build; a miss there only means one more try.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { fetchPagePhoto, normalisePhoto } from "./photos";

type Rows<T> = { rows: T[] };

/** Postgres "undefined_table", however the driver wraps it. (Its own copy
 *  of reelStore's, so the two modules do not import each other.) */
const isMissingTable = (e: unknown): boolean =>
  ((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "42P01";

export interface ReelPhotoMeta {
  version: number;
  imageUrl: string;
}

/** The path a card carries. Relative: the phone prefixes its own server. */
export const reelPhotoPath = (urlKey: string, version: number): string => `/api/reel/photo/${urlKey}?v=${version}`;

/** The picture a tree names, when it names a web address at all. */
export function pageImageOf(recipe: unknown): string | null {
  const image = (recipe as { image?: unknown } | null)?.image;
  if (typeof image !== "string") return null;
  try {
    const u = new URL(image.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

let warnedMissing = false;
function noteMissing(): void {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn('[reel:photos] no reel_photos table — run the SQL in README "Starter recipes reel"; cards show their meal-type art until then.');
}

/** Stored pictures for these pages; empty when the table is not there. */
export async function reelPhotoMetas(urlKeys: string[]): Promise<Map<string, ReelPhotoMeta>> {
  const out = new Map<string, ReelPhotoMeta>();
  if (!urlKeys.length) return out;
  try {
    const rows = ((await getDb().execute(sql`
      select url_key, version, image_url from reel_photos
       where url_key in (${sql.join(urlKeys.map((k) => sql`${k}`), sql`, `)})`)) as unknown as Rows<{
      url_key: string;
      version: number;
      image_url: string;
    }>).rows;
    for (const r of rows) out.set(r.url_key, { version: Number(r.version), imageUrl: r.image_url });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    noteMissing();
  }
  return out;
}

/** The bytes for the photo route, or null. */
export async function reelPhotoRow(urlKey: string): Promise<{ bytes: Buffer; mediaType: string; version: number } | null> {
  try {
    const rows = ((await getDb().execute(sql`
      select bytes, media_type, version from reel_photos where url_key = ${urlKey}`)) as unknown as Rows<{
      bytes: Buffer;
      media_type: string;
      version: number;
    }>).rows;
    const r = rows[0];
    return r ? { bytes: Buffer.from(r.bytes), mediaType: r.media_type, version: Number(r.version) } : null;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export type ReelPhotoOutcome = "stored" | "kept" | "none" | "failed" | "no_table";

/**
 * Fetch, shrink and store a page's picture. `kept` when the stored one was
 * fetched from this same image URL (so a re-run costs nothing), unless
 * `force`. Never throws.
 */
export async function storeReelPhoto(urlKey: string, imageUrl: string | null, force = false): Promise<ReelPhotoOutcome> {
  if (!imageUrl) return "none";
  try {
    if (!force) {
      const existing = (await reelPhotoMetas([urlKey])).get(urlKey);
      if (existing && existing.imageUrl === imageUrl) return "kept";
    }
    const norm = await normalisePhoto(await fetchPagePhoto(imageUrl));
    await getDb().execute(sql`
      insert into reel_photos (url_key, image_url, bytes, media_type, width, height, version, updated_at)
      values (${urlKey}, ${imageUrl}, ${norm.bytes}, ${norm.mediaType}, ${norm.width}, ${norm.height}, 1, now())
      on conflict (url_key) do update set
        image_url = excluded.image_url, bytes = excluded.bytes, media_type = excluded.media_type,
        width = excluded.width, height = excluded.height,
        version = reel_photos.version + 1, updated_at = now()`);
    return "stored";
  } catch (e) {
    if (isMissingTable(e)) {
      noteMissing();
      return "no_table";
    }
    console.warn(`[reel:photos] ${urlKey.slice(0, 12)}: picture not kept: ${(e as Error).message}`);
    return "failed";
  }
}

/** Pages this instance has already tried to fill, so a picture that cannot
 *  be fetched is not tried on every build. */
const tried = new Set<string>();
/** At most this many fetches start per build: a reel is ten cards, and the
 *  rest are filled by the builds that follow. */
export const FILL_PER_BUILD = 3;

/**
 * Start fetching the pictures these cards still lack (or whose page now
 * names a different one). Fire-and-forget; returns how many it started, so
 * a test can wait on them.
 */
export function fillReelPhotos(
  wanted: Array<{ urlKey: string; imageUrl: string | null }>,
  stored: Map<string, ReelPhotoMeta>
): Promise<ReelPhotoOutcome[]> {
  const jobs: Promise<ReelPhotoOutcome>[] = [];
  for (const w of wanted) {
    if (jobs.length >= FILL_PER_BUILD) break;
    if (!w.imageUrl) continue;
    const have = stored.get(w.urlKey);
    if (have && have.imageUrl === w.imageUrl) continue;
    const token = `${w.urlKey} ${w.imageUrl}`;
    if (tried.has(token)) continue;
    tried.add(token);
    jobs.push(storeReelPhoto(w.urlKey, w.imageUrl, true));
  }
  return Promise.all(jobs);
}

/** Test seam: the tried-set is process-global. */
export function resetReelPhotoFillForTests(): void {
  tried.clear();
  warnedMissing = false;
}
