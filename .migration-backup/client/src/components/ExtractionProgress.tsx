/**
 * client/src/components/ExtractionProgress.tsx — the line that runs while a
 * recipe is being read.
 *
 * Before this, an extraction showed a disabled button and nothing else, for
 * however long the model took. It read as frozen at the exact moment a
 * first-time visitor is deciding whether the thing works.
 *
 * THE MESSAGES ARE TIMED, NOT REAL, AND THAT WAS A DECISION
 *
 * The pipeline does know when it moves from fetching to structuring to
 * validating, and a true message would beat a decorative one. Reporting those
 * transitions needs streaming, and the blocker is not the plumbing — it is
 * that **the HTTP status is committed before the body starts**.
 * `/api/recipes/extract` signals four outcomes through status codes that the
 * client depends on: 402 `trial_spent` (which turns the paste box into the
 * sign-up path), 429, 422 and 500. Any streamed response has to send 200
 * before it can emit a first stage event, so every one of those would have to
 * move into the body and every call site would have to stop reading
 * `err.code` and `err.status` — four entry points and the whole funnel. A job
 * id plus polling needs a durable job store, because an in-memory one dies on
 * a restart mid-extraction.
 *
 * So: timed. What makes that honest rather than a fake progress bar is the
 * shape of the sequence — it never claims a percentage, it never predicts a
 * finish, and it ENDS rather than looping. "Down to the essence" describes
 * what the app did, not what it is still doing, so it stays true no matter
 * how long the wait runs.
 *
 * That last property is also what makes the interval safe to get wrong: too
 * fast and all five show early and the last one holds; too slow and only two
 * or three appear. Neither is broken. It also covers the case where the
 * screen looks most frozen — `MAX_ATTEMPTS = 2` in structureRecipe means a
 * tree that fails validateRecipe is sent back to be repaired, roughly
 * doubling the wait, and a sequence that ran out or started looping would
 * pick exactly that moment to look broken.
 */

import { useEffect, useState } from "react";

/**
 * A reduction goes from raw to concentrated, so the arc reads as progress
 * even though nothing is measuring it. Order matters; do not shuffle.
 */
export const STAGES = [
  "Reading the recipe",
  "Bringing it to a simmer",
  "Cooking it down",
  "Skimming the excess",
  "Down to the essence",
] as const;

/**
 * PLACEHOLDER — pending real durations.
 *
 * Set before `extraction_events` had a single production row, so it is bounded
 * by the two failure modes rather than measured: too fast and the sequence
 * reads frantic, too slow and a normal extraction only ever shows two of the
 * five. 3s puts the last message up at 12s.
 *
 * It started at 2200 and was raised after watching it — 2.2s read rushed in
 * practice, which is the one piece of evidence there is so far and is not the
 * kind `ms` will give. Keep it when the real numbers arrive: if p50 suggests
 * something under about 2.5s, the phrases are competing with the wait rather
 * than filling it, and the floor should win.
 *
 * Retune it from the real distribution once there is a few days of data:
 *
 *   select
 *     count(*)                                              as n,
 *     percentile_cont(0.5)  within group (order by ms)::int  as p50,
 *     percentile_cont(0.9)  within group (order by ms)::int  as p90
 *   from extraction_events
 *   where not cached and ok and ms is not null;
 *
 * Aim for the last stage to land around p50, so a typical wait shows the
 * whole arc and a slow one rests on the final message: STAGE_MS = p50 / 4.
 */
export const STAGE_MS = 3000;

/**
 * Which message to show. Null when nothing is running.
 *
 * Resets to the start whenever `active` goes false, so a second extraction
 * begins at "Reading the recipe" rather than wherever the last one stopped.
 */
export function useReductionStage(active: boolean): string | null {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!active) {
      setI(0);
      return;
    }
    // setInterval rather than a chain of timeouts, cleared on the last stage
    // so nothing keeps ticking through a wait that outlasts the sequence.
    const id = setInterval(() => {
      setI((n) => {
        const next = Math.min(n + 1, STAGES.length - 1);
        if (next === STAGES.length - 1) clearInterval(id);
        return next;
      });
    }, STAGE_MS);
    return () => clearInterval(id);
  }, [active]);

  return active ? STAGES[i] : null;
}

/**
 * The line itself.
 *
 * `aria-live="polite"` because for someone who cannot see it this is the only
 * signal that anything is happening at all. Five announcements over a wait is
 * chatty; silence is worse.
 *
 * The height is reserved by `min-height` in CSS rather than by rendering an
 * empty line when idle — a permanently reserved slot would cost the landing
 * page vertical space it does not have on an iPhone SE, and the appearance of
 * the line at the START of an extraction is not a shift "as the message
 * changes", which is the thing that must not move.
 */
export default function ExtractionProgress({
  active,
  className = "",
}: {
  active: boolean;
  className?: string;
}) {
  const stage = useReductionStage(active);
  if (!stage) return null;
  return (
    <p className={`rd-extracting ${className}`.trim()} role="status" aria-live="polite">
      {stage}
      <span className="rd-extracting-dots" aria-hidden="true" />
    </p>
  );
}
