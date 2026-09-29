/**
 * lib/libraryCache.ts — the last acknowledged library, on disk.
 *
 * A cache of the sync engine's `lastSynced`, keyed by user, so the library
 * shows on launch before the network answers and is still readable on a
 * kitchen's dead wifi. It is a READ cache: writes still go to the server
 * and a failed one rolls back and says so (there is no offline write
 * queue — see ROADMAP, an open question). Because what is cached is the
 * acknowledged state, hydrating the engine from it is sound: a stale
 * cached ack costs one 409-merge, which is the machinery working.
 *
 * Cleared on sign-out, so one account's recipes never show to the next.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Entry } from './api';
import type { BookDef } from '@workspace/recipe-model';

const KEY = (userId: string) => `reduction_library_cache:${userId}`;

export async function readLibraryCache(userId: string): Promise<Entry[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Entry[]) : null;
  } catch {
    return null;
  }
}

export async function writeLibraryCache(userId: string, entries: Entry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(entries));
  } catch {
    // A full disk or a private mode: the next launch loads from the network
    // as it always did.
  }
}

export async function clearLibraryCache(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY(userId));
  } catch {
    // Nothing to do; the key is scoped by user, so a leftover is unreachable.
  }
}

// The account's books, beside its recipes: without them an offline launch
// would draw the shelf as the seven defaults and every custom book's
// recipes in the wrong place until the network answered.
const BOOKS_KEY = (userId: string) => `reduction_books_cache:${userId}`;

export async function readBooksCache(userId: string): Promise<{ books: BookDef[]; version: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(BOOKS_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.books) && typeof parsed.version === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeBooksCache(userId: string, doc: { books: BookDef[]; version: number }): Promise<void> {
  try {
    await AsyncStorage.setItem(BOOKS_KEY(userId), JSON.stringify(doc));
  } catch {
    // As for the recipes: the next launch asks the network.
  }
}

export async function clearBooksCache(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(BOOKS_KEY(userId));
  } catch {
    // Scoped by user; a leftover is unreachable.
  }
}
