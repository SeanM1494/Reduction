/**
 * lib/recipePhoto.ts — what an <Image> should be given for a recipe.
 *
 * Native: the versioned URL with the bearer header, DERIVED DURING RENDER.
 * It is a pure function of (id, version), so a recycled list cell is correct
 * on its first frame; setting it in an effect was one frame late, which is
 * exactly long enough to paint the previous recipe's photo during a fast
 * scroll. The OS caches by URL and the version in the URL keeps that cache
 * honest.
 *
 * Web build (Chromium in the container, no phone): an <img> cannot send an
 * Authorization header, so the bytes are fetched with the token and handed
 * over as a blob URL. A blob already in the module cache is derived during
 * render like the native URL; only a MISS costs a state round trip, and the
 * fetched value carries the key it was fetched for so a resolution that
 * lands after the cell moved on is dropped (lib/photoSource.ts, where both
 * rules live and are tested).
 *
 * The self-heal: a recipe with an image URL but no stored photo asks the
 * server to fetch it, once per id per launch (the capture at save is
 * fire-and-forget and an Autoscale instance can be recycled mid-fetch).
 * The answer lands in the library through `setPhoto`, so every card for
 * that recipe updates.
 */

import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { fetchPhotoFromSource, photoHeaders, photoUrl, type Entry, type PhotoMeta } from '@/lib/api';
import { useLibrary } from '@/lib/library-context';
import { photoCacheKey, pickPhotoSource, type PhotoImageSource } from '@/lib/photoSource';

export type { PhotoImageSource };

const blobUrls = new Map<string, string>();
const healing = new Set<string>();

function nativeSource(id: string, meta: PhotoMeta): PhotoImageSource {
  return { uri: photoUrl(id, meta.version), headers: photoHeaders() };
}

async function fetchBlob(id: string, meta: PhotoMeta): Promise<string | null> {
  try {
    const res = await fetch(photoUrl(id, meta.version), { headers: photoHeaders() });
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    blobUrls.set(photoCacheKey(id, meta)!, url);
    return url;
  } catch {
    return null;
  }
}

/** The image source for an entry's photo, or null while there is none. */
export function useRecipePhoto(entry: Pick<Entry, 'id' | 'photo' | 'recipe'>): PhotoImageSource | null {
  const { setPhoto } = useLibrary();
  const meta = entry.photo ?? null;
  const key = photoCacheKey(entry.id, meta);

  /**
   * Everything knowable this render. Memoised on the key alone so the object
   * identity is stable across unrelated re-renders — <Image> re-evaluates a
   * source it has not seen before, and a card re-renders on every tap
   * elsewhere in the list.
   */
  const derived = useMemo<PhotoImageSource | null>(() => {
    if (!meta) return null;
    if (Platform.OS !== 'web') return nativeSource(entry.id, meta);
    const hit = blobUrls.get(key!);
    return hit ? { uri: hit } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Web, and only on a cache miss. Tagged with the key it is for.
  const [fetched, setFetched] = useState<{ key: string; source: PhotoImageSource } | null>(null);

  useEffect(() => {
    // No picture: heal once if the page had one, and show the meal-type art
    // meanwhile. Nothing to fetch and nothing to keep.
    if (!meta || !key) {
      const imageUrl = (entry.recipe as { image?: unknown }).image;
      if (typeof imageUrl === 'string' && imageUrl && !healing.has(entry.id)) {
        healing.add(entry.id);
        fetchPhotoFromSource(entry.id)
          .then((r) => {
            if (r.photo) setPhoto(entry.id, r.photo);
          })
          .catch(() => {});
      }
      return;
    }
    // Already derivable (native, or a cached blob): no work, no state.
    if (derived) return;
    let live = true;
    fetchBlob(entry.id, meta).then((url) => {
      // `live` covers the unmount; the key on the value covers the RECYCLE,
      // which no cleanup can see because the component never unmounted.
      if (live && url) setFetched({ key, source: { uri: url } });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, derived, entry.id, setPhoto]);

  return pickPhotoSource(derived, fetched, key);
}
