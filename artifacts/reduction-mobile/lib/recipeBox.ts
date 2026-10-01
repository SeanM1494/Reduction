/**
 * lib/recipeBox.ts — the Recipe Box's rules, with nothing drawn: which book a
 * recipe lives in, the order of a book's pages, its spreads, what a page
 * says, and the thresholds of a page turn. PURE — no react-native, no `@/`
 * alias — so the runner tests every rule here, and the components only draw
 * what these functions decide.
 *
 * A recipe is in exactly ONE book — the page counts and turns depend on it
 * — and since Sep 29 the books are the person's own (recipe-model books.ts):
 * named, coloured, ordered, and stored. A recipe's placement decides; one
 * without a placement falls back to its primary meal type's default book.
 * Meal types stay the extraction's guess and a search tag.
 */

import {
  keyIngredients,
  stepCount,
  formatMinutes,
  recipeTotalMinutes,
  DEFAULT_BOOKS,
  OTHER_BOOK_ID,
  isDefaultBook,
  liveBooks,
  resolveBookId,
  type BookDef,
  type Recipe,
} from '@workspace/recipe-model';
import { arrangeLibrary, inRecipeBox, ratingOf, searchLibrary, type LibraryItem, type SortKey } from './libraryView';

/** A book's id: a default's name (`dinner`, `other`…) or a UUID for one the
 *  person made (recipe-model books.ts). */
export type BookId = string;

export interface Book {
  id: BookId;
  name: string;
  /** The cover, tab and accent: one of recipe-model's BOOK_COLORS, every one
   *  carrying 11px white tab text at 4.5:1 or better (the covers do not
   *  follow the theme — a book is an object, like its cream pages). */
  color: string;
}

const asBook = (b: BookDef): Book => ({ id: b.id, name: b.name, color: b.color });

/** Today's seven, as a shelf with no account behind it draws them. */
export const BOOKS: readonly Book[] = DEFAULT_BOOKS.map(asBook);

/**
 * The book a recipe is in: its placement (`entry.book`, chosen at save or
 * by a move), else its primary meal type's default book — then through any
 * deleted book to where that book's recipes went, and to Other when that
 * leads nowhere (recipe-model resolveBookId). `books` is the account's list;
 * without one, today's seven.
 */
export function bookOf(entry: LibraryItem & { book?: string | null }, books: readonly BookDef[] = DEFAULT_BOOKS): BookId {
  return resolveBookId(books, entry.book ?? null, entry.recipe.mealTypes);
}

/** A live book by id; Other for anything else (a deleted book resolves
 *  before it gets here, so that is only ever a stale id). */
export function bookById(id: BookId, books: readonly BookDef[] = DEFAULT_BOOKS): Book {
  const live = liveBooks(books);
  return asBook(live.find((b) => b.id === id) ?? live.find((b) => b.id === OTHER_BOOK_ID) ?? DEFAULT_BOOKS[DEFAULT_BOOKS.length - 1]);
}

/**
 * One book's pages, in order: the person's sort, except that every 👎 goes to
 * the back, after everything else — whatever the sort. Changing a 👎 to
 * anything else puts it straight back in its sorted place, because nothing
 * here is stored: the order is derived every time.
 */
export function arrangeBook<T extends LibraryItem & { book?: string | null }>(
  entries: T[],
  book: BookId,
  sort: SortKey,
  books: readonly BookDef[] = DEFAULT_BOOKS
): T[] {
  const sorted = arrangeLibrary(
    entries.filter((e) => bookOf(e, books) === book),
    'all',
    sort
  );
  return [...sorted.filter((e) => ratingOf(e) !== -1), ...sorted.filter((e) => ratingOf(e) === -1)];
}

/** The shelf: the account's live books in their order, each with its pages.
 *  A DEFAULT book is left off while it is empty (as the seven always were),
 *  so nothing changes until someone customises; a book the person made
 *  stays, empty, on its "Room for one more" page. */
export function shelf<T extends LibraryItem & { book?: string | null }>(
  entries: T[],
  sort: SortKey,
  books: readonly BookDef[] = DEFAULT_BOOKS
): Array<{ book: Book; pages: T[] }> {
  return liveBooks(books)
    .map((b) => ({ book: asBook(b), pages: arrangeBook(entries, b.id, sort, books) }))
    .filter((b) => b.pages.length > 0 || !isDefaultBook(b.book.id));
}

/** Is page `i` of a book of `n` pages the blank "Room for one more"? The
 *  right-hand page after an odd book's last recipe, and the first page of
 *  an empty book. */
export const isRoomPage = (i: number, n: number): boolean => i === n && (n % 2 === 1 || n === 0);

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

