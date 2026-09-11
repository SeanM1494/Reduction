/**
 * lib/libraryView.ts — how the library is filtered and sorted.
 *
 * PURE: no react-native, no `@/` alias, so `libraryView.test.ts` runs under
 * plain node in scripts/run-tests.mjs. Imports the model package directly for
 * the same reason.
 *
 * Mirrors the web's MyRecipes.tsx, which carries the same logic inline. The
 * two are kept identical by hand for now; if a third home appears, this
 * belongs in lib/recipe-model beside `countAll`.
 */

import {
  MEAL_TYPES,
  primaryMealType,
  sanitizeMealTypes,
  stepMinutes,
  type MealType,
} from '@workspace/recipe-model';

/** The slice of an Entry these helpers read — kept structural so the test
 *  can build fixtures without the whole api.ts shape. */
export interface LibraryItem {
  savedAt: number;
  cooked?: number[] | null;
  rating?: number | null;
  recipe: {
    source?: string | null;
    mealTypes?: string[];
    sections?: Array<{ nodes?: Array<{ minutes?: unknown }> }>;
  };
}

export type SortKey = 'added' | 'cooked' | 'time' | 'source' | 'type' | 'rating';
export type Filter = MealType | 'all' | 'untagged' | 'favourites';

/** `added` stays first and therefore stays the default (see MyRecipes.tsx:
 *  favourites-first has no data behind it yet). */
export const SORTS: Array<[SortKey, string]> = [
  ['added', 'Recently added'],
  ['cooked', 'Recently cooked'],
  ['time', 'Total time'],
  ['source', 'Source'],
  ['type', 'Meal type'],
  ['rating', 'Favourites first'],
];

export const sortLabel = (key: SortKey): string =>
  SORTS.find(([k]) => k === key)?.[1] ?? SORTS[0][1];

/** Sum of every step's minutes — the honest lower bound on hands-on-to-done.
 *  Null when no step carries a time, which sorts after everything timed. */
export function totalMinutes(entry: LibraryItem): number | null {
  let sum = 0;
  let any = false;
  for (const s of entry.recipe.sections ?? []) {
    for (const n of s.nodes ?? []) {
      const m = stepMinutes(n.minutes);
      if (m != null) {
        sum += m;
        any = true;
      }
    }
  }
  return any ? sum : null;
}

export const lastCooked = (e: LibraryItem): number =>
  e.cooked && e.cooked.length ? Math.max(...e.cooked) : 0;

export const ratingOf = (e: LibraryItem): number => (typeof e.rating === 'number' ? e.rating : 0);

/** Which of the eight are worth offering: a chip that filters to nothing is
 *  a dead end, so only types the library actually contains are listed. */
export function presentMealTypes(library: LibraryItem[]): MealType[] {
  const present = new Set<MealType>();
  for (const e of library) for (const t of sanitizeMealTypes(e.recipe.mealTypes)) present.add(t);
  return MEAL_TYPES.filter((t) => present.has(t));
}

export const hasFavourites = (library: LibraryItem[]): boolean =>
  library.some((e) => ratingOf(e) === 1);

export const hasUntagged = (library: LibraryItem[]): boolean =>
  library.some((e) => sanitizeMealTypes(e.recipe.mealTypes).length === 0);

export function matchesFilter(e: LibraryItem, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'favourites') return ratingOf(e) === 1;
  const types = sanitizeMealTypes(e.recipe.mealTypes);
  if (filter === 'untagged') return types.length === 0;
  // The primary drives sorting and display; ALL types widen filters.
  return types.includes(filter);
}

const LAST = '￿';

const COMPARE: Record<SortKey, (a: LibraryItem, b: LibraryItem) => number> = {
  added: (a, b) => b.savedAt - a.savedAt,
  cooked: (a, b) => lastCooked(b) - lastCooked(a),
  time: (a, b) => {
    const ta = totalMinutes(a);
    const tb = totalMinutes(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  },
  source: (a, b) => (a.recipe.source ?? LAST).localeCompare(b.recipe.source ?? LAST),
  type: (a, b) =>
    (primaryMealType(a.recipe.mealTypes) ?? LAST).localeCompare(
      primaryMealType(b.recipe.mealTypes) ?? LAST
    ),
  // Favourites, then unrated, then the rejects — and within each, the most
  // recently added. A 👎 recipe is not hidden by this sort, only ranked last;
  // hiding it would make it unfindable.
  rating: (a, b) => ratingOf(b) - ratingOf(a) || b.savedAt - a.savedAt,
};

/** Filter then sort; never mutates the input. */
export function arrangeLibrary<T extends LibraryItem>(library: T[], filter: Filter, sort: SortKey): T[] {
  return library.filter((e) => matchesFilter(e, filter)).sort(COMPARE[sort]);
}

export function progressOf(done: number, total: number): { pct: number; label: string } {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { pct, label: pct === 0 ? 'Not started' : pct === 100 ? 'Done' : `${pct}%` };
}
