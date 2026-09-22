/**
 * client/src/components/RecipePhoto.tsx — a recipe's picture, or the
 * meal-type art in its place. Used by the library card and the photo
 * sheet. The bytes come as a blob URL (lib/storage.ts photoBlobUrl), and a
 * recipe whose page had a picture but whose row has none yet asks the
 * server to fetch it, once per id per load; the answer goes back through
 * `onPhoto` so the library state carries it.
 */

import React, { useEffect, useState } from "react";
import type { Entry, PhotoMeta } from "../lib/storage";
import { fetchPhotoFromSource, photoBlobUrl } from "../lib/storage";
import { mealTypeArt } from "../lib/mealTypeArt";
import { sanitizeMealTypes } from "../shared/mealTypes";

const healing = new Set<string>();

interface Props {
  entry: Pick<Entry, "id" | "photo" | "recipe">;
  onPhoto?: (id: string, photo: PhotoMeta) => void;
  className?: string;
  /** Glyph size for the art, px. */
  glyph?: number;
}

export default function RecipePhoto({ entry, onPhoto, className = "", glyph = 36 }: Props) {
  const meta = entry.photo ?? null;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!meta) {
      setSrc(null);
      const imageUrl = (entry.recipe as { image?: unknown }).image;
      if (typeof imageUrl === "string" && imageUrl && !healing.has(entry.id) && onPhoto) {
        healing.add(entry.id);
        fetchPhotoFromSource(entry.id)
          .then((r) => {
            if (r.photo) onPhoto(entry.id, r.photo);
          })
          .catch(() => {});
      }
      return;
    }
    photoBlobUrl(entry.id, meta.version).then((u) => {
      if (live) setSrc(u);
    });
    return () => {
      live = false;
    };
  }, [entry.id, meta?.version, meta?.source]);

  if (src) {
    return <img className={`rd-photo ${className}`.trim()} src={src} alt="" data-testid="card-photo" />;
  }
  const primary = sanitizeMealTypes(entry.recipe.mealTypes)[0] ?? null;
  const art = mealTypeArt(primary);
  return (
    <span
      className={`rd-photo rd-photo-art ${className}`.trim()}
      style={{ "--art-bg": art.light.bg, "--art-ink": art.light.ink, "--art-bg-dark": art.dark.bg, "--art-ink-dark": art.dark.ink } as React.CSSProperties}
      aria-hidden="true"
      data-testid="card-art"
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: art.svg }}
      />
    </span>
  );
}
