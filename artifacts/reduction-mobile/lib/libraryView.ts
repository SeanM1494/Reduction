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
  isTopRated,
  starsOf,
  primaryMealType,
  recipeTotalMinutes,
  notesMatch,
  sanitizeMealTypes,
  type MealType,
  type RecipeNotes,
} from '@workspace/recipe-model';

/** The slice of an Entry these helpers read — kept structural so the test
 *  can build fixtures without the whole api.ts shape. */
export interface LibraryItem {
  savedAt: number;
  cooked?: number[] | null;
  rating?: number | null;
  /** The five-star rating (recipe-model stars.ts); read through `starsOf`. */
  stars?: number | null;
  /** The person's own notes; search reads them (recipe-model notes.ts). */
  notes?: RecipeNotes | null;
  recipe: {
    title?: string;
    source?: string | null;
    mealTypes?: string[];
    /** The stated total time; read only through `totalMinutes`. */
    totalMinutes?: unknown;
    sections?: Array<{ nodes?: Array<{ minutes?: unknown }>; ingredients?: Array<{ name?: string }> }>;
  };
}

/**
 * Is this entry in the recipe box, or was it taken out? The server already
 * leaves removed recipes out of the library list; this is the client's half,
 * for the moments that list is not the whole story — a removal made here and
 * not yet confirmed, an offline write to a recipe another device removed
 * (its reply carries the row, `removedAt` and all), and a cache written
 * before the removal. Absent reads as "in the box": entries from a cache or
 * a server that predate the field are not removed.
 */
export const inRecipeBox = (e: { removedAt?: number | null }): boolean => e.removedAt == null;

export type SortKey = 'added' | 'cooked' | 'time' | 'source' | 'type' | 'rating';
export type Filter = MealType | 'all' | 'untagged' | 'top';

/** `added` stays first and therefore stays the default (see MyRecipes.tsx:
 *  rating-first has no data behind it yet). */
export const SORTS: Array<[SortKey, string]> = [
  ['added', 'Recently added'],
  ['cooked', 'Recently cooked'],
  ['time', 'Total time'],
  ['source', 'Source'],
  ['type', 'Meal type'],
  ['rating', 'Highest rated'],
];

export const sortLabel = (key: SortKey): string =>
  SORTS.find(([k]) => k === key)?.[1] ?? SORTS[0][1];

/**
 * The recipe's total time as its SOURCE stated it, or null — and null means
 * the card shows no time at all (recipe-model totalTime.ts). It used to be
 * the sum of the timed steps, which is not a total and read as one: on a
 * "30-Minute Mongolian Beef" it said "2 min". The step times still drive
 * timers and Cook mode; they are just never presented as this number.
 * Null sorts after everything with a stated time.
 */
export function totalMinutes(entry: LibraryItem): number | null {
  return recipeTotalMinutes(entry.recipe);
}

export const lastCooked = (e: LibraryItem): number =>
  e.cooked && e.cooked.length ? Math.max(...e.cooked) : 0;

/** Stars for ordering: unrated sits in the middle (3), where an unrated recipe
 *  always sat between the 👍s and the 👎s. */
export const sortStars = (e: LibraryItem): number => starsOf(e) ?? 3;

/** Which of the eight are worth offering: a chip that filters to nothing is
 *  a dead end, so only types the library actually contains are listed. */
export function presentMealTypes(library: LibraryItem[]): MealType[] {
  const present = new Set<MealType>();
  for (const e of library) for (const t of sanitizeMealTypes(e.recipe.mealTypes)) present.add(t);
  return MEAL_TYPES.filter((t) => present.has(t));
}

export const hasTopRated = (library: LibraryItem[]): boolean => library.some(isTopRated);

export const hasUntagged = (library: LibraryItem[]): boolean =>
  library.some((e) => sanitizeMealTypes(e.recipe.mealTypes).length === 0);

export function matchesFilter(e: LibraryItem, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'top') return isTopRated(e);
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
  // Most stars first, unrated among the 3s, the 1-2s last — and within each
  // star count, the most recently added. A low-rated recipe is not hidden by
  // this sort, only ranked last; hiding it would make it unfindable.
  rating: (a, b) => sortStars(b) - sortStars(a) || b.savedAt - a.savedAt,
};

/** Filter then sort; never mutates the input. */
export function arrangeLibrary<T extends LibraryItem>(library: T[], filter: Filter, sort: SortKey): T[] {
  return library.filter((e) => matchesFilter(e, filter)).sort(COMPARE[sort]);
}

export function progressOf(done: number, total: number): { pct: number; label: string } {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { pct, label: pct === 0 ? 'Not started' : pct === 100 ? 'Done' : `${pct}%` };
}

/**
 * The library filtered by a typed query — the web SearchBar's `localMatches`:
 * title, source and ingredient names, case-insensitive substring, no
 * network. Empty or whitespace matches nothing, so the panel has something
 * to show only once there is something to look for.
 */
export function searchLibrary<T extends LibraryItem>(library: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return library.filter((e) => {
    const r = e.recipe;
    if ((r.title ?? '').toLowerCase().includes(needle)) return true;
    if (r.source && r.source.toLowerCase().includes(needle)) return true;
    if (notesMatch(e.notes, needle)) return true;
    return (r.sections ?? []).some((s) => (s.ingredients ?? []).some((i) => (i.name ?? '').toLowerCase().includes(needle)));
  });
}
