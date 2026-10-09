/**
 * lib/books-context.tsx — the signed-in account's recipe books, for every
 * screen that draws or chooses one.
 *
 * A thin React layer over lib/booksQueue.ts, which owns the write path (one
 * versioned document, the 409 merge, the offline window, and delete/merge
 * never queued). Here: the cache first at launch (so an offline start draws
 * the person's own books, not the seven defaults), the network after, the
 * foreground refetch, the interval retry while an edit waits, and one
 * resolver every screen uses to say which book a recipe is in.
 *
 * Signed out there is no provider state to speak of — the demo and the
 * sign-in screen never mount one — and without books on the server the
 * list is today's seven, `available` is false, and nothing can be edited.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { liveBooks, type BookDef } from '@/shared/books';
import { loadBooks, putBooks } from './api';
import { createBooksQueue, type BooksQueue, type BooksState, type BooksTransport } from './booksQueue';
import { clearBooksCache, readBooksCache, writeBooksCache } from './libraryCache';
import { bookById, bookOf, type Book } from './recipeBox';
import { useAuth } from './auth-context';
import type { LibraryItem } from './libraryView';

const RETRY_MS = 10_000;

interface BooksContextValue {
  /** Everything, tombstones included (resolution needs them). */
  books: BookDef[];
  /** The live books, in shelf order. */
  live: BookDef[];
  available: boolean | null;
  queued: boolean;
  /** Which book a recipe is in, resolved and ready to draw. */
  bookFor: (entry: LibraryItem & { book?: string | null }) => Book;
  /** Add, rename, recolor, reorder. Returns a sentence when it cannot
   *  (a clash, the cap, books not available), else null. */
  edit: (change: (books: BookDef[]) => BookDef[]) => string | null;
  /** Delete or merge: needs the network, says so when it is not there. */
  editOnline: (change: (books: BookDef[]) => BookDef[]) => Promise<string | null>;
  refresh: () => Promise<void>;
  /** A change the server refused or that gave up waiting. */
  failure: string | null;
  clearFailure: () => void;
}

const BooksContext = createContext<BooksContextValue | null>(null);

const transport: BooksTransport = { load: loadBooks, put: putBooks };

export function BooksProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<BooksState>({ books: [], available: null, queued: false });
  const [failure, setFailure] = useState<string | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;

  const queueRef = useRef<BooksQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = createBooksQueue(transport, {
      onChange: (st) => {
        setState(st);
        const uid = userRef.current;
        if (uid && st.available) void writeBooksCache(uid, { books: st.books, version: 0 });
      },
      onFailure: (m) => setFailure(m),
    });
  }
  const queue = queueRef.current;

  const refresh = useCallback(() => queue.load(), [queue]);

  // Launch and every account change: the cache (instant, offline), then the
  // network. The cached version is never trusted as a merge base — it is
  // stored as 0, so the first write after an offline start meets a 409, and
  // merges, rather than overwriting a list another device changed.
  useEffect(() => {
    let cancelled = false;
    queue.reset();
    if (!userId) return;
    (async () => {
      const cached = await readBooksCache(userId);
      if (cancelled) return;
      if (cached) queue.hydrate(cached);
      await queue.load();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, queue]);

  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void queue.load();
    });
    return () => sub.remove();
  }, [userId, queue]);

  useEffect(() => {
    if (!state.queued) return;
    const id = setInterval(() => void queue.retry(), RETRY_MS);
    return () => clearInterval(id);
  }, [state.queued, queue]);

  const prevUser = useRef<string | null>(null);
  useEffect(() => {
    if (prevUser.current && !userId) void clearBooksCache(prevUser.current);
    prevUser.current = userId;
  }, [userId]);

  const books = state.books.length ? state.books : queue.state().books;
  const value = useMemo<BooksContextValue>(
    () => ({
      books,
      live: liveBooks(books),
      available: state.available,
      queued: state.queued,
      bookFor: (entry) => bookById(bookOf(entry, books), books),
      edit: (change) => {
        try {
          queue.edit(change);
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },
      editOnline: async (change) => {
        const r = await queue.editOnline(change);
        return r.ok ? null : r.message;
      },
      refresh,
      failure,
      clearFailure: () => setFailure(null),
    }),
    [books, state.available, state.queued, queue, refresh, failure]
  );

  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}

export function useBooks(): BooksContextValue {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error('useBooks must be used inside a BooksProvider.');
  return ctx;
}
