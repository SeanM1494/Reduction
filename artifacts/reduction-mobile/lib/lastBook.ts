/**
 * lib/lastBook.ts — the Recipe Box's last-open book, on this device only,
 * per account, by the book's ID (so it survives custom books, renames and
 * reordering). A cold start that lands on the Recipe Box opens it there
 * (lib/opening/destination.ts); a book that has since gone falls back to
 * the first. Nothing here reaches the server.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (userId: string) => `reduction_last_book:${userId}`;

export async function readLastBook(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function writeLastBook(userId: string, bookId: string) {
  AsyncStorage.setItem(key(userId), bookId).catch(() => {});
}
