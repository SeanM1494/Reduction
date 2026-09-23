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
 * Nothing here ever pretends a write happened — except, deliberately, for
 * the engine's offline window: a write the NETWORK refused stays on screen
 * as `queued` and is retried on foreground and on an interval, and only
 * past the window does it roll back like any other failure.
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
  type PhotoMeta,
} from './api';
import { createSyncEngine, type EngineApi, type SyncEngine } from './syncEngine';
import { clearLibraryCache, readLibraryCache, writeLibraryCache } from './libraryCache';
import { inRecipeBox } from './libraryView';
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
  /** Out of the recipe box (a stamp) or back in (null). The server keeps
   *  its own stamp; what syncs is whether it is removed. */
  removedAt: number | null;
}>;

export interface LibraryNotice {
  id: string;
  kind: 'tree_conflict' | 'remote_update' | 'failure';
  message: string;
}

/** How often a write waiting for the network is tried again, on top of
 *  the foreground retry. Short enough to feel automatic across the
 *  kitchen's dead spot; the engine's window bounds how long it goes on. */
const OFFLINE_RETRY_MS = 10_000;

interface LibraryState {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getEntry: (id: string) => Entry | undefined;
  saveRecipe: (recipe: Recipe) => Promise<Entry>;
  update: (id: string, patch: EntryPatch) => void;
  /** The photo's meta, as the server reported it after an upload, a
   *  removal or a from-source fetch. Local only: the photo is server-owned
   *  and never rides a PATCH, so this does not touch the sync engine. */
  setPhoto: (id: string, photo: PhotoMeta | null) => void;
  remove: (id: string) => Promise<void>;
  /** Back into the box: a removed recipe's Undo, and (step 7) Settings'
   *  Restore. Takes the entry as it was when removed, because the list may
   *  no longer hold it — a refresh drops removed rows, the server leaving
   *  them out — and writes `removedAt: null` through the engine like any
   *  other change, adopting the row first if it had gone. */
  restore: (entry: Entry) => void;
  /** The latest thing the sync path had to say — a lost conflict, a
   *  remote change, a refused write. Shown by the screen it concerns. */
  notice: LibraryNotice | null;
  clearNotice: () => void;
  /** Entries with a write waiting for the network (the offline window).
   *  Their screens show the optimistic state and say it is waiting. */
  queued: string[];
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
  const [queued, setQueued] = useState<string[]>([]);
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
        // Never cache a removed recipe: the cache is what the shelf shows
        // first on the next launch, before the network has said anything.
        if (userId) void writeLibraryCache(userId, synced.filter(inRecipeBox));
      },
      onDeferredChange: (ids) => setQueued(ids),
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
      // Filtered on the way in as well as on the way out, for caches written
      // by a build that stored whatever it had.
      const cached = (await readLibraryCache(userId))?.filter(inRecipeBox);
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
  // before the next write can collide with what happened elsewhere — and
  // then sends whatever was waiting for the network, merged with what the
  // refetch found.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void refresh().then(() => engine.retry());
    });
    return () => sub.remove();
  }, [userId, refresh, engine]);

  // While anything is waiting for the network, try again every few
  // seconds. The engine gives up past its window, so this cannot run for
  // ever on a write that will never land.
  useEffect(() => {
    if (!queued.length) return;
    const id = setInterval(() => engine.retry(), OFFLINE_RETRY_MS);
    return () => clearInterval(id);
  }, [queued.length, engine]);

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

  const setPhoto = useCallback((id: string, photo: PhotoMeta | null) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, photo } : e)));
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      engine.remove(id);
    },
    [engine]
  );

  const restore = useCallback(
    (snapshot: Entry) => {
      const current = entriesRef.current.find((e) => e.id === snapshot.id);
      if (!current) engine.hydrate([snapshot]);
      const next = { ...(current ?? snapshot), removedAt: null } as Entry;
      setEntries((prev) => (prev.some((e) => e.id === next.id) ? prev.map((e) => (e.id === next.id ? next : e)) : [next, ...prev]));
      engine.save(next);
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

  // What every screen sees: the recipe box, without what was taken out.
  // The unfiltered list stays inside, because a removal is still a pending
  // write until the server confirms it, and the engine has to hold the entry
  // to send it (and to merge it if it meets a 409). `getEntry` reads the
  // unfiltered list, so a recipe removed while its screen is open does not
  // vanish out from under the person looking at it.
  const inBox = useMemo(() => entries.filter(inRecipeBox), [entries]);

  const value = useMemo<LibraryState>(
    () => ({ entries: inBox, loading, error, refresh, getEntry, saveRecipe, update,
      setPhoto, remove, restore, notice, clearNotice, queued, draft, setDraft }),
    [inBox, loading, error, refresh, getEntry, saveRecipe, update, setPhoto, remove, restore, notice, clearNotice, queued, draft]
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryState {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside a LibraryProvider.');
  return ctx;
}
