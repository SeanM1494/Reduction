import test from "node:test";
import assert from "node:assert/strict";
import { shoppingKey, shoppingList, shoppingListText } from "./shoppingList";
import { formatAmount } from "./amounts";
import type { Ingredient, Recipe } from "./layout";

let n = 0;
const ing = (name: string, qty: number | null, unit: Ingredient["unit"] = null, extra: Partial<Ingredient> = {}): Ingredient => ({
  id: `i${++n}`,
  name,
  qty,
  unit,
  ...extra,
});

function recipe(title: string, sections: { name: string; ingredients: Ingredient[] }[]): Recipe {
  return {
    title,
    servings: 4,
    sections: sections.map((s) => ({
      name: s.name,
      ingredients: s.ingredients,
      nodes: [{ id: `${s.name}-mix`, label: "mix", inputs: s.ingredients.map((i) => i.id) }],
      root: `${s.name}-mix`,
    })),
  };
}

const one = (r: Recipe, scale = 1, id = r.title) => ({ id, recipe: r, scale });

test("an unscaled single recipe lists exactly what the diagram shows", () => {
  const ings = [
    ing("flour", 2.25, "cup"),
    ing("eggs", 2, null),
    ing("garlic cloves", 2, null, { qtyMax: 3 }),
    ing("salt", null, null, { text: "to taste" }),
    ing("butter", 0.5, "cup", { note: "softened" }),
  ];
  const items = shoppingList([one(recipe("Cake", [{ name: "Batter", ingredients: ings }]))]);
  assert.deepEqual(
    items.map((i) => i.amount),
    ings.map((i) => formatAmount(i, 1)),
  );
  assert.deepEqual(items.map((i) => i.name), ["flour", "eggs", "garlic cloves", "salt", "butter"]);
});

test("the same ingredient in two recipes is one line, summed, naming both", () => {
  const a = recipe("Stuffing", [{ name: "Main", ingredients: [ing("Yellow onion", 2), ing("butter", 0.5, "cup")] }]);
  const b = recipe("Gravy", [{ name: "Main", ingredients: [ing("yellow onions", 1), ing("Butter", 4, "tbsp")] }]);
  const items = shoppingList([one(a), one(b)]);
  assert.equal(items.length, 2);
  assert.equal(items[0].key, "yellow onion");
  assert.equal(items[0].name, "Yellow onion");
  assert.equal(items[0].amount, "3");
  assert.deepEqual(items[0].from, ["Stuffing", "Gravy"]);
  // Different units are kept apart, never converted.
  assert.equal(items[1].amount, "½ cup + 4 Tbs");
});

