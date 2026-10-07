/**
 * stepTiming.ts — a step's `minutes` and `tempF`, made consistent with its
 * label at the one moment a model hands us a tree.
 *
 * The prompt asks for time and temperature twice: in the label ("bake 350°F
 * 25 min"), which is what the diagram shows, and in `minutes`/`tempF`, which
 * is what offers the timer and prints the oven line on a card. Nothing
 * checks the second against the first (`validateRecipe` has no opinion on
 * either field), so a reply that wrote the label and left the fields null
 * drew "bake 350°F 25 min" in the diagram and offered NO timer on that
 * step's card — and a reply that wrote `"minutes": "25"` was the same,
 * because `stepMinutes` rightly refuses a string.
 *
 * `sanitizeStepTimings` closes that gap without a model call:
 *
 * - a number written as a string becomes the number; anything else that is
 *   not a positive finite number becomes null;
 * - a field that is null is filled from the label when the label states it
 *   plainly. A field the model DID fill is never overwritten: the label is
 *   five words and the field may know better ("2-3 min per side").
 *
 * A range fills the LOW end ("bake 20-25 min" is a 20-minute timer): the
 * timer is when to look, and looking early costs nothing where looking late
 * burns it. Only °F is read; a °C-only label is left alone rather than
 * converted to a number nobody wrote.
 *
 * Run on EXTRACTION paths only (structureRecipe, fetchViaClaude), never on
 * a library write: there a null next to a timed label can be a person who
 * cleared the timer in the editor on purpose.
 */

import type { Recipe } from "./layout";

const NUM = String.raw`(\d+(?:\.\d+)?|\d*\s*[½¼¾⅓⅔])`;
const RANGE = String.raw`(?:\s*(?:-|–|—|to)\s*(?:\d+(?:\.\d+)?|[½¼¾⅓⅔]))?`;
const GLYPH: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

function num(raw: string): number {
  const s = raw.trim();
  const g = s.slice(-1);
  if (GLYPH[g] != null) {
    const whole = s.slice(0, -1).trim();
    return (whole ? Number(whole) : 0) + GLYPH[g];
  }
  return Number(s);
}

const HOURS = new RegExp(String.raw`${NUM}${RANGE}\s*(?:hours?|hrs?|h)\b`, "i");
const MINUTES = new RegExp(String.raw`${NUM}${RANGE}\s*(?:minutes?|mins?|m)\b`, "i");
const SECONDS = new RegExp(String.raw`${NUM}${RANGE}\s*(?:seconds?|secs?|s)\b`, "i");
const FAHRENHEIT = /(\d{3})\s*°?\s*F\b/;

/** The time and °F a label states, or null for each it does not. */
export function labelTiming(label: string): { minutes: number | null; tempF: number | null } {
  const text = label ?? "";
  // "1 hr 15 min" is 75; a unit that appears twice counts once (the first).
  const h = HOURS.exec(text);
  const m = MINUTES.exec(text);
  const s = SECONDS.exec(text);
  let minutes = 0;
  if (h) minutes += num(h[1]) * 60;
  if (m) minutes += num(m[1]);
  if (s) minutes += num(s[1]) / 60;
  const f = FAHRENHEIT.exec(text);
  const tempF = f ? Number(f[1]) : null;
  return {
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    // An oven or a fryer, not a stray number: 150–600 °F.
    tempF: tempF != null && tempF >= 150 && tempF <= 600 ? tempF : null,
  };
}

/** A positive finite number, from a number or a numeric string; else null. */
function positive(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Coerces every step's `minutes`/`tempF` and fills the null ones from the
 * label (see the header). Mutates `recipe`, like the other gates a tree
 * passes through; returns how many fields it filled, for the log.
 */
export function sanitizeStepTimings(recipe: Recipe): number {
  let filled = 0;
  for (const section of recipe.sections ?? []) {
    for (const step of section.nodes ?? []) {
      const fromLabel = labelTiming(step.label);
      let minutes = positive(step.minutes);
      let tempF = positive(step.tempF);
      if (minutes == null && fromLabel.minutes != null) {
        minutes = fromLabel.minutes;
        filled++;
      }
      if (tempF == null && fromLabel.tempF != null) {
        tempF = fromLabel.tempF;
        filled++;
      }
      step.minutes = minutes;
      step.tempF = tempF;
    }
  }
  return filled;
}
