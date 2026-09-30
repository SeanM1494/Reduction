/**
 * components/reel/useReelPhoto.ts — the <Image> source for a reel card's
 * picture, the same two ways as a recipe's photo (lib/recipePhoto.ts):
 *
 * Native: the versioned URL with the bearer header, DERIVED DURING RENDER
 * from the path, so a card is right on its first frame. The path carries
 * the version, so the OS cache is honest.
 *
 * Web (Chromium in the container): an <img> cannot send the header, so the
 * bytes are fetched once and handed over as a blob URL, kept per path; a
 * fetch that lands after the card moved on to another path is dropped.
 */

import { useEffect, useMemo, useState } from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';
import { photoHeaders, reelPhotoUrl } from '@/lib/api';

const blobs = new Map<string, string>();

export function useReelPhoto(path: string | null): ImageSourcePropType | null {
  const derived = useMemo<ImageSourcePropType | null>(() => {
    if (!path) return null;
    if (Platform.OS !== 'web') return { uri: reelPhotoUrl(path), headers: photoHeaders() };
    const hit = blobs.get(path);
    return hit ? { uri: hit } : null;
  }, [path]);

  const [fetched, setFetched] = useState<{ path: string; uri: string } | null>(null);
  useEffect(() => {
    if (!path || Platform.OS !== 'web' || blobs.has(path)) return;
    let live = true;
    fetch(reelPhotoUrl(path), { headers: photoHeaders() })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        const uri = URL.createObjectURL(blob);
        blobs.set(path, uri);
        if (live) setFetched({ path, uri });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);

  if (derived) return derived;
  return fetched && fetched.path === path ? { uri: fetched.uri } : null;
}
