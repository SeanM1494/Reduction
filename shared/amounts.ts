/**
 * shared/amounts.ts
 *
 * This is why amounts are stored as {qty, unit, name} rather than a string:
 * scaling and display become pure functions instead of string surgery.
 */

import type { Ingredient, Recipe } from "./layout";

const VULGAR: Array<[number, number, string]> = [
  [1, 8, "\u215B"],
  [1, 4, "\u00BC"],
  [1, 3, "\u2153"],
  [3, 8, "\u215C"],
  [1, 2, "\u00BD"],
  [5, 8, "\u215D"],
  [2, 3, "\u2154"],
  [3, 4, "\u00BE"],
  [7, 8, "\u215E"],
];

/** 0.125 -> "⅛", 2.5 -> "2½", 1.37 -> "1.37" */
export function formatQty(q: number): string {
  if (Math.abs(q - Math.round(q)) < 0.001) return String(Math.round(q));
  const whole = Math.floor(q);
  const frac = q - whole;
  let glyph: string | null = null;
  for (const [n, d, g] of VULGAR) {
    if (Math.abs(frac - n / d) < 0.02) glyph = g;
  }
  if (glyph) return whole ? `${whole}${glyph}` : glyph;
  return q.toFixed(2).replace(/\.?0+$/, "");
}

const UNIT_LABEL: Record<string, string> = {
  fl_oz: "fl oz",
  tbsp: "Tbs",
  tsp: "tsp",
};

/** The left-column amount. `scale` comes from the servings stepper. */
export function formatAmount(ing: Ingredient, scale = 1): string {
  if (ing.qty == null) return ing.text || "";
  const lo = formatQty(ing.qty * scale);
  const hi = ing.qtyMax != null ? formatQty(ing.qtyMax * scale) : null;
  const num = hi ? `${lo}\u2013${hi}` : lo;
  const unit = ing.unit ? ` ${UNIT_LABEL[ing.unit] || ing.unit}` : "";
  return `${num}${unit}`;
}

export function countSteps(recipe: Recipe): number {
  return recipe.sections.reduce((n, s) => n + (s.nodes?.length || 0), 0);
}

/** Steps plus ingredients — the denominator for progress. */
export function countAll(recipe: Recipe): number {
  return recipe.sections.reduce(
    (n, s) => n + (s.nodes?.length || 0) + (s.ingredients?.length || 0),
    0
  );
}

/**
 * A step's time, rendered — or null when it does not have one.
 *
 * Null rather than "" so callers `if` on it, and `unknown` rather than
 * `number | null` on purpose. Until the editor, `minutes` only ever came from
 * an extraction that had already been through `validateRecipe`. It is now a
 * box a person types into, and it will now also arrive from the JSON hatch
 * and from any client that can PATCH — and `validateRecipe` has no opinion on
 * this field, so nothing upstream will catch `"12 min"`. That string is
 * truthy, which is what every caller used to test, so it reached `min < 60`
 * as a comparison against a string and the timer as `"12 min" * 60_000`, i.e.
 * NaN. One guard, at the one place that turns the number into words.
 *
 * (The visual editor cannot produce a bad value — `parseTiming` in
 * shared/edits.ts only ever emits a number or null. This is for everything
 * that does not go through it.)
 */
export function formatMinutes(min: unknown): string | null {
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) return null;
  const whole = Math.round(min);
  if (whole < 60) return `${whole} min`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** The same guard, as a number, for arithmetic (timer end times). */
export function stepMinutes(min: unknown): number | null {
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) return null;
  return min;
}
