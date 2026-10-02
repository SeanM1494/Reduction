/**
 * Whether the recipe page's one-line note strip goes at the top of the
 * diagram view (Oct 2). Pure, so the rule is tested without a screen.
 *
 * The top of the diagram is the page's scarcest room: on an iPhone SE the
 * first table starts at y=243 and every point above it is a point of
 * diagram pushed off the screen (CLAUDE.md, the recipe screen headroom). So
 * the strip is shown only where it costs the diagram nothing — beside a
 * photo tall enough to hold Clear progress, the strip and (when servings
 * are scaled) the scaled line — or on a screen tall enough that the
 * diagram is not short of room. Elsewhere the note is still one scroll
 * away, under the diagram, and leads Step-by-Step's first card.
 */

/** A 44pt row (the touch floor) and the column's 6pt gap. */
const ROW = 44;
const GAP = 6;
/** iPhone SE (568) and SE 2/3 (667) are short; every phone from 13 mini
 *  (812) up is not. */
export const TALL_SCREEN = 740;

export function noteStripFits({
  windowHeight,
  photoSize,
  scaled,
}: {
  windowHeight: number;
  /** The photo thumbnail's side, or null when the recipe has none. */
  photoSize: number | null;
  /** The "Cooking for 6 · the recipe makes 4" line is showing too. */
  scaled: boolean;
}): boolean {
  if (windowHeight >= TALL_SCREEN) return true;
  const column = ROW + GAP + ROW + (scaled ? GAP + ROW : 0);
  return photoSize != null && photoSize >= column;
}
