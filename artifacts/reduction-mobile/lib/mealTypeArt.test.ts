import { test } from "node:test";
import assert from "node:assert/strict";
import { MEAL_TYPES } from "@workspace/recipe-model";
import { ALL_SKETCH_KEYS, MEAL_TYPES_WITH_ART, mealTypeArt, sketchColors, sketchKeyFor } from "./mealTypeArt";
import { SKETCHES } from "./sketchData";

test("every meal type has fallback tints, and the untagged art is the default", () => {
  assert.deepEqual([...MEAL_TYPES_WITH_ART], [...MEAL_TYPES]);
  for (const t of MEAL_TYPES) {
    const a = mealTypeArt(t);
    assert.match(a.light.bg, /^#[0-9a-f]{6}$/i);
    assert.match(a.dark.bg, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(mealTypeArt(null), mealTypeArt("not-a-type" as any));
});

test("every meal type, and no meal type, has two distinct sketches that exist", () => {
  assert.equal(ALL_SKETCH_KEYS.length, (MEAL_TYPES.length + 1) * 2);
  assert.equal(new Set(ALL_SKETCH_KEYS).size, ALL_SKETCH_KEYS.length);
  for (const k of ALL_SKETCH_KEYS) assert.ok((SKETCHES[k] ?? []).length > 0, k);
  assert.deepEqual(Object.keys(SKETCHES).sort(), [...ALL_SKETCH_KEYS].sort());
});

test("a recipe's sketch depends on its id alone, and both of a type's sketches get used", () => {
  for (const t of MEAL_TYPES) {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(sketchKeyFor(t, `recipe-${i}`));
    assert.equal(seen.size, 2, t);
    assert.equal(sketchKeyFor(t, "abc"), sketchKeyFor(t, "abc"));
  }
  assert.equal(sketchKeyFor(null, "x"), sketchKeyFor("not-a-type" as any, "x"));
});

test("a custom book's recipes keep their own meal type's sketch", () => {
  // The sketch is chosen from the recipe, never from the book.
  assert.notEqual(sketchKeyFor("dessert", "id-1"), sketchKeyFor("dinner", "id-1"));
});

test("sketch colours: the book's colour as ink on a pale wash, lifted on dark", () => {
  const l = sketchColors("#a94f3a", "light");
  assert.equal(l.ink, "#a94f3a");
  assert.match(l.bg, /^#[0-9a-f]{6}$/);
  assert.notEqual(l.bg, "#fbf6ea");
  const d = sketchColors("#a94f3a", "dark");
  assert.match(d.ink, /^#[0-9a-f]{6}$/);
  assert.notEqual(d.ink, "#a94f3a");
});

test("every shape in every sketch is drawable", () => {
  for (const [k, shapes] of Object.entries(SKETCHES)) {
    for (const s of shapes) {
      if (s.t === "path") assert.ok(s.d && /^[MmLlHhVvCcSsQqAaZz0-9 ,.\-]+$/.test(s.d), `${k} ${s.d}`);
      else if (s.t === "circle") assert.ok(s.cx !== undefined && s.cy !== undefined && s.r, k);
      else if (s.t === "rect") assert.ok(s.width && s.height, k);
    }
  }
});
