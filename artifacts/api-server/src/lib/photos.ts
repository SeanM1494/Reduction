/**
 * server/lib/photos.ts — a recipe's picture, stored as OUR copy.
 *
 * Two ways a photo arrives, one table (`recipe_photos`, see the schema for
 * why it is neither in the recipe JSON nor on the row):
 *
 *   - `page`: the source page's own picture. The extractor records its URL
 *     as `recipe.image`; nothing ever hands that URL to a client. At save
 *     time the server fetches it, resizes it and stores the bytes, so the
 *     card never depends on a site that can die or hotlink-block, and no
 *     phone ever makes a request to a recipe site. Fetched fire-and-forget
 *     after the save responds — allowed because a miss is harmless: the
 *     card shows the meal-type fallback until the photo exists, and a card
 *     that finds none asks POST /:id/photo/from-source once, which is the
 *     same call and heals an instance recycled mid-fetch.
 *   - `user`: a photo the person attached. Beats a page photo for ever: a
 *     page fetch never overwrites a user photo (the conditional upsert).
 *
 * Everything stored is JPEG, long edge PHOTO_LONG_EDGE. jimp (pure JS — no
 * native build, so nothing for the frozen install or EAS to refuse) does
 * the decode and the resize; a second per large photo, off the request
 * path where it matters.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { Jimp } from "jimp";
import { getDb } from "../db";
import { recipePhotos } from "@workspace/db";
import { assertPublicUrl } from "./fetchSource";

export const PHOTO_LONG_EDGE = 1024;
export const PHOTO_JPEG_QUALITY = 80;
/** A phone photo shrunk by lib/photo.ts is well under 1MB; the web's canvas
 *  resize likewise. Six is generous for an unshrunk upload and still bounds
 *  the decode. */
export const MAX_PHOTO_UPLOAD_BYTES = 6 * 1024 * 1024;
/** Hero images on recipe sites run 1–4MB; twelve bounds a hostile page. */
export const MAX_PAGE_IMAGE_BYTES = 12 * 1024 * 1024;
export const PAGE_IMAGE_TIMEOUT_MS = 8_000;

export type PhotoSource = "page" | "user";

export interface PhotoMeta {
  version: number;
  source: PhotoSource;
}

export const UPLOAD_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
]);

/** Decode, fit inside PHOTO_LONG_EDGE (never upscaled), re-encode as JPEG.
 *  Throws when the bytes are not an image jimp can read. */
export async function normalisePhoto(
  bytes: Buffer
): Promise<{ bytes: Buffer; width: number; height: number; mediaType: "image/jpeg" }> {
  const img = await Jimp.read(bytes);
  if (img.width > PHOTO_LONG_EDGE || img.height > PHOTO_LONG_EDGE) {
    img.scaleToFit({ w: PHOTO_LONG_EDGE, h: PHOTO_LONG_EDGE });
  }
  const out = await img.getBuffer("image/jpeg", { quality: PHOTO_JPEG_QUALITY });
  return { bytes: out, width: img.width, height: img.height, mediaType: "image/jpeg" };
}

/**
 * Store (or replace) a recipe's photo. A `page` photo never replaces a
 * `user` one — the conditional upsert skips the write and the existing
 * meta comes back, so the caller cannot tell the difference and does not
 * need to.
 */
export async function storeRecipePhoto(params: {
  ownerKey: string;
  id: string;
  bytes: Buffer;
  source: PhotoSource;
}): Promise<PhotoMeta> {
  const norm = await normalisePhoto(params.bytes);
  const db = getDb();
  const values = {
    ownerKey: params.ownerKey,
    id: params.id,
    bytes: norm.bytes,
    mediaType: norm.mediaType,
    width: norm.width,
    height: norm.height,
    source: params.source,
    updatedAt: new Date(),
  };
  const written = await db
    .insert(recipePhotos)
    .values(values)
    .onConflictDoUpdate({
      target: [recipePhotos.ownerKey, recipePhotos.id],
      set: { ...values, version: sql`${recipePhotos.version} + 1` },
      // A page photo only ever lands where no user photo is.
      setWhere: params.source === "page" ? sql`${recipePhotos.source} <> 'user'` : undefined,
    })
    .returning({ version: recipePhotos.version, source: recipePhotos.source });
  if (written[0]) return { version: written[0].version, source: written[0].source as PhotoSource };
  const existing = await photoMeta(params.ownerKey, params.id);
  if (!existing) throw new Error("photo upsert wrote nothing and none exists");
  return existing;
}