/** The first few ingredients and the step count now live in the recipe
 *  model (summary.ts), because the starter reel's cards, built on the
 *  server, say the same things about a recipe and must agree with a page. */
export { keyIngredients, stepCount };

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

/** The grey pill of a page never cooked; short where "3× · Sep 11" is. */
export const notCookedLabel = (short: boolean): string => (short ? 'Not cooked' : 'Not cooked yet');

/** "last Sep 11" for the preview line. */
export const lastCookedDate = (cooked: number[] | null | undefined): string | null => {
  const list = (cooked ?? []).filter((t) => typeof t === 'number' && Number.isFinite(t));
  return list.length ? shortDate(Math.max(...list)) : null;
};

/**
 * Below this page width (an iPhone SE's one book is 141px) the pill takes
 * its short label: measured on the prototype, the long one put the pill on
 * the page number on 19 of 31 pages there. It grows with the text size.
 */
export const NARROW_PAGE_PX = 160;

/**
 * A page's heights, from PageFace.tsx and BookPage.tsx: each row is a fixed
 * part (margins, padding, a rule) and a part that grows with Dynamic Type
 * (the line height — iOS scales `lineHeight` with the font). Change a style
 * there and change it here; the fit is only as true as these numbers.
 */
export const PAGE_METRICS = {
  padTop: 12,
  /** The bottom padding the photo's share is taken from, at text size 1. */
  padBottom: 20,
  /** The page number: 6 from the bottom, a ~12px line, 2 clear of the pill. */
  numberFixed: 8,
  numberLine: 12,
  photoShare: 0.34,
  /** The least the picture may shrink to under large text before the text
   *  itself is capped. Room for the rating badge with a margin. */
  minPhoto: 36,
  titleFixed: 8,
  titleLine: 18,
  titleLines: 2,
  timeFixed: 5,
  timeLine: 14,
  servesFixed: 7 + 6 + 1,
  servesLine: 14,
  ingredientFixed: 3,
  ingredientLine: 15.5,
  /** The least gap kept above the pill, which is pinned to the bottom. */
  pillGap: 4,
  pillFixed: 6,
  pillLine: 13,
  /** A wide estimate of Space Grotesk SemiBold's average advance at the
   *  title's 14.5px (0.62em), for keeping its longest word on one line. */
  titleCharPx: 9,
  /** The pill's label (system SemiBold, 10.5px): a wide 0.6em a character,
   *  3px for a space or "·", inside its 8px side padding. */
  pillCharPx: 6.3,
  pillNarrowPx: 3,
  pillPadX: 8,
  /** Space Mono's advance (0.6125em) at the time line's 11px. The longest
   *  time there is, "23 hr 59 min", is 80.9px; the smallest page has 81. */
  timeCharPx: 6.74,
  padX: 11,
} as const;

/** The pill label's width at text size 1, by PAGE_METRICS. */
export const pillWidth = (label: string): number =>
  [...label].reduce((w, c) => w + (c === ' ' || c === '·' ? PAGE_METRICS.pillNarrowPx : PAGE_METRICS.pillCharPx), 0);

export interface PageText {
  title: string;
  time: string | null;
  /** The cooked pill's two labels: "Cooked 2× · Sep 5" and "2× · Sep 5",
   *  or "Not cooked yet" and "Not cooked". */
  pill: { long: string; short: string };
}

export interface PageFit {
  /** The pill's label: the long one wherever it fits. */
  pill: string;
  /** Its own cap, so the label is never cut by large text. */
  pillMaxFontScale: number | null;
  showServes: boolean;
  ingredientLines: 0 | 1 | 2;
  photoHeight: number;
  paddingBottom: number;
  /** A cap on Dynamic Type for the page's text, or null for none: set only
   *  when even the barest page would not fit at the person's text size. */
  maxFontScale: number | null;
  /** The time line's own cap, so its text is never cut by large text. */
  timeMaxFontScale: number | null;
  /** The title's own cap, so its longest word is never broken mid-word by
   *  large text (a word longer than the line at size 1 still is). */
  titleMaxFontScale: number | null;
}

const floor2 = (x: number): number => Math.floor(x * 100) / 100;
/** A cap worth passing: only above the default size (iOS honours none
 *  below 1), and only where it is lower than the text would be. */
const capBelow = (cap: number, k: number): number | null => (k > 1 && cap < k ? Math.max(1, cap) : null);

