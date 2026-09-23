/**
 * lib/recipeBox.ts — the Recipe Box's rules, with nothing drawn: which book a
 * recipe lives in, the order of a book's pages, its spreads, what a page
 * says, and the thresholds of a page turn. PURE — no react-native, no `@/`
 * alias — so the runner tests every rule here, and the components only draw
 * what these functions decide.
 *
 * A book is a DISPLAY GROUPING over the meal types, never a second tagging
 * system: a recipe is in the book of its PRIMARY meal type (the first
 * element of `recipe.mealTypes`), so it is in exactly one book, and the page
 * counts and turns depend on that. Nothing is stored about books.
 */

import {
  componentIngredientIds,
  formatMinutes,
  primaryMealType,
  recipeTotalMinutes,
  type MealType,
  type Recipe,
} from '@workspace/recipe-model';
import { arrangeLibrary, ratingOf, type LibraryItem, type SortKey } from './libraryView';

export type BookId = 'breakfast' | 'lunch' | 'dinner' | 'apps' | 'salads' | 'desserts' | 'other';

export interface Book {
  id: BookId;
  name: string;
  /** The cover, tab and accent. Every one carries 11px white tab text at
   *  4.5:1 or better in both themes (the covers do not follow the theme —
   *  a book is an object, like its cream pages). The prototype's hues,
   *  darkened in lightness only where they fell short (ROADMAP). */
  color: string;
}

/** The shelf, in order. The carousel loops through the ones with recipes. */
export const BOOKS: readonly Book[] = [
  { id: 'breakfast', name: 'Breakfast', color: '#986d29' },
  { id: 'lunch', name: 'Lunch', color: '#657c51' },
  { id: 'dinner', name: 'Dinner', color: '#a94f3a' },
  { id: 'apps', name: 'Apps & Snacks', color: '#477d7b' },
  { id: 'salads', name: 'Salads', color: '#5a7f43' },
  { id: 'desserts', name: 'Desserts', color: '#8e4f6f' },
  { id: 'other', name: 'Other', color: '#6a6575' },
];

const BOOK_OF_TYPE: Record<MealType, BookId> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'apps',
  salad: 'salads',
  dessert: 'desserts',
  side: 'other',
  drink: 'other',
  baking: 'other',
};

export const bookById = (id: BookId): Book => BOOKS.find((b) => b.id === id)!;

/** The book a recipe lives in: its primary meal type's, or Other. */
export function bookOf(entry: LibraryItem): BookId {
  const t = primaryMealType(entry.recipe.mealTypes);
  return t ? BOOK_OF_TYPE[t] : 'other';
}

/**
 * One book's pages, in order: the person's sort, except that every 👎 goes to
 * the back, after everything else — whatever the sort. Changing a 👎 to
 * anything else puts it straight back in its sorted place, because nothing
 * here is stored: the order is derived every time.
 */
export function arrangeBook<T extends LibraryItem>(entries: T[], book: BookId, sort: SortKey): T[] {
  const sorted = arrangeLibrary(
    entries.filter((e) => bookOf(e) === book),
    'all',
    sort
  );
  return [...sorted.filter((e) => ratingOf(e) !== -1), ...sorted.filter((e) => ratingOf(e) === -1)];
}

/** The books that have recipes, in shelf order, each with its pages. Empty
 *  books are left off the shelf entirely. */
export function shelf<T extends LibraryItem>(entries: T[], sort: SortKey): Array<{ book: Book; pages: T[] }> {
  return BOOKS.map((book) => ({ book, pages: arrangeBook(entries, book.id, sort) })).filter((b) => b.pages.length > 0);
}

// ---------------------------------------------------------------- spreads --

/** A spread is two pages: pages 2k and 2k+1. An odd book ends on a blank. */
export const spreadCount = (pages: number): number => Math.max(1, Math.ceil(pages / 2));
export const spreadOfPage = (index: number): number => Math.floor(index / 2);
export const clampSpread = (k: number, pages: number): number => Math.min(Math.max(0, k), spreadCount(pages) - 1);

/** "Pages 3–4 of 7"; "Page 7 of 7" when the right-hand page is the blank. */
export function pagesLabel(k: number, pages: number): string {
  if (pages <= 0) return 'No recipes yet';
  const left = 2 * k + 1;
  const right = Math.min(2 * k + 2, pages);
  return left >= right ? `Page ${left} of ${pages}` : `Pages ${left}–${right} of ${pages}`;
}

// ------------------------------------------------------------ page content --

/**
 * The first few ingredients in recipe order — no ranking is invented — each
 * named once, and never a section's finished result ("Dry ingredients" in a
 * Dough section is not something you buy): that is componentIngredientIds,
 * the same rule the cooking order uses, not a copy of it.
 */
