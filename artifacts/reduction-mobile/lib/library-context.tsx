/**
 * lib/library-context.tsx — the signed-in account's saved recipes.
 *
 * A thin React layer over lib/syncEngine.ts, which owns the write path: the
 * per-entry queue, the diff-only PATCH with ifVersion, the 409 three-way
 * merge, the refresh reconciliation and the notices. This file owns what
 * the screen sees — `entries` — and the three ways it changes: an edit
 * here (optimistic, then handed to the engine), the engine handing back a
 * merge or a failure, and a refresh.
 *
 * THE FOCUS REFETCH IS AN AppState LISTENER. The web refetches on window
 * focus; the phone that comes back to the foreground learns about the
 * laptop's cooking BEFORE its next write, instead of colliding with it.
 * The Library tab's focus effect calls the same `refresh`.
 *
 * WRITES ARE CONFIRMED, NOT ASSUMED. A failure rolls the entry back to the
 * last version the server accepted (or drops it, for a create that never
 * landed) and sets `notice`, which the recipe screen shows until dismissed.
 * Nothing here ever pretends a write happened.
 *
 * There is no anonymous X-Owner-Key library on mobile (sign-in is required
 * before any save), so there is nothing to migrate and nothing to claim.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Recipe } from '@/shared/layout';
import type { OrderPreference } from '@/shared/sequence';
import {
  createEntry as apiCreateEntry,
  deleteEntry as apiDeleteEntry,
  patchEntry as apiPatchEntry,
  type Entry,
  loadLibrary,
  newEntryId,
  type StepTimer,
} from './api';
import { createSyncEngine, type EngineApi, type SyncEngine } from './syncEngine';
import { clearLibraryCache, readLibraryCache, writeLibraryCache } from './libraryCache';
import { useAuth } from './auth-context';

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

export interface LibraryNotice {
  id: string;
  kind: 'tree_conflict' | 'remote_update' | 'failure';
  message: string;
}

interface LibraryState {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getEntry: (id: string) => Entry | undefined;
  saveRecipe: (recipe: Recipe) => Promise<Entry>;
  update: (id: string, patch: EntryPatch) => void;
  remove: (id: string) => Promise<void>;
  /** The latest thing the sync path had to say — a lost conflict, a
   *  remote change, a refused write. Shown by the screen it concerns. */
  notice: LibraryNotice | null;
  clearNotice: () => void;
  draft: { recipe: Recipe; sourceUrl?: string | null } | null;
  setDraft: (draft: { recipe: Recipe; sourceUrl?: string | null } | null) => void;
}

const LibraryContext = createContext<LibraryState | null>(null);

/** lib/api.ts as the engine's transport. ApiError already carries `status`
 *  and, on a 409, the server's `entry`. */
const transport: EngineApi<Entry> = {
  list: async () => (await loadLibrary()).entries,
  create: async (e) =>
    (await apiCreateEntry({ id: e.id, recipe: e.recipe, done: e.done, servings: e.servings, mode: e.mode, timer: e.timer })).entry,
  patch: async (id, body) => (await apiPatchEntry(id, body)).entry,
  remove: async (id) => {
    await apiDeleteEntry(id);
  },
};

/**
 * The server echoes the whole row after every write, as a fresh parse. If
 * that parse replaced `recipe` on the entry, every consumer keyed on the
 * recipe's identity — DiagramView's layout, cells and rects — would rebuild
 * on every round trip. An unchanged recipe keeps the object the device holds.
 */
