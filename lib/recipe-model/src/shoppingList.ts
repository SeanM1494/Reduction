/**
 * shoppingList.ts — one list from one or more recipes, merged and scaled,
 * as plain text for the share sheet.
 *
 * WHY THIS IS NOT A STORED LIST. The research (Oct 5) found every rival
 * ships an in-app list and the one-star reviews are about the two hard
 * parts: duplicates that do not merge, and list sync. Most people keep
 * their real list on paper or in Notes/Reminders. So the list is derived
 * on demand from recipes already in the library and HANDED OFF; nothing
 * here is saved, synced or sent to the server.
 *
 * THE MERGE RULE IS DELIBERATELY CONSERVATIVE, because a wrong merge (two
 * different things on one line) loses an item at the store, while a missed
 * merge only costs a line:
 *  - Same name once normalised (case, spacing, a plain trailing s/es) is
 *    one item. Prep words live in `note`, not the name, which is what lets
 *    "onion" from two recipes meet at all.
 *  - Amounts add only within the SAME unit. Different units are kept as
 *    parts joined by " + " ("1 cup + 2 Tbs") rather than converted, so no
 *    conversion can produce a number nobody can measure.
 *  - A text-only amount ("to taste", "1 (14 oz) can") is kept verbatim;
 *    identical texts are counted when they name a quantity and collapsed
 *    when they do not ("to taste" twice is still "to taste").
 *  - An ingredient that is another section's result ("Dry ingredients")
 *    is not something you buy, so `componentIngredientIds` drops it.
 *
 * SCALING follows the identity rule in amounts.ts: an item every one of
 * whose contributions is unscaled renders exactly what was extracted; only
 * an item touched by a scale is snapped to a measurable amount.
 */

import type { Recipe, Unit } from "./layout";
import { formatQty, snapQty } from "./amounts";
import { componentIngredientIds } from "./sequence";

export interface ShoppingSource {
  /** Stable key for the recipe (the library entry id). */
  id: string;
  recipe: Recipe;
  /** servings / recipe.servings, or exactly 1 when not scaled. */
  scale: number;
}

export interface ShoppingItem {
  /** Merge key: the normalised name. Stable across renders. */
  key: string;
  /** The name as the first recipe wrote it. */
  name: string;
  /** "1 cup + 2 Tbs", "3", "to taste", or "" when nothing was given. */
  amount: string;
  /** Ids of the recipes that need it, in the order they were passed. */
  from: string[];
}

interface Part {
  unit: Unit | null;
  lo: number;
  hi: number | null;
  scaled: boolean;
}

const UNIT_LABEL: Record<string, string> = { fl_oz: "fl oz", tbsp: "Tbs" };

/** Case, spacing and edge punctuation; then a plain plural folded. */
export function shoppingKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, "");
  return singular(base);
}

/** Folds "eggs" -> "egg", "tomatoes" -> "tomato", "onions" -> "onion" on the
 *  LAST word only, and leaves words that merely end in s alone ("molasses",
 *  "hummus", "asparagus", "couscous", "swiss"). Folding too little costs a
 *  line; folding too much would invent a merge, so the guard is wide. */
function singular(s: string): string {
  const m = /^(.*?)([a-z]+)$/.exec(s);
  if (!m) return s;
  const [, head, word] = m;
  if (word.length <= 3 || /(ss|sses|us|is|ys|as|os)$/.test(word)) return s;
  if (/(ches|shes|xes|zes|oes)$/.test(word)) return head + word.slice(0, -2);
  if (/ies$/.test(word)) return head + word.slice(0, -3) + "y";
  if (/s$/.test(word)) return head + word.slice(0, -1);
  return s;
}

/** A text amount that names a quantity ("1 (14 oz) can") is counted when it
 *  repeats; one that does not ("to taste", "for frying") is said once. */
const isCountableText = (t: string) => /^\s*\d/.test(t);

export function shoppingList(sources: ShoppingSource[]): ShoppingItem[] {
  const order: string[] = [];
  const items = new Map<
    string,
    { name: string; parts: Part[]; texts: Map<string, number>; from: string[] }
  >();

  for (const src of sources) {
    const skip = componentIngredientIds(src.recipe);
    for (const section of src.recipe.sections ?? []) {
      for (const ing of section.ingredients ?? []) {
        if (skip.has(ing.id)) continue;
        const name = (ing.name ?? "").trim();
        if (!name) continue;
        const key = shoppingKey(name);
        let item = items.get(key);
        if (!item) {
          item = { name, parts: [], texts: new Map(), from: [] };
          items.set(key, item);
          order.push(key);
        }
        if (!item.from.includes(src.id)) item.from.push(src.id);

        if (ing.qty != null && Number.isFinite(ing.qty)) {
          const lo = ing.qty * src.scale;
          const hi = ing.qtyMax != null ? ing.qtyMax * src.scale : null;
          const unit = ing.unit ?? null;
          const scaled = src.scale !== 1;
          const same = item.parts.find((p) => p.unit === unit);
          if (same) {
            // A range plus a plain amount is still a range: the plain one
            // contributes its value to both ends.
            same.hi = same.hi != null || hi != null ? (same.hi ?? same.lo) + (hi ?? lo) : null;
            same.lo += lo;
            same.scaled ||= scaled;
          } else {
            item.parts.push({ unit, lo, hi, scaled });
          }
        } else {
          const text = (ing.text ?? "").trim();
          if (text) item.texts.set(text, (item.texts.get(text) ?? 0) + 1);
        }
      }
    }
  }

  return order.map((key) => {
    const it = items.get(key)!;
    const pieces = it.parts.map(formatPart);
    for (const [text, n] of it.texts) {
      pieces.push(n > 1 && isCountableText(text) ? `${n} × ${text}` : text);
    }
    return { key, name: it.name, amount: pieces.join(" + "), from: it.from };
  });
}

function formatPart(p: Part): string {
  let lo = p.lo;
  let hi = p.hi;
  if (p.scaled) {
    lo = snapQty(lo, p.unit);
    if (hi != null) hi = snapQty(hi, p.unit);
  }
  const num = hi != null && Math.abs(hi - lo) > 1e-9 ? `${formatQty(lo)}–${formatQty(hi)}` : formatQty(lo);
  const unit = p.unit ? ` ${UNIT_LABEL[p.unit] ?? p.unit}` : "";
  return `${num}${unit}`;
}

/** One line per item, name first so Reminders' Groceries list can sort it
 *  into an aisle, amount in brackets. Notes and Messages read it as is;
 *  whether Reminders splits a pasted block into one reminder per line is
 *  the phone's to confirm. */
export function shoppingListText(items: ShoppingItem[]): string {
  return items.map((i) => (i.amount ? `${i.name} (${i.amount})` : i.name)).join("\n");
}
