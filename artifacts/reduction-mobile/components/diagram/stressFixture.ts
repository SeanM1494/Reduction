/**
 * A deterministic 30-step stress recipe for the spike's FPS run — three
 * sections, deep chains and wide merges, long wrapped names. Not shipped UI;
 * exists so the kill-criteria measurement is against a recipe meaningfully
 * harder than anything extraction produces, and identical on every run.
 */
import type { Recipe, Section } from "@/shared/layout";

function chainSection(name: string, steps: number, fanEvery: number): Section {
  const ingredients = [];
  const nodes: Section["nodes"] = [];
  let prev: string | null = null;
  for (let s = 0; s < steps; s++) {
    const inputs: string[] = prev ? [prev] : [];
    const extra = s % fanEvery === 0 ? 3 : 1;
    for (let i = 0; i < extra; i++) {
      const id = `${name}-i${s}-${i}`;
      ingredients.push({
        id,
        qty: 1 + (s % 4) * 0.25,
        unit: (["cup", "tbsp", "g", null] as const)[s % 4],
        name: `long wrapped ingredient name number ${s}-${i} for measuring`,
      });
      inputs.push(id);
    }
    const id = `${name}-s${s}`;
    nodes.push({ id, label: `step ${s}: stir, fold and combine thoroughly`, inputs, minutes: s % 3 ? undefined : 10 });
    prev = id;
  }
  return { name, ingredients, nodes, root: prev! };
}

export const STRESS_RECIPE: Recipe = {
  title: "Stress: 30 steps",
  servings: 8,
  sections: [
    chainSection("Base", 12, 3),
    chainSection("Filling", 10, 4),
    chainSection("Assembly", 8, 2),
  ],
} as Recipe;
