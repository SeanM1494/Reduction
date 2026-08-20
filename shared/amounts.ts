/**
 * shared/amounts.ts
 *
 * This is why amounts are stored as {qty, unit, name} rather than a string:
 * scaling and display become pure functions instead of string surgery.
 */

import type { Ingredient, Recipe, Unit } from "./layout";

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

/**
 * SCALING PRODUCES NUMBERS NO KITCHEN TOOL CAN MEASURE, AND THE RIGHT ANSWER
 * DEPENDS ON THE UNIT.
 *
 * Doubling a recipe turns `2¼ cup` into `2.81 cup`. Nobody owns a 2.81-cup
 * measure. `formatQty` could not fix it, because it takes no unit and a
 * teaspoon, a cup and a gram want completely different granularity — so the
 * rounding lives here instead, where the unit is known.
 *
 * Each unit gets a LADDER: increments, coarsest first. Snap to the coarsest
 * rung within TOLERANCE. Ordering by step size descending IS the preference
 * order, which is why ⅓ lands ahead of ¼ in the cup ladder without a
 * hand-written rank.
 *
 * FOUR RULES AROUND IT, and three of them are restraints:
 *
 *  1. `scale === 1` never snaps at all. Enforced in formatAmount, not here.
 *  2. An INTEGER IS NEVER MOVED. 24 g is measurable and 3 cups is measurable;
 *     snapping exists to remove values no tool can express, not to beautify
 *     values that are already fine. This is also what stops a scaled 240 ml
 *     from "helpfully" becoming 250, and it strictly shrinks the drift
 *     between what is stored and what is shown.
 *  3. No rung within tolerance renders the EXACT number. Snapping is
 *     opportunistic. `0.3 cup` has no nearby rung on any cup measure and
 *     stays `0.3 cup` — honest and unmeasurable beats pretty and wrong. (The
 *     real answer for that case is expressing it in tablespoons, which is
 *     unit conversion and a different feature; see ROADMAP.)
 *  4. `pinch` and countable INVERT rule 3 and always snap. There is no such
 *     thing as 0.81 of a pinch or 2.81 onions, so for those two the ladder is
 *     mandatory and the tolerance is deliberately ignored. That is the whole
 *     difference between a real number of grams and a gesture.
 *
 * An unknown unit — the JSON hatch, or a future UNITS entry nobody added a
 * ladder for — has no ladder and falls through to exact, the same defensive
 * posture formatMinutes takes.
 */
const LADDERS: Record<string, number[]> = {
  // A measuring-spoon set, exactly.
  tsp: [1, 1 / 2, 1 / 4, 1 / 8],
  // NOT eighths: ⅛ Tbs is 0.375 tsp and no tool expresses it. ¼ Tbs is ¾ tsp,
  // which is a real spoon in most sets.
  tbsp: [1, 1 / 2, 1 / 4],
  // Thirds are in every cup set, so this ladder is not uniform. ⅛ cup = 2 Tbs.
  cup: [1, 1 / 2, 1 / 3, 1 / 4, 1 / 8],
  // Jug markings are whole ounces.
  fl_oz: [1, 1 / 2],
  oz: [1, 1 / 2, 1 / 4],
  // ⅛ lb = 2 oz, a real amount.
  lb: [1, 1 / 2, 1 / 4, 1 / 8],
  // 25 stays for grams: 25/50/75/100 are the numbers recipes are written in.
  g: [100, 50, 25, 10, 5, 1, 0.5],
  kg: [1, 0.5, 0.25, 0.1],
  // 25 is DROPPED here, unlike grams — it produced 275 ml, which is not a
  // line on any jug. Without it 266.6 lands on 270.
  ml: [100, 50, 10, 5, 1],
  l: [1, 0.5, 0.25, 0.1],
  pinch: [1],
};

/** Countable — 6 eggs, 3 cloves. Half an egg is real; 2.81 onions is not. */
const COUNTABLE_LADDER = [1, 1 / 2];

/**
 * The most a snap may move an amount, relative to the amount itself.
 *
 * Relative rather than absolute on purpose: 5% of a teaspoon of yeast and 5%
 * of three cups of flour are both proportionate, which is the property that
 * matters. The two forced units below ignore it — see rule 4.
 */
const TOLERANCE = 0.05;

const isWhole = (q: number) => Math.abs(q - Math.round(q)) < 1e-9;

const ladderFor = (unit: Unit | null | undefined): number[] | null =>
  unit == null ? COUNTABLE_LADDER : (LADDERS[unit] ?? null);

/** Rule 4: the two units where a value off the ladder is meaningless. */
const isForced = (unit: Unit | null | undefined) => unit == null || unit === "pinch";

