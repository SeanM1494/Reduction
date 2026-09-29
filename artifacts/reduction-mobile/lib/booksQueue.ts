/**
 * lib/booksQueue.ts — the account's books on the phone, and their write
 * path: ONE versioned document (api-server routes/books.ts) with the same
 * rules the recipe engine keeps (lib/syncEngine.ts, CLAUDE.md "Sync"):
 *
 *  - One write in flight; edits made meanwhile wait and go next, as the
 *    newest state.
 *  - A write carries the version it was computed from. A 409 comes back
 *    WITH the server's list, and the phone three-way merges (recipe-model
 *    mergeBooks: base = the last list the server accepted) and sends again.
 *    The server never merges.
 *  - Offline is a window: an edit the NETWORK refused stays on screen and
 *    is retried on foreground and on an interval, and only past
 *    OFFLINE_WINDOW_MS does it roll back and say so. A refusal with a
 *    status (a 422) rolls back at once.
 *  - DELETE AND MERGE ARE NEVER DEFERRED, as the recipe engine never defers
 *    a delete: `editOnline` sends at once and, if the network is not there,
 *    changes nothing and says OFFLINE_DELETE_MESSAGE. A deletion that sat in
 *    a queue would show recipes moving books on this phone that no other
 *    device, and possibly no server, will ever agree to.
 *
 * Without books on the server (503 `books_unavailable`, the DDL not run)
 * the list is today's seven and nothing can be edited.
 *
 * PURE: no react-native, no `@/` alias, no fetch — the transport is passed
 * in, and booksQueue.test.ts drives it against an in-memory server.
 */

import { freshDefaultBooks, mergeBooks, type BookDef } from '@workspace/recipe-model';
import { OFFLINE_WINDOW_MS, isNetworkFailure } from './syncEngine';

export const OFFLINE_DELETE_MESSAGE = 'Connect to the internet to delete or merge books.';
export const UNAVAILABLE_MESSAGE = 'Recipe books aren’t available yet. Try again later.';
const UNDONE_MESSAGE = 'Your changes to your books could not be saved, so they have been undone.';

export interface BooksDocument {
  books: BookDef[];
  version: number;
}

export interface BooksTransport {
  load(): Promise<BooksDocument>;
  /** Throws a value with `status` (and on a 409, `body: { books, version }`);
   *  a throw with no status is the network. */
  put(books: BookDef[], ifVersion: number): Promise<BooksDocument>;
}

export interface BooksState {
  /** Everything, tombstones included: resolution needs them. */
  books: BookDef[];
  /** True once the server has answered with books; false when it has none
   *  (503); null before anything is known. */
  available: boolean | null;
  /** An edit is waiting for the network. */
  queued: boolean;
}

export interface BooksEvents {
  onChange(state: BooksState): void;
  /** A change was refused or gave up waiting, and has been undone. */
  onFailure?(message: string): void;
}

const MAX_CONFLICT_RETRIES = 3;
const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
};
const conflictBody = (e: unknown): BooksDocument | null => {
  const b = (e as { body?: { books?: unknown; version?: unknown } })?.body;
  return b && Array.isArray(b.books) && typeof b.version === 'number' ? { books: b.books as BookDef[], version: b.version } : null;
};

