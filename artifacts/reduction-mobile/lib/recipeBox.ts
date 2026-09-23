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
/** Always a whole spread: a fractional one draws the leaves half-turned, as
 *  two empty pages (the Sep 24 bug), so it is rounded here too. */
export const clampSpread = (k: number, pages: number): number =>
  Math.min(Math.max(0, Math.round(k)), spreadCount(pages) - 1);

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

// ---------------------------------------------------------------------------
// The preview sheet (tap a page).
// ---------------------------------------------------------------------------

/** How many ingredients the preview lists before "+N more": the page has
 *  room for three, the sheet for a couple of rows of chips. */
export const PREVIEW_INGREDIENTS = 6;

/** The preview's stat tiles. Total time only when the recipe STATES one —
 *  the same rule as the page (ROADMAP, decided Sep 23) — so a recipe without
 *  one gets two tiles, never a guessed or blank third. */
export function previewStats(recipe: Recipe): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const time = timeLine(recipe);
  if (time) out.push({ value: time, label: 'total time' });
  const serves = typeof recipe.servings === 'number' && recipe.servings > 0 ? recipe.servings : null;
  if (serves) out.push({ value: String(serves), label: serves === 1 ? 'serving' : 'servings' });
  const steps = stepCount(recipe);
  out.push({ value: String(steps), label: steps === 1 ? 'step' : 'steps' });
  return out;
}

/** "Cooked 3× · last Sep 11 · your rating 👍", or "You haven't cooked this
 *  yet" — with the rating after it either way, when there is one. */
