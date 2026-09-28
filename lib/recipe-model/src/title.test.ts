import test from "node:test";
import assert from "node:assert/strict";
import { FROM_MAX, TITLE_MAX, cleanFrom, cleanTitle, titleProblem, withUserFields } from "./title";
import { applyEdit, brokenComponentLinks, linkConsequence } from "./edits";
import { cardSequence } from "./sequence";
import { validateRecipe, type Recipe } from "./layout";

test("a typed title is trimmed, its whitespace runs collapse, and it is capped", () => {
  assert.equal(cleanTitle("  Sunday  gravy \n"), "Sunday gravy");
  assert.equal(cleanTitle("Grandma's\n\npie"), "Grandma's pie");
  assert.equal(cleanTitle("x".repeat(TITLE_MAX + 40)).length, TITLE_MAX);
  // A cut that lands on a space does not leave it dangling.
  assert.equal(cleanTitle(`${"a".repeat(TITLE_MAX - 1)} b`), "a".repeat(TITLE_MAX - 1));
  assert.equal(cleanFrom("  a  cookbook "), "a cookbook");
  assert.equal(cleanFrom("y".repeat(FROM_MAX + 5)).length, FROM_MAX);
  for (const blank of ["", "   ", "\n\t", null, undefined, 42]) assert.equal(cleanTitle(blank), "", String(blank));
});

test("an empty title is refused, with a sentence; anything else is fine", () => {
  assert.equal(titleProblem("   "), "Give it a title to save it.");
  assert.equal(titleProblem(""), "Give it a title to save it.");
  assert.equal(titleProblem(" Pie "), null);
});

test("typed fields win over the extraction's; blank ones leave it alone", () => {
  const extracted = { title: "Best Ever Lasagna (Easy!)", source: null as string | null, servings: 8 };
  // The same tree comes back from a fresh read and from a cache hit, so this
  // is the whole cache-hit story: whatever came back, the typed title wins.
  assert.deepEqual(withUserFields(extracted, { title: " Mum's lasagna ", from: "Mum" }), {
    title: "Mum's lasagna",
    source: "Mum",
    servings: 8,
  });
  assert.equal(withUserFields(extracted, { title: "  ", from: "" }), extracted, "nothing typed: the same object");
  assert.deepEqual(withUserFields(extracted, { from: "The Joy of Cooking" }), { ...extracted, source: "The Joy of Cooking" });
  assert.equal(extracted.title, "Best Ever Lasagna (Easy!)", "never mutates");
});

const LINKED = (): Recipe => ({
  title: "Cookies",
  servings: 24,
  sections: [
    {
      name: "Dry ingredients",
      ingredients: [
        { id: "flour", qty: 2, unit: "cup", name: "flour" },
        { id: "soda", qty: 1, unit: "tsp", name: "baking soda" },
      ],
      nodes: [{ id: "a1", label: "whisk together", inputs: ["flour", "soda"] }],
      root: "a1",
    },
    {
      name: "Dough",
      ingredients: [
        { id: "dry", qty: 1, unit: null, name: "Dry ingredients" },
        { id: "butter", qty: 1, unit: "cup", name: "butter" },
      ],
      nodes: [{ id: "b1", label: "cream and fold", inputs: ["butter", "dry"] }],
      root: "b1",
    },
  ],
});

test("renaming a recipe never touches a component link, whatever the new name", () => {
  const before = LINKED();
  // Even a title equal to a section's name, or to the linked ingredient's.
  for (const title of ["Brown butter cookies", "Dough", "Dry ingredients"]) {
    const after = applyEdit(before, { type: "setRecipeFields", fields: { title } });
    assert.deepEqual(validateRecipe(after), []);
    assert.deepEqual(brokenComponentLinks(before, after), { lost: [], gained: [] }, title);
    assert.equal(linkConsequence(before, after), null, title);
    assert.deepEqual(cardSequence(after).map((c) => c.stepId), ["a1", "b1"], title);
  }
});
