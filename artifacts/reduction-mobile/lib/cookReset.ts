/**
 * lib/cookReset.ts — what "Clear progress" writes, and where Step-by-Step
 * goes after it. PURE, so both are tested.
 *
 * Where the current card lives: NOWHERE persistent. Step-by-Step keeps its
 * position in memory (StepsMode's `cardIndex`) and, whenever it mounts,
 * starts at the first card whose step is not done. Nothing about the
 * position is on the device or in the synced entry, so after a Clear —
 * which empties `done` through the normal write — a reload, another device
 * or a remount already starts at the first card. What does NOT reset by
 * itself is a Step-by-Step that is on screen when Clear lands: it keeps its
 * index, the "Before you start" card it saw passed, its timer alert and its
 * scroll. `freshCookState` is what it resets to (StepsMode's `resetSignal`).
 */

/**
 * Clear progress: every check off and any running timer stopped (the
 * server cancels the timer's pending notification on the same PATCH).
 * Deliberately names nothing else — the cooked history and the rating are
 * the recipe's record, not tonight's progress, and a field not in a PATCH
 * is a field left alone.
 */
export function clearProgressPatch(): { done: string[]; timer: null } {
  return { done: [], timer: null };
}

export interface CookState {
  /** The card on screen; 0 is the first card, which shows the section's
   *  "Before you start" instruction in front of it while that is unticked. */
  cardIndex: number;
  /** "Before you start" cards passed on this screen without a tick. */
  passed: Set<string>;
  /** The timed card a parallel suggestion came from. */
  returnIndex: number | null;
  /** A timer whose "Time's up" is still showing. */
  finishedStep: string | null;
  /** The card whose recipe words were unfolded. */
  expandedFor: string | null;
}

/** Step-by-Step after a Clear: the very first card, nothing remembered. */
export function freshCookState(): CookState {
  return { cardIndex: 0, passed: new Set(), returnIndex: null, finishedStep: null, expandedFor: null };
}

/** Where a Step-by-Step that mounts fresh starts: the first card not done
 *  (past the end when every step is). */
export function firstOpenCard(stepIds: string[], done: Set<string>): number {
  const i = stepIds.findIndex((id) => !done.has(id));
  return i === -1 ? stepIds.length : i;
}
