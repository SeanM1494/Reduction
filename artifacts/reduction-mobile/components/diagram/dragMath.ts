/**
 * components/diagram/dragMath.ts — the arithmetic behind the press-and-hold
 * drag, kept pure so the runner can test it under plain node.
 *
 * Hit-testing is against the diagram's OWN solved rects (layoutRects.ts),
 * not against anything measured from the screen: a finger's window
 * coordinate becomes a point in the section's content space with two
 * subtractions (the frame's window origin, measured once at pickup, and
 * the scroller's offset), and the step under it is the rect that contains
 * that point. No DOM, no elementFromPoint, no per-move measuring.
 */

import type { CellRect } from "./layoutRects";

/** The step cell containing content-space (x, y), or null. Ingredient and
 *  gap cells are never targets: an ingredient cannot consume an ingredient,
 *  and a gap is the layout's whitespace. */
export function stepAt(rects: readonly CellRect[], x: number, y: number): string | null {
  for (const r of rects) {
    const c = r.cell;
    if (c.kind !== "op" && c.kind !== "collapsed") continue;
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return c.key;
  }
  return null;
}

/**
 * -1, 0 or 1: which way a surface should scroll itself while a finger
 * loiters within `edge` of its `lo` or `hi` bound. A surface shorter than
 * two edges never scrolls, so a tiny frame cannot be made to twitch.
 */
export function edgeDir(pos: number, lo: number, hi: number, edge: number): -1 | 0 | 1 {
  if (hi - lo < edge * 2) return 0;
  if (pos < lo + edge) return -1;
  if (pos > hi - edge) return 1;
  return 0;
}

/** Content-space point for a finger at window (wx, wy), given where the
 *  frame's content origin sits in the window and how far the scroller has
 *  moved. `pageScrolled` is how far the page has scrolled since the frame
 *  was measured (the frame moved up by that much). */
export function toContent(
  wx: number,
  wy: number,
  frame: { x: number; y: number },
  scrollX: number,
  pageScrolled: number
): { x: number; y: number } {
  return { x: wx - frame.x + scrollX, y: wy - frame.y + pageScrolled };
}
