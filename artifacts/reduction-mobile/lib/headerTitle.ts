/**
 * lib/headerTitle.ts — how wide the recipe screen's tappable title may be.
 * PURE, so the arithmetic is tested.
 *
 * The title sits in the navigation bar between the back button and ⋮, and
 * the header lays out a custom title from its own content, so a long title
 * given no ceiling pushes into the buttons. The ceiling depends on where
 * the platform puts the title:
 *  - iOS CENTRES it, so both sides pay the wider side's width (back chevron
 *    and "Back", or ⋮ and its margin);
 *  - Android and the web put it after the back arrow, so it may run to ⋮.
 * The floor keeps a short title's target wide enough to hit with a thumb.
 */

/** iOS: the wider of the back button with its label and ⋮ with its margin. */
export const HEADER_SIDE_PT = 92;
/** Android / web: the back arrow and its insets before the title... */
export const HEADER_LEFT_PT = 72;
/** ...and ⋮ with its margin after it. */
export const HEADER_RIGHT_PT = 64;
/** A short title ("Pho") still gets a target this wide. */
export const TITLE_MIN_PT = 120;

export function titleButtonMaxWidth(screenWidth: number, centered: boolean): number {
  const room = centered ? screenWidth - 2 * HEADER_SIDE_PT : screenWidth - HEADER_LEFT_PT - HEADER_RIGHT_PT;
  return Math.max(TITLE_MIN_PT, Math.floor(room));
}
