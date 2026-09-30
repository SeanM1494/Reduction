import test from "node:test";
import assert from "node:assert/strict";
import { keyIngredients, stepCount } from "./summary";
import type { Recipe } from "./layout";

const recipe = {
  title: "Cookies",
  servings: 24,
  sections: [
    {
      name: "Dry ingredients",
      ingredients: [
        { id: "a", qty: 2, unit: "cup", name: "Flour" },
        { id: "b", qty: 1, unit: "tsp", name: "salt" },
      ],
      nodes: [{ id: "s1", label: "whisk", inputs: ["a", "b"] }],
      root: "s1",
    },
    {
      name: "Dough",
      ingredients: [
        { id: "c", qty: null, unit: null, name: "Dry ingredients" },
        { id: "d", qty: 1, unit: "cup", name: "Butter" },
        { id: "e", qty: 1, unit: null, name: "flour" },
        { id: "f", qty: 2, unit: null, name: "Eggs" },
        { id: "g", qty: 1, unit: "cup", name: "Sugar" },
      ],
      nodes: [
        { id: "t1", label: "cream", inputs: ["d", "g"] },
        { id: "t2", label: "mix", inputs: ["t1", "c", "e", "f"] },
      ],
      root: "t2",
    },
  ],
} as unknown as Recipe;

test("keyIngredients: recipe order, each name once whatever its case, never a component's result", () => {
  assert.deepEqual(keyIngredients(recipe), { names: ["Flour", "salt", "Butter"], more: 2 });
  assert.deepEqual(keyIngredients(recipe, 10), { names: ["Flour", "salt", "Butter", "Eggs", "Sugar"], more: 0 });
});

test("stepCount: every step of every section", () => {
  assert.equal(stepCount(recipe), 3);
  assert.equal(stepCount({ sections: [] } as unknown as Recipe), 0);
});