/**
 * The scaled amount, moved to something a measure can express — or left alone
 * when nothing on the ladder is close enough. Pure, and exported so the rule
 * can be tested without a render.
 *
 * NEVER call this on an unscaled amount. `formatAmount` is the one caller and
 * it guards on `scale === 1` first; see the note there for why that guard is
 * an identity check and not a tolerance.
 */
export function snapQty(q: number, unit: Unit | null | undefined): number {
  const ladder = ladderFor(unit);
  if (!ladder || !Number.isFinite(q) || q <= 0) return q;
  if (isWhole(q)) return q; // rule 2
  for (const step of ladder) {
    const snapped = Math.round(q / step) * step;
    if (Math.abs(snapped - q) <= TOLERANCE * q) return snapped;
  }
  if (isForced(unit)) return Math.round(q / ladder[ladder.length - 1]) * ladder[ladder.length - 1];
  return q; // rule 3
}

/**
 * A range takes ONE step for both ends.
 *
 * Snapping the two ends independently is correct per-number and reads like a
 * mistake: 2.2–3.3 cup comes out as `2¼–3⅓`, two different denominators in
 * one amount. So the ladder is walked once for the pair, and only a rung that
 * fits both is taken.
 */
function snapRange(lo: number, hi: number, unit: Unit | null | undefined): [number, number] {
  const ladder = ladderFor(unit);
  if (!ladder || !Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0)
    return [lo, hi];
  if (isWhole(lo) && isWhole(hi)) return [lo, hi];
  for (const step of ladder) {
    const a = Math.round(lo / step) * step;
    const b = Math.round(hi / step) * step;
    if (Math.abs(a - lo) <= TOLERANCE * lo && Math.abs(b - hi) <= TOLERANCE * hi)
      return [a, b];
  }
  if (isForced(unit)) {
    const step = ladder[ladder.length - 1];
    return [Math.round(lo / step) * step, Math.round(hi / step) * step];
  }
  return [lo, hi];
}

const UNIT_LABEL: Record<string, string> = {
  fl_oz: "fl oz",
  tbsp: "Tbs",
  tsp: "tsp",
};

/**
 * The left-column amount, for DISPLAY. `scale` comes from the servings
 * stepper.
 *
 * ROUND FOR THE DIAGRAM, STAY EXACT IN THE EDITOR. This function rounds;
 * `editableAmount` below does not, and the split is stated in both places
 * rather than left to fall out of how the caller happens to be written.
 *
 * `scale === 1` is an IDENTITY CHECK, not a tolerance, and it is the rule
 * that a recipe nobody has scaled renders exactly what was extracted —
 * unchanged, glyph for glyph. It is sound because scale is only ever
 * `servings / baseServings` for two integers or the literal 1 when
 * `entry.servings` is null, and equal integers divide to exactly 1 in IEEE.
 * A tolerance here would let a recipe at its own serving count drift, which
 * is worse than any rounding error on a scaled one.
 */
export function formatAmount(ing: Ingredient, scale = 1): string {
  if (ing.qty == null) return ing.text || "";

  let qty = ing.qty * scale;
  let qtyMax = ing.qtyMax != null ? ing.qtyMax * scale : null;
  if (scale !== 1) {
    if (qtyMax != null) [qty, qtyMax] = snapRange(qty, qtyMax, ing.unit);
    else qty = snapQty(qty, ing.unit);
  }

  const lo = formatQty(qty);
  const hi = qtyMax != null ? formatQty(qtyMax) : null;
  const num = hi ? `${lo}\u2013${hi}` : lo;
  const unit = ing.unit ? ` ${UNIT_LABEL[ing.unit] || ing.unit}` : "";
  return `${num}${unit}`;
}

/**
 * The amount as the EDIT BOX must show it: exact, unscaled, unsnapped, and no
 * unit label — the unit is its own select next to the box.
 *
 * This exists to make a split explicit that used to be an accident.
 * `EditSheet` called `formatAmount({ ...ing, unit: null })`, nulling the unit
 * only to drop the label, and that nulled unit was the sole reason unit-keyed
 * rounding could not reach the editor. It would not merely have stopped
 * protecting the box — a null unit selects the COUNTABLE ladder, which is one
 * of the two that snap unconditionally, so the coincidence would have flipped
 * from harmless to corrupting.
 *
 * The contract is one line: what this renders, `parseAmount` reads back
 * unchanged. The old drift bound of 0.02 of a unit holds here, and is
 * deliberately abandoned for the diagram.
 */
export function editableAmount(ing: Ingredient): string {
  if (ing.qty == null) return ing.text ?? "";
  const lo = formatQty(ing.qty);
  return ing.qtyMax != null ? `${lo}\u2013${formatQty(ing.qtyMax)}` : lo;
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
