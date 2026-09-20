/**
 * lib/extractionStage.ts — what the wait for an extraction says, and when.
 *
 * PURE: no react-native, no `@/` alias, so `extractionStage.test.ts` runs
 * under plain node in scripts/run-tests.mjs. The hook that drives a clock
 * through it lives in components/ExtractionProgress.tsx.
 *
 * COPIED VERBATIM FROM THE WEB (artifacts/reduction/src/components/
 * ExtractionProgress.tsx), and the copy is load-bearing: the five phrases
 * are the product's own voice for the one wait it makes everyone sit
 * through, and STAGE_MS is a placeholder pending real durations — ROADMAP
 * #9 carries the query over `extraction_events` that retunes it, and the
 * retune has to land on both clients at once. If one side changes, change
 * the other; the test here pins the literals so a drift fails a run.
 *
 * A reduction goes from raw to concentrated, so the arc reads as progress
 * even though nothing is measuring it. Order matters; do not shuffle.
 */

export const STAGES = [
  'Reading the recipe',
  'Bringing it to a simmer',
  'Cooking it down',
  'Skimming the excess',
  'Down to the essence',
] as const;

/** The web's placeholder, kept identical: 3s puts the last message up at
 *  12s. See the web file's header for why it went from 2200 to 3000. */
export const STAGE_MS = 3000;

export const LAST_STAGE = STAGES.length - 1;

/** The stage index after `ticks` intervals of STAGE_MS, clamped to the
 *  last: a wait that outlasts the sequence rests on the final message
 *  rather than looping back to the start. */
export function stageAfter(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return Math.min(Math.floor(ticks), LAST_STAGE);
}

/** The next stage from `i`, and whether the clock can stop: the web
 *  clears its interval on reaching the last stage so nothing keeps
 *  ticking through a long wait. */
export function advance(i: number): { next: number; done: boolean } {
  const next = Math.min(i + 1, LAST_STAGE);
  return { next, done: next === LAST_STAGE };
}