export function previewCookedLine(cooked: number[] | null | undefined, rating: number | null | undefined): string {
  const list = (cooked ?? []).filter((t) => typeof t === 'number' && Number.isFinite(t));
  const head = list.length ? `Cooked ${list.length}× · last ${shortDate(Math.max(...list))}` : "You haven't cooked this yet";
  const emoji = rating === 1 || rating === 0 || rating === -1 ? RATING_EMOJI[String(rating)] : null;
  return emoji ? `${head} · your rating ${emoji}` : head;
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

/** The spread a turn from `start` in direction `dir` lands on, or null at
 *  the first or last spread. Always a WHOLE spread: a turn that started
 *  mid-settle once landed on 1.8 — between two spreads, drawn as two empty
 *  pages — and the book could never be released from it. */
export function turnTarget(start: number, dir: 1 | -1, last: number): number | null {
  'worklet';
  const to = Math.round(start) + dir;
  return to < 0 || to > last ? null : to;
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

// ---------------------------------------------------------------------------
// The book, measured, and the carousel between books.
// ---------------------------------------------------------------------------

/** The prototype's geometry for a book `bookW` wide: each page half of it
 *  less the cover's 7px frame, page height = page width × 1.6, and the
 *  cover 16px taller than a page (7 at the head, 9 at the foot). */
export function bookGeometry(bookW: number): { bookW: number; pageW: number; pageH: number; coverH: number } {
  const pageW = (bookW - 14) / 2;
  const pageH = Math.round((bookW / 2) * 1.6);
  return { bookW, pageW, pageH, coverH: pageH + 16 };
}

/** The carousel's tuning: the prototype's numbers, plus the one thing the
 *  prototype did not need — a floor on how much of a neighbour shows. */
export const CAROUSEL = {
  /** Neighbours sit this fraction of (cover + gap) away. */
  spacing: 0.92,
  gap: 40,
  shrink: 0.14,
  tiltDeg: 10,
  fade: 0.45,
  /** A swipe past this fraction of the step changes book; so does a flick. */
  commitAt: 0.22,
  flickMs: 300,
  flickPx: 40,
  settleMs: 420,
  minSettleMs: 180,
  cancelMs: 260,
  /** With two books, a swipe DOWN gives this much and springs back. */
  edgeRubber: 0.12,
  /** The least of a neighbour's cover that must show; its tab adds ~19px
   *  more, which makes the peek a 44px target. */
  minPeekPx: 28,
  tabPx: 22,
  maxBookPx: 380,
  /** Below this a book stops being readable; a stage that small loses its
   *  peeks before it loses its book. */
  minBookPx: 220,
} as const;

/**
 * The book's width and the distance between books, for a stage of
 * stageW × stageH holding a shelf of `books`.
 *
 * The width is the prototype's — min(stage − 24, 380) — unless the stage is
 * too short to show the neighbours, and then the book gets narrower rather
 * than the peeks vanishing. On a phone the app has the room (the prototype's
 * size survives everywhere measured); a small window does not.
 *
 * Two constraints, both on the cover height c:
 *  - adjacent covers never overlap and leave room for one tab between them:
 *    step ≥ 0.93c + 22 + 4. One tab, not two — the front book's tab is at
 *    its top LEFT and the book above's at its bottom RIGHT, side by side;
 *  - a neighbour shows at least `minPeekPx` of its cover:
 *    step ≤ stageH/2 + 0.43c − minPeekPx.
 * Together: c ≤ stageH − 2·minPeek − 52. The prototype's spacing sits
 * between the two on every phone measured, so it is what governs there.
 */
export function carouselGeometry(stageW: number, stageH: number, books: number) {
  const { shrink, tabPx, minPeekPx, spacing, gap, maxBookPx, minBookPx } = CAROUSEL;
  const far = 1 - shrink; // a neighbour's scale
  const clearance = tabPx + 4;
  const widthCap = Math.min(stageW - 24, maxBookPx);
  const coverMax =
    books <= 1
      ? stageH - tabPx - 16
      : (stageH / 2 - minPeekPx - clearance) / ((1 + far) / 2 - far / 2);
  const fromHeight = Math.floor((coverMax - 16.5) / 0.8);
  const bookW = Math.max(Math.min(widthCap, minBookPx), Math.min(widthCap, fromHeight));
  const g = bookGeometry(bookW);
  const noOverlap = ((1 + far) / 2) * g.coverH + clearance;
  const showsPeek = stageH / 2 + (far / 2) * g.coverH - minPeekPx;
  const step = Math.max(noOverlap, Math.min(spacing * (g.coverH + gap), showsPeek));
  return { ...g, step, top: Math.round(stageH / 2 - g.coverH / 2 - tabPx) };
}

/**
 * A book's offset from the carousel's position `pos`, in books: 0 in front,
 * 1 the next one down, −1 the one above. The loop is endless, so each book
 * is drawn at the copy of itself NEAREST the position — which is what lets
 * three books fill both neighbours and a fourth rise into place from below
 * without anything ever being re-assigned at a moment that could show.
 *
 * Two books break the symmetry on purpose (ROADMAP): the other one always
 * waits BELOW, so its copy is the one in (pos − 0.5, pos + 1.5]. The front
 * book leaving upwards fades out by half way (`carouselPlacement`) and
 * rises into the slot below — the book going to the back of the pile.
 */
export function loopOffset(index: number, pos: number, count: number): number {
  'worklet';
  if (count <= 1) return index - pos;
  if (count === 2) return index + 2 * Math.floor((pos + 1.5 - index) / 2) - pos;
  return index + count * Math.round((pos - index) / count) - pos;
}

/** Where a book at offset `o` is drawn: the prototype's translateY o × step,
 *  scale 1 − 0.14|o|, rotateX −10°·o and opacity 1 − 0.45|o| between the
 *  neighbours; beyond them it is gone by 1.5, which is exactly where the
 *  loop hands a book from one end to the other. With two books the one
 *  above is gone by 0.5 (see `loopOffset`). The tab under a book appears
 *  once it is above the front one. */
export function carouselPlacement(o: number, step: number, count: number) {
  'worklet';
  const a = o < 0 ? -o : o;
  let opacity = a <= 1 ? 1 - CAROUSEL.fade * a : (1 - CAROUSEL.fade) * Math.max(0, (1.5 - a) / 0.5);
  if (count === 2 && o < 0) opacity = Math.max(0, 1 - 2 * a);
  return {
    translateY: o * step,
    scale: 1 - CAROUSEL.shrink * Math.min(a, 1.5),
    rotateX: -o * CAROUSEL.tiltDeg,
    opacity,
    bottomTab: o < -0.3 ? Math.min(1, (-o - 0.3) * 3) : 0,
  };
}

/** How far through a book change a vertical drag of `dy` is, −1…1 (+ is the
 *  next book, dragged up). With two books there is no book above: the drag
 *  gives a little and springs back. */
export function carouselDrag(dy: number, step: number, canGoBack: boolean): number {
  'worklet';
  let f = -dy / step;
  f = f < -1 ? -1 : f > 1 ? 1 : f;
  if (f < 0 && !canGoBack) f *= CAROUSEL.edgeRubber;
  return f;
}

/** Past 22% of the step, or a flick (under 300ms, over 40px). */
export function bookSwipeCommits(dy: number, elapsedMs: number, step: number): boolean {
  'worklet';
  const ady = dy < 0 ? -dy : dy;
  return ady > step * CAROUSEL.commitAt || (elapsedMs < CAROUSEL.flickMs && ady > CAROUSEL.flickPx);
}

/** The rest of a book change: 420ms for a whole one, never under 180. */
export function bookSettleMs(travelled: number): number {
  'worklet';
  const t = travelled < 0 ? -travelled : travelled;
  return Math.max(CAROUSEL.minSettleMs, (1 - Math.min(1, t)) * CAROUSEL.settleMs);
}

/** Which shelf positions are mounted around the one in front: every book on
 *  a shelf of five or fewer, else the two either side — enough for any
 *  position a settle can pass through. Ascending, so the order is stable. */
export function carouselWindow(at: number, count: number): number[] {
  if (count <= 0) return [];
  const mod = (x: number) => ((x % count) + count) % count;
  if (count <= 5) return Array.from({ length: count }, (_, i) => i);
  return [...new Set([-2, -1, 0, 1, 2].map((r) => mod(at + r)))].sort((a, b) => a - b);
}

/** The shelf position a carousel position stands on. */
export const shelfIndex = (at: number, count: number): number => (count ? ((at % count) + count) % count : 0);
