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

/** A swipe commits when it has gone far enough OR fast enough; anything
 *  less springs back. `dx` is the horizontal travel in px, `vx` the
 *  release velocity in px/ms, `width` the card's width. */
export function swipeOutcome(dx: number, vx: number, width: number): 'next' | 'prev' | 'stay' {
  const far = Math.abs(dx) > width * 0.35;
  const fast = Math.abs(vx) > 0.6;
  if (!far && !fast) return 'stay';
  // A fast flick counts only in the direction it is actually moving.
  const dir = far ? Math.sign(dx) : Math.sign(vx);
  return dir < 0 ? 'next' : 'prev';
}

/** The index after a swipe, clamped: the ends do not wrap, they rubber-band. */
export function stackStep(index: number, outcome: 'next' | 'prev' | 'stay', count: number): number {
  if (count <= 0) return 0;
  const next = outcome === 'next' ? index + 1 : outcome === 'prev' ? index - 1 : index;
  return Math.min(count - 1, Math.max(0, next));
}

/** A tap is a press that barely moved. */
export const TAP_SLOP_PX = 8;