export function createBooksQueue(api: BooksTransport, events: BooksEvents, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  /** The last list the server accepted — the merge base. */
  let synced: BooksDocument | null = null;
  let current: BookDef[] = freshDefaultBooks();
  let available: boolean | null = null;
  /** `current` has edits the server has not accepted. */
  let dirty = false;
  let firstFailureAt: number | null = null;
  let deferred = false;
  let chain: Promise<unknown> = Promise.resolve();

  const state = (): BooksState => ({ books: current, available, queued: deferred });
  const emit = () => events.onChange(state());
  /** Run after whatever is in flight: one write at a time. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };

  const rollback = (message: string) => {
    current = synced ? synced.books : freshDefaultBooks();
    dirty = false;
    deferred = false;
    firstFailureAt = null;
    emit();
    events.onFailure?.(message);
  };

  /** Send `current` until it is accepted, merged in, deferred or refused. */
  const flush = (): Promise<void> =>
    serial(async () => {
      for (let attempt = 0; dirty && synced && attempt <= MAX_CONFLICT_RETRIES; attempt++) {
        const sending = current;
        const base = synced;
        try {
          const doc = await api.put(sending, base.version);
          synced = doc;
          // Edits made while this was in flight are kept, on top of what
          // the server now holds.
          current = current === sending ? doc.books : mergeBooks(sending, current, doc.books);
          dirty = current !== doc.books;
          deferred = false;
          firstFailureAt = null;
          emit();
          if (!dirty) return;
        } catch (e) {
          const theirs = statusOf(e) === 409 ? conflictBody(e) : null;
          if (theirs) {
            current = mergeBooks(base.books, current, theirs.books);
            synced = theirs;
            emit();
            continue;
          }
          if (isNetworkFailure(e)) {
            firstFailureAt ??= now();
            if (now() - firstFailureAt >= OFFLINE_WINDOW_MS) return rollback(UNDONE_MESSAGE);
            deferred = true;
            emit();
            return;
          }
          return rollback(statusOf(e) === 503 ? UNAVAILABLE_MESSAGE : UNDONE_MESSAGE);
        }
      }
      if (dirty) rollback(UNDONE_MESSAGE);
    });

  return {
    state,

    /** A list read from this device's cache at launch: shown at once, and
     *  a merge base the next write can use. */
    hydrate(doc: BooksDocument) {
      synced = doc;
      current = doc.books;
      available = true;
      emit();
    },

    /** The focus refetch. Edits waiting here are merged over what the
     *  server has, and sent. */
    load: (): Promise<void> =>
      serial(async () => {
        try {
          const doc = await api.load();
          available = true;
          current = dirty ? mergeBooks(synced?.books ?? null, current, doc.books) : doc.books;
          synced = doc;
          emit();
        } catch (e) {
          if (statusOf(e) === 503) {
            available = false;
            synced = null;
            current = freshDefaultBooks();
            dirty = false;
            deferred = false;
            emit();
          }
          // The network: keep whatever this device already had.
        }
      }).then(() => (dirty ? flush() : undefined)),

    /** Add, rename, recolour, reorder: shown at once, sent through the
     *  queue, merged on a 409, kept through an offline window. `edit` may
     *  throw a BookEditError (a clash, the cap), which the caller shows. */
    edit(change: (books: BookDef[]) => BookDef[]) {
      if (available !== true) throw Object.assign(new Error(UNAVAILABLE_MESSAGE), { unavailable: true });
      current = change(current);
      dirty = true;
      emit();
      void flush();
    },

    /**
     * Delete or merge: sent now, never queued. With no network — or with
     * edits already waiting for it — nothing changes and the answer is
     * OFFLINE_DELETE_MESSAGE. A 409 merges and sends again, as any write.
     */
    editOnline: (change: (books: BookDef[]) => BookDef[]): Promise<{ ok: true } | { ok: false; message: string }> =>
      serial(async () => {
        if (available !== true || !synced) return { ok: false as const, message: available === false ? UNAVAILABLE_MESSAGE : OFFLINE_DELETE_MESSAGE };
        if (deferred || dirty) return { ok: false as const, message: OFFLINE_DELETE_MESSAGE };
        let next: BookDef[];
        try {
          next = change(current);
        } catch (e) {
          return { ok: false as const, message: (e as Error).message };
        }
        let base = synced;
        for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
          try {
            const doc = await api.put(next, base.version);
            synced = doc;
            current = doc.books;
            emit();
            return { ok: true as const };
          } catch (e) {
            const theirs = statusOf(e) === 409 ? conflictBody(e) : null;
            if (theirs) {
              next = mergeBooks(base.books, next, theirs.books);
              base = theirs;
              synced = theirs;
              current = theirs.books;
              emit();
              continue;
            }
            if (isNetworkFailure(e)) return { ok: false as const, message: OFFLINE_DELETE_MESSAGE };
            return { ok: false as const, message: (e as Error).message || UNDONE_MESSAGE };
          }
        }
        return { ok: false as const, message: UNDONE_MESSAGE };
      }),

    /** Foreground and interval: send what was waiting for the network. */
    retry(): Promise<void> {
      return dirty ? flush() : Promise.resolve();
    },

    /** Sign-out, or a different account. */
    reset() {
      synced = null;
      current = freshDefaultBooks();
      available = null;
      dirty = false;
      deferred = false;
      firstFailureAt = null;
      emit();
    },
  };
}

export type BooksQueue = ReturnType<typeof createBooksQueue>;
