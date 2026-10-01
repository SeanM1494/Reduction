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
  /** "Watch instead"'s pointer (lib/demoWatch.ts), drawn INSIDE the thing
   *  it names, exactly as the ring is — so it scrolls with the diagram and
   *  stays in the pinned column with nothing measured. */
  pointer?: Pointer | null;
}

export interface Pointer {
  id: string;
  /** Gliding onto the target, then the tap's ring expanding there. */
  phase: 'approach' | 'tap';
  /** A new number for every new approach, so the glide starts again. */
  seq: number;
  /** Reduce Motion: no glide, a still ring. */
  still: boolean;
}

export type Spot = 'target' | 'dim' | null;

export function spotFor(spotlight: Spotlight | null | undefined, id: string): Spot {
  if (!spotlight) return null;
  if (spotlight.targets.has(id)) return 'target';
  return spotlight.dimOthers ? 'dim' : null;
}

/** The pointer, if it is on this target. */
export function pointerFor(spotlight: Spotlight | null | undefined, id: string): Pointer | null {
  const p = spotlight?.pointer;
  return p && p.id === id ? p : null;
}

/** How far a dimmed cell drops: still readable, clearly not the point. */
export const DIM_OPACITY = 0.35;
