/**
 * components/reel/useOpenStarter.ts — opening a starter card: the ordinary
 * link extraction (answered from the cache, so instant and free), made the
 * draft with a note of where it came from, then the preview. The same path
 * as a pasted link on Add New, so the preview is the normal unsaved preview
 * — banner, book chooser, Save to Library — and the save spends the
 * allowance exactly as any save does.
 */

import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { extractFromUrl, reportCounter, type ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { useToast } from '@/components/Toast';
import { tapCounter, type ReelCard } from '@/lib/reelView';

export function useOpenStarter() {
  const { setDraft } = useLibrary();
  const { refresh } = useAuth();
  const toast = useToast();
  const [openingUrl, setOpeningUrl] = useState<string | null>(null);

  const open = useCallback(
    async (card: ReelCard) => {
      if (openingUrl) return;
      setOpeningUrl(card.url);
      reportCounter(tapCounter(card.kind));
      try {
        const result = await extractFromUrl(card.url);
        setDraft({ recipe: result.recipe, sourceUrl: card.url, original: result.original, sourceKey: result.sourceKey, fromReel: card.kind });
        router.push('/recipe/draft');
      } catch (e) {
        const err = e as ApiError;
        // The wall: re-read the entitlement, and the screen shows it (the
        // reel itself is empty for a walled account).
        if (err.status === 402 || err.code === 'trial_spent') await refresh();
        else toast({ message: err.message || 'Could not open that recipe.' });
      } finally {
        setOpeningUrl(null);
      }
    },
    [openingUrl, setDraft, refresh, toast]
  );

  return { open, openingUrl };
}