export async function photoMeta(ownerKey: string, id: string): Promise<PhotoMeta | null> {
  const rows = await getDb()
    .select({ version: recipePhotos.version, source: recipePhotos.source })
    .from(recipePhotos)
    .where(and(eq(recipePhotos.ownerKey, ownerKey), eq(recipePhotos.id, id)));
  return rows[0] ? { version: rows[0].version, source: rows[0].source as PhotoSource } : null;
}

/** Meta for many rows at once — the library list's join, keyed
 *  `${ownerKey}\u0000${id}`. */
export async function photoMetaFor(
  keys: Array<{ ownerKey: string; id: string }>
): Promise<Map<string, PhotoMeta>> {
  const out = new Map<string, PhotoMeta>();
  if (!keys.length) return out;
  const owners = [...new Set(keys.map((k) => k.ownerKey))];
  const ids = [...new Set(keys.map((k) => k.id))];
  const rows = await getDb()
    .select({ ownerKey: recipePhotos.ownerKey, id: recipePhotos.id, version: recipePhotos.version, source: recipePhotos.source })
    .from(recipePhotos)
    .where(and(inArray(recipePhotos.ownerKey, owners), inArray(recipePhotos.id, ids)));
  const wanted = new Set(keys.map((k) => `${k.ownerKey}\u0000${k.id}`));
  for (const r of rows) {
    const key = `${r.ownerKey}\u0000${r.id}`;
    if (wanted.has(key)) out.set(key, { version: r.version, source: r.source as PhotoSource });
  }
  return out;
}

export async function photoRow(ownerKey: string, id: string) {
  const rows = await getDb()
    .select()
    .from(recipePhotos)
    .where(and(eq(recipePhotos.ownerKey, ownerKey), eq(recipePhotos.id, id)));
  return rows[0] ?? null;
}

export async function deleteRecipePhoto(ownerKey: string, id: string): Promise<boolean> {
  const gone = await getDb()
    .delete(recipePhotos)
    .where(and(eq(recipePhotos.ownerKey, ownerKey), eq(recipePhotos.id, id)))
    .returning({ id: recipePhotos.id });
  return gone.length > 0;
}

// ------------------------------------------------------- the page's image ---

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; contentType: string | null; bytes: Buffer }>;

const realFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(PAGE_IMAGE_TIMEOUT_MS),
    headers: { Accept: "image/*", "User-Agent": "Mozilla/5.0 (compatible; RecipeReduction/1.0)" },
  });
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_PAGE_IMAGE_BYTES) {
    return { ok: false, status: 413, contentType: res.headers.get("content-type"), bytes: Buffer.alloc(0) };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type"), bytes };
};

let fetcher: Fetcher = realFetcher;

/** TEST SEAM: the loopback stub stands in for the recipe site (the public-
 *  host check would refuse 127.0.0.1 otherwise, which is right in
 *  production). */
export function setPagePhotoFetcherForTests(f: Fetcher | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setPagePhotoFetcherForTests is a test seam and must not be called in production.");
  }
  fetcher = f ?? realFetcher;
}

/** Fetch the page's picture. Throws with a one-line reason on anything
 *  that is not an image this server will keep. */
export async function fetchPagePhoto(imageUrl: string): Promise<Buffer> {
  if (fetcher === realFetcher) assertPublicUrl(imageUrl);
  const res = await fetcher(imageUrl);
  if (!res.ok) throw new Error(`image fetch answered ${res.status}`);
  if (res.contentType && !/^image\//i.test(res.contentType)) throw new Error(`not an image (${res.contentType})`);
  if (res.bytes.length > MAX_PAGE_IMAGE_BYTES) throw new Error("image larger than the cap");
  if (!res.bytes.length) throw new Error("empty image");
  return res.bytes;
}

/**
 * Fetch and store a page photo for a recipe. Never throws: this runs
 * fire-and-forget after a save, and from the on-demand route, and in both
 * places a failure means "no photo yet", which the card already handles.
 * Logged with the reason so a site that always fails can be recognised.
 */
export async function capturePagePhoto(ownerKey: string, id: string, imageUrl: string): Promise<PhotoMeta | null> {
  try {
    const existing = await photoMeta(ownerKey, id);
    if (existing?.source === "user") return existing;
    const bytes = await fetchPagePhoto(imageUrl);
    const meta = await storeRecipePhoto({ ownerKey, id, bytes, source: "page" });
    console.log(`[photos] ${id}: page photo stored (v${meta.version})`);
    return meta;
  } catch (e) {
    console.warn(`[photos] ${id}: page photo not kept: ${(e as Error).message}`);
    return null;
  }
}
