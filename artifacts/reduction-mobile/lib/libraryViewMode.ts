/**
 * lib/libraryViewMode.ts — which way the Library is browsed, and the card
 * stack's gesture policy. Pure, so the runner can test it.
 *
 * `grid` is the box laid out flat, two across; `stack` is one recipe at a
 * time with the next ones peeking behind it, flipped through by swiping.
 * (Shelves — one row per category — is a fast-follow once the stack has
 * been felt on a device; ROADMAP "Recipe browsing".) The choice persists
 * per device under VIEW_KEY, like the theme.
 */

export type LibraryView = 'grid' | 'stack';

export const VIEW_KEY = 'reduction_library_view';

export const LIBRARY_VIEWS: ReadonlyArray<{ view: LibraryView; label: string }> = [
  { view: 'grid', label: 'Grid' },
  { view: 'stack', label: 'Stack' },
];

export function parseLibraryView(raw: unknown): LibraryView {
  return raw === 'stack' ? 'stack' : 'grid';
}

/** How much of a drag past either end of the deck the finger actually
 *  gets. The deck does not wrap, so the ends have to answer by feel. */
export const RUBBER_BAND = 0.3;

/** And never further than this, in px. The deck sits in the margin the
 *  card leaves (24px a side on every phone), so a bigger nudge would put a
 *  card past the edge of the screen — which on the web build is the class
 *  of bug that zooms the whole layout viewport out (CLAUDE.md). */
export const OVERSCROLL_MAX_PX = 20;

/** How many cards peek out behind the front one. */
export const PEEK = 2;

/**
 * The deck's position as a CONTINUOUS number — `index + how far through the
 * swipe` — which is what every card's transform is derived from. Whole
 * numbers are resting places; 1.4 is "card 1 dragged 40% of the way towards
 * card 2". One value for the whole deck is what makes the cards behind rise
 * as the front one leaves, instead of jumping when it commits.
 *
 * `travel` is the distance the front card covers to leave the screen, so
 * the card tracks the finger exactly 1:1.
 *
 * It CLAMPS at both ends rather than going negative, and the give past the
 * end is `overscrollPx` instead. That split is not cosmetic: a position
 * below zero means "further forward than the front card", which every
 * card's transform reads as being pushed BACK into the deck — so dragging
 * right at the first card shrank the card under the finger instead of
 * letting it follow. The deck as a whole shifts instead.
 *
 * Runs on the UI thread (see CardStack), hence the directive; it is a plain
 * pure function everywhere else, including under the test runner.
 */
export function dragPosition(start: number, translationX: number, travel: number, count: number): number {
  'worklet';
  const max = Math.max(0, count - 1);
  const p = start - translationX / travel;
  return Math.min(max, Math.max(0, p));
}

/**
 * How far the whole deck slides when the drag has run past either end:
 * positive pulling right (before the first card), negative pulling left
 * (after the last), zero in between, and never more than
 * `OVERSCROLL_MAX_PX`. Springs back to zero on release.
 */
export function overscrollPx(start: number, translationX: number, travel: number, count: number): number {
  'worklet';
  const max = Math.max(0, count - 1);
  const p = start - translationX / travel;
  const past = p < 0 ? -p : p > max ? -(p - max) : 0;
  const give = past * travel * RUBBER_BAND;
  if (give > OVERSCROLL_MAX_PX) return OVERSCROLL_MAX_PX;
  if (give < -OVERSCROLL_MAX_PX) return -OVERSCROLL_MAX_PX;
  return give;
}

/**
 * Which cards are mounted, in PAINT ORDER — deepest first, so the last one
 * in the list is the one on top. That ordering is the whole layering rule
 * (CLAUDE.md, "Stacked cards are absolutely positioned siblings"): there is
 * no zIndex anywhere in the stack, so this list IS the z-order.
 *
 * It runs from the deepest peek down to `index - 1`, and that last one is
 * deliberate and easy to get wrong: the card BEFORE the front one has to be
 * mounted and painted ABOVE it, because swiping back slides it in from the
 * left over the top of the deck, and because after a forward swipe commits
 * it is the card still flying off. One extra card past the visible peeks is
 * mounted as a buffer so nothing pops into view as the deck advances.
 */
export function stackWindow(index: number, count: number, peek: number = PEEK): number[] {
  const out: number[] = [];
  if (count <= 0) return out;
  const first = Math.min(count - 1, index + peek + 1);
  const last = Math.max(0, index - 1);
  for (let i = first; i >= last; i -= 1) out.push(i);
  return out;
}

/** A swipe commits when it has gone far enough OR fast enough; anything
 *  less springs back. `dx` is the horizontal travel in px, `vx` the
 *  release velocity in px/ms, `width` the card's width. */
export function swipeOutcome(dx: number, vx: number, width: number): 'next' | 'prev' | 'stay' {
  'worklet';
  const far = Math.abs(dx) > width * 0.35;
  const fast = Math.abs(vx) > 0.6;
  if (!far && !fast) return 'stay';
  // A fast flick counts only in the direction it is actually moving.
  const dir = far ? Math.sign(dx) : Math.sign(vx);
  return dir < 0 ? 'next' : 'prev';
}

/** The index after a swipe, clamped: the ends do not wrap, they rubber-band. */
export function stackStep(index: number, outcome: 'next' | 'prev' | 'stay', count: number): number {
  'worklet';
  if (count <= 0) return 0;
  const next = outcome === 'next' ? index + 1 : outcome === 'prev' ? index - 1 : index;
  return Math.min(count - 1, Math.max(0, next));
}

/** A tap is a press that barely moved. */
export const TAP_SLOP_PX = 8;
