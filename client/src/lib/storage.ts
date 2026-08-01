/**
 * client/src/lib/storage.ts — persistence adapter.
 *
 * Everything in the app goes through loadLibrary / saveLibrary. To move
 * storage to Postgres later, rewrite these two functions to call your API and
 * nothing else has to change.
 */

import type { Recipe } from "../../../shared/layout";

export interface Entry {
  id: string;
  recipe: Recipe;
  /** Ids of completed ingredients and steps. */
  done: string[];
  /** Null when the source never stated a serving count. */
  servings: number | null;
  savedAt: number;
}

const KEY = "logic-cooking:library:v1";

export function loadLibrary(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

export function saveLibrary(entries: Entry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Private browsing or a full quota. The session still works in memory.
  }
}