/**
 * What a book page shows, so that nothing on it is clipped or overlaps at
 * any page size the carousel can produce (`carouselGeometry`) and any text
 * size. Sizes are counted at their worst — a two-line title, two full
 * ingredient lines — so a page never depends on a guess about how a string
 * wraps.
 *
 * The order things give way, when the page is short (decided Oct 1):
 *  1. the pill's short label (by width: where the long one would be cut);
 *  2. ingredients to one line;
 *  3. the "Serves 4 · 8 steps" line goes;
 *  4. the ingredients line goes;
 *  5. under large text only: the picture shrinks, down to `minPhoto`;
 *  6. and then the text stops growing (`maxFontScale`).
 * The title, the time, the cooked pill and the page number never go, and
 * under large text the time and the title's longest word stop growing at
 * the page's width rather than being cut mid-word. On
 * every page the prototype was tuned for (a book 296px and wider, at the
 * default text size) step 1 at most applies, so those pages are unchanged.
 */
export function pageFit(width: number, height: number, text: PageText, fontScale: number): PageFit {
  const m = PAGE_METRICS;
  const { title, time, pill } = text;
  const s = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const basePhoto = Math.round((height - m.padTop - m.padBottom) * m.photoShare);
  const padBottom = (k: number) => Math.max(m.padBottom, Math.ceil(m.numberFixed + m.numberLine * k));
  // Everything but the picture and the optional rows, at text size k.
  const fixedRows = (k: number) =>
    m.padTop +
    m.titleFixed + m.titleLines * m.titleLine * k +
    (time ? m.timeFixed + m.timeLine * k : 0) +
    m.pillGap + m.pillFixed + m.pillLine * k +
    padBottom(k);
  const serves = (k: number) => m.servesFixed + m.servesLine * k;
  const ingredients = (n: number, k: number) => (n ? m.ingredientFixed + n * m.ingredientLine * k : 0);
  // Widths: the largest text size at which a string still fits the line.
  const contentW = width - 2 * m.padX;
  const fitsAt = (chars: number, charPx: number, room: number) => floor2(room / (Math.max(1, chars) * charPx));
  const timeCap = time ? fitsAt(time.length, m.timeCharPx, contentW) : Infinity;
  const longestWord = Math.max(...String(title ?? '').split(/\s+/).map((w) => w.length));
  const titleCap = fitsAt(longestWord, m.titleCharPx, contentW);
  const pillRoom = contentW - 2 * m.pillPadX;
  const pillCap = (label: string) => floor2(pillRoom / pillWidth(label));
  const textCaps = (k: number) => {
    const roomy = width >= NARROW_PAGE_PX * Math.max(1, k) && pillCap(pill.long) >= Math.max(1, k);
    const label = roomy ? pill.long : pill.short;
    return {
      pill: label,
      pillMaxFontScale: capBelow(pillCap(label), k),
      timeMaxFontScale: capBelow(timeCap, k),
      titleMaxFontScale: capBelow(titleCap, k),
    };
  };

  const ladder: Array<[boolean, 0 | 1 | 2]> = [[true, 2], [true, 1], [false, 1], [false, 0]];
  for (const [showServes, lines] of ladder) {
    if (fixedRows(s) + basePhoto + (showServes ? serves(s) : 0) + ingredients(lines, s) <= height) {
      return { ...textCaps(s), showServes, ingredientLines: lines, photoHeight: basePhoto, paddingBottom: padBottom(s), maxFontScale: null };
    }
  }
  const room = Math.floor(height - fixedRows(s));
  if (room >= m.minPhoto) {
    return { ...textCaps(s), showServes: false, ingredientLines: 0, photoHeight: room, paddingBottom: padBottom(s), maxFontScale: null };
  }
  // The text itself is capped: the largest k at which the bare page fits.
  // Every row is linear in k, so solve it (padBottom is linear once the
  // number outgrows the default padding, which it has by k > 1).
  const fixedPart = m.padTop + m.titleFixed + (time ? m.timeFixed : 0) + m.pillGap + m.pillFixed + m.numberFixed + m.minPhoto;
  const perK = m.titleLines * m.titleLine + (time ? m.timeLine : 0) + m.pillLine + m.numberLine;
  // (One pixel held back for the page number's padding, which rounds up.)
  const cap = Math.max(1, floor2((height - fixedPart - 1) / perK));
  return {
    ...textCaps(cap),
    showServes: false,
    ingredientLines: 0,
    photoHeight: Math.max(m.minPhoto, Math.floor(height - fixedRows(cap))),
    paddingBottom: padBottom(cap),
    maxFontScale: cap,
  };
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

// ---------------------------------------------------------------------------
// Search inside the box.
// ---------------------------------------------------------------------------

export interface BoxHit<T> {
  entry: T;
  book: Book;
  /** Its page in the book, as the shelf arranges it — what a tap opens to. */
  page: number;
}

/**
 * The box searched: the Find tab's own `searchLibrary` (title, source,
 * ingredient names — "what can I make with parmesan" is the point), plus the
 * NAME OF THE BOOK, so "dessert" finds every dessert whatever it is called.
 * Hits come in shelf order and page order, each with the page a tap should
 * open to. Removed recipes never match, whatever the caller passed.
 */
export function searchBox<T extends LibraryItem & { removedAt?: number | null; book?: string | null }>(
  entries: T[],
  query: string,
  sort: SortKey,
  books: readonly BookDef[] = DEFAULT_BOOKS
): Array<BoxHit<T>> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const live = entries.filter(inRecipeBox);
  const byText = new Set(searchLibrary(live, query));
  const out: Array<BoxHit<T>> = [];
  for (const { book, pages } of shelf(live, sort, books)) {
    const bookMatches = book.name.toLowerCase().includes(needle);
    pages.forEach((entry, page) => {
      if (bookMatches || byText.has(entry)) out.push({ entry, book, page });
    });
  }
  return out;
}

