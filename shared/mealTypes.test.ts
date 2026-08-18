/** shared/mealTypes.test.ts — the sanitiser, which is the whole contract. */

import test from "node:test";
import assert from "node:assert/strict";
import { MEAL_TYPES, primaryMealType, sanitizeMealTypes } from "./mealTypes";

test("valid types pass through with order (and the primary) intact", () => {
  assert.deepEqual(sanitizeMealTypes(["dinner", "lunch"]), ["dinner", "lunch"]);
  assert.equal(primaryMealType(["dinner", "lunch"]), "dinner");
});

test("case folds and whitespace trims", () => {
  assert.deepEqual(sanitizeMealTypes([" Dinner", "BREAKFAST "]), ["dinner", "breakfast"]);
});

test("unknowns drop without taking the rest with them", () => {
  assert.deepEqual(sanitizeMealTypes(["brunch", "dinner", "supper"]), ["dinner"]);
});

test("duplicates collapse to the first occurrence", () => {
  assert.deepEqual(sanitizeMealTypes(["dinner", "dinner", "lunch", "dinner"]), [
    "dinner",
    "lunch",
  ]);
});

test("malformed input is untagged, never an error", () => {
  assert.deepEqual(sanitizeMealTypes(undefined), []);
  assert.deepEqual(sanitizeMealTypes("dinner"), []);
  assert.deepEqual(sanitizeMealTypes([1, null, {}, []]), []);
  assert.equal(primaryMealType(undefined), null);
});

test("the list is exactly the eight, in display order", () => {
  assert.deepEqual(
    [...MEAL_TYPES],
    ["breakfast", "lunch", "dinner", "dessert", "snack", "side", "drink", "baking"]
  );
});
