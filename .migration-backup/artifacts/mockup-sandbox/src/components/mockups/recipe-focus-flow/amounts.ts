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
