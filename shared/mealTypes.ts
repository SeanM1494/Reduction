/**
 * shared/mealTypes.ts — the eight meal types, and the one gate they pass.
 *
 * Eight, deliberately fewer than the obvious list: appetizers fold into
 * snacks, soups and salads into mains or sides. Eight fits a filter row on a
 * phone, and splitting a category later is easy where merging one after
 * people have filtered by it is not (ROADMAP #8).
 *
 * A recipe carries several types with ONE PRIMARY — the first element of
 * `recipe.mealTypes`. The primary drives sorting and display; the rest widen
 * filter matches. Inferred at extraction (the model has already read the
 * page, one more field is effectively free), editable by the user, so a
 * wrong guess is cheap rather than permanent.
 *
 * `sanitizeMealTypes` is the single gate: extraction output and user edits
 * both pass through it, on the server. It never rejects — a wrong meal type
 * is metadata, not a broken tree, and failing an otherwise-good parse over a
 * tag would invert the priorities. Unknowns drop, duplicates collapse,
 * order (and therefore the primary) is preserved.
 */

export const MEAL_TYPES = [
  "breakfast",
  "lunch",
  "dinner",
  "dessert",
  "snack",
  "side",
  "drink",
  "baking",
] as const;

export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
  side: "Side",
  drink: "Drink",
  baking: "Baking",
};

const KNOWN = new Set<string>(MEAL_TYPES);

/** Unknowns drop, case folds, duplicates collapse, order survives. Returns
 *  [] for anything malformed — which renders as "untagged", never an error. */
export function sanitizeMealTypes(raw: unknown): MealType[] {
  if (!Array.isArray(raw)) return [];
  const out: MealType[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim().toLowerCase();
    if (!KNOWN.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as MealType);
    if (out.length >= MEAL_TYPES.length) break;
  }
  return out;
}

export const primaryMealType = (types: string[] | undefined): MealType | null => {
  const clean = sanitizeMealTypes(types);
  return clean.length ? clean[0] : null;
};