function keepRecipeIdentity(prev: Entry | undefined, next: Entry): Entry {
  if (!prev || prev.recipe === next.recipe) return next;
  return JSON.stringify(prev.recipe) === JSON.stringify(next.recipe) ? { ...next, recipe: prev.recipe } : next;
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [entries, setEntries] = useState<Entry[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  entriesRef.current = entries;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const [draft, setDraft] = useState<{ recipe: Recipe; sourceUrl?: string | null } | null>(null);

  const replaceEntry = useCallback((next: Entry) => {
    setEntries((prev) => prev.map((e) => (e.id === next.id ? keepRecipeIdentity(e, next) : e)));
  }, []);

  const engineRef = useRef<SyncEngine<Entry> | null>(null);
  if (!engineRef.current) {
    engineRef.current = createSyncEngine<Entry>(transport, {
      onReplaced: (entry) => replaceEntry(entry),
      onNotice: (n) => setNotice({ id: n.id, kind: n.kind, message: n.message }),
      onFailure: (f) => {
        if (f.accepted) {
          const accepted = f.accepted;
          setEntries((prev) => prev.map((e) => (e.id === f.id ? keepRecipeIdentity(e, accepted) : e)));
        } else if (f.kind === 'create') {
          setEntries((prev) => prev.filter((e) => e.id !== f.id));
        }
        // A delete that failed: the row is still there, so it comes back.
        if (f.kind === 'delete' && f.accepted) {
          const back = f.accepted;
          setEntries((prev) => (prev.some((e) => e.id === f.id) ? prev : [back, ...prev]));
        }
        const what = f.kind === 'delete' ? 'Could not delete that recipe' : f.kind === 'create' ? 'Could not save that recipe' : 'That change could not be saved';
        const why = f.details?.length ? f.details[0] : f.message;
        setNotice({ id: f.id, kind: 'failure', message: `${what} (${why}). ${f.kind === 'delete' ? 'It is still here.' : 'It has been undone.'}` });
      },
      onSyncedChange: (synced) => {
        if (userId) void writeLibraryCache(userId, synced);
      },
    });
  }
  const engine = engineRef.current;

  /** The full reconcile: what the server has, merged with what is here. */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await engine.refresh(entriesRef.current);
      setEntries((prev) => next.map((e) => keepRecipeIdentity(prev.find((p) => p.id === e.id), e)));
    } catch (e) {
      setError((e as Error).message || 'Could not load your recipes.');
    } finally {
      setLoading(false);
    }
  }, [engine]);

  // Launch, and every account change: the cache first (instant, readable
  // offline), then the network.
  useEffect(() => {
    let cancelled = false;
    engine.reset();
    setEntries([]);
    setNotice(null);
    if (!userId) return;
    (async () => {
      const cached = await readLibraryCache(userId);
      if (cancelled) return;
      if (cached?.length) {
        engine.hydrate(cached);
        setEntries(cached);
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, engine, refresh]);

  // The focus refetch: coming back to the foreground re-reads the library
  // before the next write can collide with what happened elsewhere.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [userId, refresh]);

  const getEntry = useCallback((id: string) => entries.find((e) => e.id === id), [entries]);

  const saveRecipe = useCallback(
    async (recipe: Recipe): Promise<Entry> => {
      // Awaited rather than queued: the draft screen navigates to the saved
      // id, which has to exist first.
      const { entry } = await apiCreateEntry({ id: newEntryId(), recipe, mode: 'diagram' });
      engine.hydrate([entry]);
      setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
      return entry;
    },
    [engine]
  );

  const update = useCallback(
    (id: string, patch: EntryPatch) => {
      const current = entriesRef.current.find((e) => e.id === id);
      if (!current) return;
      const next = { ...current, ...patch } as Entry;
      setEntries((prev) => prev.map((e) => (e.id === id ? next : e)));
      engine.save(next);
    },
    [engine]
  );

  const remove = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      engine.remove(id);
    },
    [engine]
  );

  // Sign-out: nothing of this account stays on disk.
  const prevUser = useRef<string | null>(null);
  useEffect(() => {
    if (prevUser.current && !userId) void clearLibraryCache(prevUser.current);
    prevUser.current = userId;
  }, [userId]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<LibraryState>(
    () => ({ entries, loading, error, refresh, getEntry, saveRecipe, update, remove, notice, clearNotice, draft, setDraft }),
    [entries, loading, error, refresh, getEntry, saveRecipe, update, remove, notice, clearNotice, draft]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryState {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside a LibraryProvider.');
  return ctx;
}