export function keyIngredients(recipe: Recipe, max = 3): { names: string[]; more: number } {
  const skip = componentIngredientIds(recipe);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const section of recipe.sections ?? []) {
    for (const ing of section.ingredients ?? []) {
      if (skip.has(ing.id)) continue;
      const name = (ing.name ?? '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return { names: names.slice(0, max), more: Math.max(0, names.length - max) };
}

export function stepCount(recipe: Recipe): number {
  return (recipe.sections ?? []).reduce((n, s) => n + (s.nodes?.length ?? 0), 0);
}

/** The time line, or null to hide it — the recipe's STATED total, never a
 *  sum of steps (recipe-model totalTime.ts). */
export const timeLine = (recipe: unknown): string | null => formatMinutes(recipeTotalMinutes(recipe));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ms: number): string => {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

/** "Cooked 3× · Sep 11", or on a narrow page "3× · Sep 11" (the pill's tint
 *  says "cooked"). Null when it has never been cooked — the page then says
 *  "Not cooked yet" in grey. */
export function cookedLabel(cooked: number[] | null | undefined, short = false): string | null {
  const list = (cooked ?? []).filter((t) => typeof t === 'number' && Number.isFinite(t));
  if (!list.length) return null;
  const last = shortDate(Math.max(...list));
  return short ? `${list.length}× · ${last}` : `Cooked ${list.length}× · ${last}`;
}

/** "last Sep 11" for the preview line. */
export const lastCookedDate = (cooked: number[] | null | undefined): string | null => {
  const list = (cooked ?? []).filter((t) => typeof t === 'number' && Number.isFinite(t));
  return list.length ? shortDate(Math.max(...list)) : null;
};

/**
 * Below this page width (an iPhone SE's is 141px) the tuned page does not
 * fit: measured on the prototype, 19 of 31 pages put the cooked pill on the
 * page number. There, ingredients get one line and the pill the short label
 * — unless the recipe has no stated time, whose hidden line gives the
 * ingredients their second line back (0 collisions either way, measured).
 */
export const NARROW_PAGE_PX = 160;

export function pageLayout(pageWidth: number, hasTime: boolean): { narrow: boolean; ingredientLines: 1 | 2; shortPill: boolean } {
  const narrow = pageWidth < NARROW_PAGE_PX;
  return { narrow, ingredientLines: narrow && hasTime ? 1 : 2, shortPill: narrow };
}

const RATING_WORDS: Record<string, string> = { '1': 'rated thumbs up', '0': 'rated OK', '-1': 'rated thumbs down' };
export const RATING_EMOJI: Record<string, string> = { '1': '👍', '0': '👌', '-1': '👎' };

/** What VoiceOver reads for a page: one element, the facts that matter. */
export function pageA11yLabel(title: string, bookName: string, recipe: unknown, rating: number | null | undefined): string {
  const parts = [title || 'Untitled recipe', bookName];
  const time = timeLine(recipe);
  if (time) parts.push(time);
  if (rating === 1 || rating === 0 || rating === -1) parts.push(RATING_WORDS[String(rating)]);
  return parts.join(', ');
}

// -------------------------------------------------------------- page turn --

/**
 * The page turn's feel, tuned on the prototype. Called from gesture worklets
 * on the UI thread — hence the directive, an inert string under the test
 * runner — so the commit decision never waits for the JS thread.
 */
export const FLIP = {
  /** A full turn is this fraction of the book's width of finger travel. */
  travel: 0.85,
  commitAt: 0.4,
  flickMs: 300,
  flickPx: 40,
  flickMinProgress: 0.06,
  /** Past the first or last spread the spread moves this much of the drag. */
  edgeRubber: 0.12,
  /** Movement before a drag is read as horizontal or vertical. */
  axisLockPx: 8,
} as const;

/** How far through a turn a drag of `dx` is, 0–1, in the turn's direction
 *  (+1 forward, dragged left; −1 back, dragged right). */
export function flipProgress(dx: number, dir: 1 | -1, bookWidth: number): number {
  'worklet';
  const p = (dir > 0 ? -dx : dx) / (bookWidth * 0.85);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Past 40%, or a flick (under 300ms, over 40px) past 6%. */
export function flipCommits(progress: number, elapsedMs: number, dx: number): boolean {
  'worklet';
  const flick = elapsedMs < 300 && Math.abs(dx) > 40;
  return progress > 0.4 || (flick && progress > 0.06);
}

/** Settle time: the rest of the way at 460ms per turn plus 140, or back at
 *  360 plus 120. Short hops are quick; nothing is instant. */
export function flipSettleMs(progress: number, commit: boolean): number {
  'worklet';
  return commit ? (1 - progress) * 460 + 140 : progress * 360 + 120;
}
