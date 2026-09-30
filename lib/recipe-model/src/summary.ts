/**
 * summary.ts — what a recipe CARD says about a recipe it does not draw: the
 * first few ingredients and how many steps. One definition, because two
 * places show it and must agree: the phone's Recipe Box page (from the
 * account's own copy) and the starter reel's card (built on the server from
 * the cached tree). Moved here from the phone's lib/recipeBox.ts on Sep 30,
 * when the reel's cards took the book page's face.
 */

import type { Recipe } from "./layout";
import { componentIngredientIds } from "./sequence";

/**
 * The first few ingredients in recipe order — no ranking is invented — each
 * named once, and never a section's finished result ("Dry ingredients" in a
 * Dough section is not something you buy): that is componentIngredientIds,
 * the same rule the cooking order uses, not a copy of it.
 */
export function keyIngredients(recipe: Recipe, max = 3): { names: string[]; more: number } {
  const skip = componentIngredientIds(recipe);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const section of recipe.sections ?? []) {
    for (const ing of section.ingredients ?? []) {
      if (skip.has(ing.id)) continue;
      const name = (ing.name ?? "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return { names: names.slice(0, max), more: Math.max(0, names.length - max) };
}

export function stepCount(recipe: Recipe): number {
  return (recipe.sections ?? []).reduce((n, s) => n + (s.nodes?.length ?? 0), 0);
}
