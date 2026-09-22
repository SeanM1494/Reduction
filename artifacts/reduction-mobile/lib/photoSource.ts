/**
 * lib/photoSource.ts — which image source a recipe card shows this render.
 *
 * Pure, and separate from lib/recipePhoto.ts (which imports react-native and
 * therefore cannot be loaded by the node runner), because the rule it holds
 * is the one that breaks silently: a LIST RECYCLES ITS CELLS. The same
 * component instance is handed recipe B a frame after it was showing recipe
 * A, so anything the card remembers about A — a state value, an in-flight
 * fetch's result — is a wrong picture on B's card unless something says so.
 *
 * Two rules, both here:
 *   - A source that can be derived from (id, version) is derived, never
 *     stored. Derived during render it is correct on the FIRST frame after a
 *     recycle; set in an effect it is one frame late, which is exactly long
 *     enough to paint the previous recipe's photo.
 *   - A source that had to be fetched carries the key it was fetched FOR,
 *     and is used only while that key still matches. An async resolution
 *     that lands after the cell moved on is dropped rather than shown.
 */

export interface PhotoImageSource {
  uri: string;
  headers?: Record<string, string>;
}

export interface PhotoMetaLike {
  version: number;
  source: 'page' | 'user';
}

/** Identity of one recipe's picture at one version — the cache key, and the
 *  tag a fetched source carries. Null when there is no picture. */
export function photoCacheKey(id: string, meta: PhotoMetaLike | null | undefined): string | null {
  return meta ? `${id}\u0000${meta.version}` : null;
}

/**
 * The source to render: what could be derived, else what was fetched FOR
 * THIS key, else nothing. A fetched source tagged with any other key is not
 * a fallback — it is the previous card's picture, and showing it is the bug
 * this function exists to prevent.
 */
export function pickPhotoSource(
  derived: PhotoImageSource | null,
  fetched: { key: string; source: PhotoImageSource } | null,
  key: string | null
): PhotoImageSource | null {
  if (derived) return derived;
  if (!key || !fetched) return null;
  return fetched.key === key ? fetched.source : null;
}