/** The line under a result's title: the stated time and how often it has
 *  been cooked, whichever exist — "30 min · cooked 3×", "cooked 1×", "". */
export function resultMeta(recipe: unknown, cooked: number[] | null | undefined): string {
  const n = (cooked ?? []).filter((t) => typeof t === 'number' && Number.isFinite(t)).length;
  return [timeLine(recipe), n ? `cooked ${n}×` : null].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Finishing a recipe: the rating prompt, and what a 👎 asks.
// ---------------------------------------------------------------------------

/** The three answers, worst first — the order they sit in on screen. */
export const RATING_CHOICES: ReadonlyArray<{ value: -1 | 0 | 1; emoji: string; label: string }> = [
  { value: -1, emoji: '👎', label: 'Not for me' },
  { value: 0, emoji: '👌', label: 'It was fine' },
  { value: 1, emoji: '👍', label: 'Loved it' },
];

/**
 * Whether finishing just now asks for a rating: exactly when the cook was
 * STAMPED — a new entry in `cooked`. That is stampCooked's six-hour dedupe
 * doing the deciding, so un-checking and re-checking the last step, or a
 * second device logging the same dinner, never asks twice.
 */
export const asksForRating = (before: readonly number[], after: readonly number[]): boolean => after.length > before.length;

export function ratingPromptCopy(title: string, rating: number | null | undefined): { heading: string; sub: string } {
  const rated = rating === 1 || rating === 0 || rating === -1;
  return {
    heading: `How was ${title || 'it'}?`,
    sub: rated ? 'You can keep your rating or change it.' : 'Your rating decides where it sits in your recipe box.',
  };
}

export function removePromptCopy(title: string, bookName: string): { heading: string; body: string; note: string } {
  return {
    heading: 'Take it out of your box?',
    body: `You gave ${title || 'this recipe'} a thumbs down. Want it gone, or kept at the back of ${bookName}?`,
    note: 'Removed recipes wait in Settings → Removed recipes. You can bring them back anytime.',
  };
}

export const removedToast = (title: string): string => `Removed ${title || 'recipe'}`;
export const keptToast = (bookName: string): string => `Moved to the back of ${bookName}`;

/**
 * Whether a rating change in the recipe itself asks "take it out?": only a
 * change TO 👎. Re-tapping 👎 clears it (the control's toggle), and moving
 * off 👎 is the opposite of wanting it gone. From the cooking prompt,
 * choosing 👎 always asks — that is a fresh verdict on a fresh cook.
 */
export const asksToRemove = (before: number | null | undefined, after: number | null): boolean => after === -1 && before !== -1;

// ---------------------------------------------------------------------------
// Removed recipes (Settings).
// ---------------------------------------------------------------------------

/** "Removed Sep 24", under a removed recipe's title. */
export const removedOn = (removedAt: number | null | undefined): string =>
  typeof removedAt === 'number' && Number.isFinite(removedAt) ? `Removed ${shortDate(removedAt)}` : 'Removed';

/** The Settings row's count: "None", "1 recipe", "3 recipes". */
export const removedCountLabel = (n: number): string => (n <= 0 ? 'None' : n === 1 ? '1 recipe' : `${n} recipes`);

/** A restore's toast. It goes back where it was: a 👎 to the back. */
export const restoredToast = (title: string, bookName: string, rating: number | null | undefined): string =>
  rating === -1 ? `${title || 'Recipe'} is back, at the back of ${bookName}` : `${title || 'Recipe'} is back in ${bookName}`;

/** What an EMPTY library says when recipes were only taken out, not gone. */
export const removedWaitingNote = (n: number): string | null =>
  n <= 0 ? null : n === 1 ? '1 removed recipe is waiting in Settings → Removed recipes.' : `${n} removed recipes are waiting in Settings → Removed recipes.`;

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
