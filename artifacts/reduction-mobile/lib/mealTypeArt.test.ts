import { test } from "node:test";
import assert from "node:assert/strict";
import { MEAL_TYPES } from "@workspace/recipe-model";
import { MEAL_TYPES_WITH_ART, mealTypeArt } from "./mealTypeArt";

test("every meal type has fallback art, and the untagged art is the default", () => {
  assert.deepEqual([...MEAL_TYPES_WITH_ART], [...MEAL_TYPES]);
  for (const t of MEAL_TYPES) {
    const a = mealTypeArt(t);
    assert.ok(a.icon.length > 0, t);
    assert.match(a.light.bg, /^#[0-9a-f]{6}$/i);
    assert.match(a.dark.bg, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(mealTypeArt(null).icon, "book-open");
  assert.equal(mealTypeArt("not-a-type" as any).icon, "book-open");
});
