/**
 * lib/recipePhoto.ts — what an <Image> should be given for a recipe.
 *
 * Native: the versioned URL with the bearer header; the OS caches it by
 * URL, and the version in the URL is what makes that cache honest. Web
 * build (Chromium in the container, no phone): an <img> cannot send an
 * Authorization header, so the bytes are fetched with the token and handed
 * over as a blob URL, cached here by id and version.
 *
 * The self-heal: a recipe with an image URL but no stored photo asks the
 * server to fetch it, once per id per launch (the capture at save is
 * fire-and-forget and an Autoscale instance can be recycled mid-fetch).
 * The answer lands in the library through `setPhoto`, so every card for
 * that recipe updates.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { fetchPhotoFromSource, photoHeaders, photoUrl, type Entry, type PhotoMeta } from '@/lib/api';
import { useLibrary } from '@/lib/library-context';

export interface PhotoImageSource {
  uri: string;
  headers?: Record<string, string>;
}

const blobUrls = new Map<string, string>();
const healing = new Set<string>();

function nativeSource(id: string, meta: PhotoMeta): PhotoImageSource {
  return { uri: photoUrl(id, meta.version), headers: photoHeaders() };
}

async function webSource(id: string, meta: PhotoMeta): Promise<PhotoImageSource | null> {
  const key = `${id}\u0000${meta.version}`;
  const hit = blobUrls.get(key);
  if (hit) return { uri: hit };
  try {
    const res = await fetch(photoUrl(id, meta.version), { headers: photoHeaders() });
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    blobUrls.set(key, url);
    return { uri: url };
  } catch {
    return null;
  }
}

/** The image source for an entry's photo, or null while there is none. */
export function useRecipePhoto(entry: Pick<Entry, 'id' | 'photo' | 'recipe'>): PhotoImageSource | null {
  const { setPhoto } = useLibrary();
  const meta = entry.photo ?? null;
  const [source, setSource] = useState<PhotoImageSource | null>(() =>
    meta && Platform.OS !== 'web' ? nativeSource(entry.id, meta) : null
  );

  useEffect(() => {
    let live = true;
    if (!meta) {
      setSource(null);
      // Heal once: the page had a picture, the row has none yet.
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
    if (Platform.OS !== 'web') {
      setSource(nativeSource(entry.id, meta));
      return;
    }
    webSource(entry.id, meta).then((s) => {
      if (live) setSource(s);
    });
    return () => {
      live = false;
    };
  }, [entry.id, meta?.version, meta?.source, setPhoto]);

  return source;
}
