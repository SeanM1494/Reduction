/**
 * lib/spotlight.ts — asking a screen to point at something. PURE.
 *
 * The demo guide names WHAT to point at — ids from the recipe's own graph,
 * or a named control — and the screen that draws it decides HOW: a ring on
 * the target, the rest dimmed. The diagram draws the ring inside the cell
 * itself, so it scrolls with the table and stays put in the pinned first
 * column with no measuring at all. Nothing that is not a demo ever passes
 * one.
 */

export interface Spotlight {
  /** Graph ids (an ingredient or a step), or 'mode:steps' / 'cook:next'. */
  targets: ReadonlySet<string>;
  /** Lower everything in the diagram that is not a target. */
  dimOthers: boolean;
}

export type Spot = 'target' | 'dim' | null;

export function spotFor(spotlight: Spotlight | null | undefined, id: string): Spot {
  if (!spotlight) return null;
  if (spotlight.targets.has(id)) return 'target';
  return spotlight.dimOthers ? 'dim' : null;
}

/** How far a dimmed cell drops: still readable, clearly not the point. */
export const DIM_OPACITY = 0.35;