test("prep words in the note do not split an item", () => {
  const items = shoppingList([
    one(recipe("A", [{ name: "x", ingredients: [ing("onion", 1, null, { note: "diced" })] }])),
    one(recipe("B", [{ name: "x", ingredients: [ing("onion", 1, null, { note: "chopped" })] }])),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, "2");
});

test("same unit within one recipe across sections adds up", () => {
  const r = recipe("Pie", [
    { name: "Crust", ingredients: [ing("sugar", 1 / 3, "cup")] },
    { name: "Filling", ingredients: [ing("sugar", 1 / 3, "cup")] },
  ]);
  const [sugar] = shoppingList([one(r)]);
  assert.equal(sugar.amount, "⅔ cup");
  assert.deepEqual(sugar.from, ["Pie"]);
});

test("a section's own result is not something you buy", () => {
  const r = recipe("Cookies", [
    { name: "Dry ingredients", ingredients: [ing("flour", 2, "cup"), ing("baking soda", 1, "tsp")] },
    { name: "Dough", ingredients: [ing("Dry ingredients", null), ing("butter", 1, "cup")] },
  ]);
  assert.deepEqual(shoppingList([one(r)]).map((i) => i.name), ["flour", "baking soda", "butter"]);
});

test("scaling snaps to a measurable amount, only where a scale touched it", () => {
  const a = recipe("A", [{ name: "x", ingredients: [ing("flour", 2.25, "cup"), ing("eggs", 3)] }]);
  const items = shoppingList([one(a, 1.25)]);
  // 2.8125 cup -> 2¾ (within 5%); 3.75 eggs -> forced ladder of halves.
  assert.equal(items[0].amount, "2¾ cup");
  assert.equal(items[1].amount, "4");
  // The same recipe unscaled is the identity, glyph for glyph.
  assert.equal(shoppingList([one(a, 1)])[0].amount, "2¼ cup");
});

test("ranges add end to end, and a plain amount adds to both ends", () => {
  const items = shoppingList([
    one(recipe("A", [{ name: "x", ingredients: [ing("garlic clove", 2, null, { qtyMax: 3 })] }])),
    one(recipe("B", [{ name: "x", ingredients: [ing("garlic cloves", 2)] }])),
  ]);
  assert.equal(items[0].amount, "4–5");
});

test("text amounts: a quantity is counted, a phrase is said once", () => {
  const can = "1 (14 oz) can";
  const items = shoppingList([
    one(recipe("A", [{ name: "x", ingredients: [ing("black beans", null, null, { text: can }), ing("salt", null, null, { text: "to taste" })] }])),
    one(recipe("B", [{ name: "x", ingredients: [ing("black beans", null, null, { text: can }), ing("salt", null, null, { text: "to taste" })] }])),
  ]);
  assert.equal(items[0].amount, `2 × ${can}`);
  assert.equal(items[1].amount, "to taste");
});

test("numbers and text for one item are both kept", () => {
  const items = shoppingList([
    one(recipe("A", [{ name: "x", ingredients: [ing("salt", 1, "tsp")] }])),
    one(recipe("B", [{ name: "x", ingredients: [ing("salt", null, null, { text: "to taste" })] }])),
  ]);
  assert.equal(items[0].amount, "1 tsp + to taste");
});

test("an unticked ingredient is left out, and a line knows every ingredient in it", () => {
  const sugarA = ing("sugar", 0.25, "cup");
  const sugarB = ing("sugar", 0.5, "cup");
  const salt = ing("salt", 1, "tsp");
  const r = recipe("Pie", [
    { name: "Crust", ingredients: [sugarA, salt] },
    { name: "Filling", ingredients: [sugarB] },
  ]);
  const [sugar] = shoppingList([one(r)]);
  assert.deepEqual(sugar.ingredients, [{ source: "Pie", id: sugarA.id }, { source: "Pie", id: sugarB.id }]);
  // Unticking the line in the popup skips all of its ingredients.
  const skip = new Set(sugar.ingredients.map((i) => i.id));
  assert.deepEqual(shoppingList([{ id: "Pie", recipe: r, scale: 1, skip }]).map((i) => i.name), ["salt"]);
  // A skip applies only to the recipe it was made for.
  const other = recipe("Tea", [{ name: "x", ingredients: [ing("sugar", 1, "tsp")] }]);
  const both = shoppingList([{ id: "Pie", recipe: r, scale: 1, skip }, one(other)]);
  assert.deepEqual(both.map((i) => [i.name, i.amount]), [["salt", "1 tsp"], ["sugar", "1 tsp"]]);
});

test("plural folding merges real plurals and never invents a merge", () => {
  const same: [string, string][] = [
    ["eggs", "egg"],
    ["Tomatoes", "tomato"],
    ["berries", "berry"],
    ["  Red  Onions ", "red onion"],
    ["radishes", "radish"],
    ["limes", "lime"],
  ];
  for (const [a, b] of same) assert.equal(shoppingKey(a), shoppingKey(b), `${a} ~ ${b}`);
  // Words that end in s for their own reasons are left whole, so they can
  // never be folded onto a different food.
  for (const word of ["molasses", "hummus", "asparagus", "couscous", "swiss", "peas"]) {
    assert.equal(shoppingKey(word), word, word);
  }
});

test("blank names are skipped and an empty library gives an empty list", () => {
  assert.deepEqual(shoppingList([]), []);
  const r = recipe("A", [{ name: "x", ingredients: [ing("  ", 1), ing("milk", 1, "cup")] }]);
  assert.deepEqual(shoppingList([one(r)]).map((i) => i.name), ["milk"]);
});

test("the shared text is one line per item, name first", () => {
  const items = shoppingList([
    one(recipe("A", [{ name: "x", ingredients: [ing("milk", 1, "cup"), ing("ice", null)] }])),
  ]);
  assert.equal(shoppingListText(items), "milk (1 cup)\nice");
});
