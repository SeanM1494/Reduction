/**
 * lib/library-context.tsx — the signed-in account's saved recipes.
 *
 * Simpler than the web app's client/src/lib/storage.ts on purpose: there is
 * no anonymous X-Owner-Key library on mobile (sign-in is required before any
 * save), so there is nothing to migrate and nothing to claim. What survives
 * from the web version is the concurrency model — a per-entry version token
 * and a three-way merge on conflict (shared/sync.ts) — because the same
 * account can still be cooking on a laptop and a phone at once.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Recipe } from '@/shared/layout';
import type { OrderPreference } from '@/shared/sequence';
import { mergeEntry, type SyncableEntry } from '@/shared/sync';
import {
  createEntry as apiCreateEntry,
  deleteEntry as apiDeleteEntry,
  patchEntry as apiPatchEntry,
  ApiError,
  type Entry,
  loadLibrary,
  newEntryId,
  type StepTimer,
} from './api';

export type EntryPatch = Partial<{
  recipe: Recipe;
  done: string[];
  servings: number | null;
  mode: 'diagram' | 'steps';
  timer: StepTimer | null;
  cooked: number[];
  rating: number | null;
  order: OrderPreference | null;
}>;

/**
 * The server echoes the whole row after every write, as a fresh parse. If
 * that parse replaced `recipe` on the entry, every consumer keyed on the
 * recipe's identity — DiagramView's layout, cells and rects — would rebuild
 * on every tap, and its cell memoisation would be defeated on the round
 * trip (measured: 273 cell renders per tap instead of 5). So an unchanged
 * recipe keeps the object the device already holds.
 */
function keepRecipeIdentity(prev: Entry | undefined, next: Entry): Entry {
  if (!prev || prev.recipe === next.recipe) return next;
  return JSON.stringify(prev.recipe) === JSON.stringify(next.recipe) ? { ...next, recipe: prev.recipe } : next;
}

const toSyncable = (e: Entry): SyncableEntry => ({
  recipe: e.recipe,
  done: e.done,
  servings: e.servings,
  mode: e.mode,
  timer: e.timer,
  cooked: e.cooked ?? [],
  rating: e.rating ?? null,
  order: e.order ?? null,
});

interface LibraryState {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getEntry: (id: string) => Entry | undefined;
  saveRecipe: (recipe: Recipe) => Promise<Entry>;
  update: (id: string, patch: EntryPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  draft: { recipe: Recipe; sourceUrl?: string | null } | null;
  setDraft: (draft: { recipe: Recipe; sourceUrl?: string | null } | null) => void;
}

const LibraryContext = createContext<LibraryState | null>(null);

const MAX_CONFLICT_RETRIES = 3;

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ recipe: Recipe; sourceUrl?: string | null } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { entries: rows } = await loadLibrary();
      setEntries(rows);
    } catch (e) {
      setError((e as Error).message || 'Could not load your recipes.');
    } finally {
      setLoading(false);
    }
  }, []);

  const getEntry = useCallback((id: string) => entries.find((e) => e.id === id), [entries]);

  const saveRecipe = useCallback(async (recipe: Recipe): Promise<Entry> => {
    const id = newEntryId();
    const { entry } = await apiCreateEntry({ id, recipe, mode: 'diagram' });
    setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
    return entry;
  }, []);

  const update = useCallback(
    async (id: string, patch: EntryPatch) => {
      // `original` is the last state THIS device has acknowledged from the
      // server — the three-way merge's fixed `base` for the whole retry loop
      // (see shared/sync.ts's header). It must NOT be re-read from `entries`
      // inside the loop: `entries` only changes via the optimistic/merge
      // setEntries calls below, so re-deriving "current" from it on each
      // iteration silently re-used the stale pre-conflict version and made
      // every retry replay the same already-rejected `ifVersion`, dooming
      // every conflict to exhaust retries and roll back.
      const original = entries.find((e) => e.id === id) ?? getEntry(id);
      const baseSyncable = original ? toSyncable(original) : null;
      let mine: SyncableEntry = { ...toSyncable(original ?? (patch as unknown as Entry)), ...patch };
      let body: EntryPatch & { ifVersion?: number } = { ...patch, ifVersion: original?.version };

      // Optimistic local update so the UI feels instant.
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

      let attempt = 0;
      while (true) {
        try {
          const { entry } = await apiPatchEntry(id, body);
          setEntries((prev) => prev.map((e) => (e.id === id ? keepRecipeIdentity(e, entry) : e)));
          return;
        } catch (e) {
          const err = e as ApiError;
          if (err.status === 409 && err.entry && attempt < MAX_CONFLICT_RETRIES) {
            attempt++;
            const theirs = err.entry as Entry;
            const { merged } = mergeEntry(baseSyncable, mine, toSyncable(theirs), new Set());
            mine = merged; // carry the merged intent forward as "mine" for any further retry
            setEntries((prev) => prev.map((e) => (e.id === id ? keepRecipeIdentity(e, { ...theirs, ...merged }) : e)));
            // Resubmit against the version the server just told us about —
            // the whole point of the retry — not the version we started with.
            body = { ...merged, ifVersion: theirs.version };
            continue;
          }
          // Roll back the optimistic update; surface the failure.
          setEntries((prev) => prev.map((e) => (e.id === id && original ? original : e)));
          setError(err.message || 'Could not save that change.');
          throw err;
        }
      }
    },
    [entries, getEntry]
  );

  const remove = useCallback(async (id: string) => {
    const before = entries;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await apiDeleteEntry(id);
    } catch (e) {
      setEntries(before);
      setError((e as Error).message || 'Could not delete that recipe.');
      throw e;
    }
  }, [entries]);

  const value = useMemo<LibraryState>(
    () => ({ entries, loading, error, refresh, getEntry, saveRecipe, update, remove, draft, setDraft }),
    [entries, loading, error, refresh, getEntry, saveRecipe, update, remove, draft]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryState {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside a LibraryProvider.');
  return ctx;
}
