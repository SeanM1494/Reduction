/**
 * totalTime.ts — a recipe's own total time, when its source STATES one.
 *
 * The number people read as "how long will this take". It is captured at
 * extraction and never computed: from schema.org's `totalTime` on a page
 * that publishes structured data, or from a total the source writes out
 * ("Total time: 45 min") when the model reads the text or a photo. Never
 * estimated, never summed from step times, never prep + cook added up —
 * each of those produces a confident wrong number, and a wrong number on
 * every card is worse than none. The summed timed steps are what the old
 * card showed, and on a "30-Minute Mongolian Beef" they read "2 min".
 *
 * Absent means "the source did not say", and the clients HIDE the time
 * rather than show anything in its place. New recipes only: nothing is
 * backfilled. Timed steps still drive timers and Cook mode, untouched.
 *
 * Deliberately NOT a field on the Recipe type in layout.ts (which this
 * feature leaves untouched). It rides in the recipe JSON like mealTypes —
 * through the extraction cache, the trial claim and the editor for free —
 * and is read and written only through the functions below, so the gate is
 * one place: `sanitizeTotalMinutes`.
 */

/** A week: sourdough and cured things are long; nothing sane is longer. */
export const MAX_TOTAL_MINUTES = 7 * 24 * 60;

/** The single gate: a whole number of minutes in (0, a week], else null.
 *  Zero is null on purpose — sites that never set a time publish PT0M. */
export function sanitizeTotalMinutes(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const m = Math.round(raw);
  return m >= 1 && m <= MAX_TOTAL_MINUTES ? m : null;
}

const DURATION =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

/**
 * schema.org `totalTime` — an ISO 8601 duration — as whole minutes, or null.
 * "PT1H30M" is 90. Anything that is not a duration is null rather than a
 * guess: a free-text "45 minutes" in that field is not parsed, because a
 * page that cannot fill a structured field correctly is not one to trust
 * on this. Years and months are null unless zero (some generators write
 * "P0Y0M0DT0H45M"): no recipe takes a month, and a month has no fixed length.
 */
export function parseIsoDuration(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = DURATION.exec(raw.trim());
  if (!m) return null;
  const n = (s: string | undefined) => (s ? Number(s) : 0);
  const [, years, months, weeks, days, hours, minutes, seconds] = m;
  if (n(years) || n(months)) return null;
  return sanitizeTotalMinutes(n(weeks) * 10080 + n(days) * 1440 + n(hours) * 60 + n(minutes) + n(seconds) / 60);
}

/** The recipe's stated total time in minutes, or null when it has none. */
export function recipeTotalMinutes(recipe: unknown): number | null {
  if (!recipe || typeof recipe !== "object") return null;
  return sanitizeTotalMinutes((recipe as { totalMinutes?: unknown }).totalMinutes);
}

/** Set it through the gate, or remove it: a value that does not pass is
 *  deleted rather than stored as null, so the JSON of a recipe with no
 *  stated time looks exactly as it always did. */
export function setRecipeTotalMinutes(recipe: object, raw: unknown): void {
  const m = sanitizeTotalMinutes(raw);
  if (m === null) delete (recipe as Record<string, unknown>).totalMinutes;
  else (recipe as Record<string, unknown>).totalMinutes = m;
}
