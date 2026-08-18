/**
 * shared/edits.test.ts — the three edit operations and the drop rule.
 *
 * These run without a database or a browser: applyEdit is pure and
 * validMoveTargets is pure, which is exactly why the drag's validity logic was
 * put there rather than in the pointer handlers. What the user drags against
 * is asserted here, once, instead of being inferred from a screenshot.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateRecipe, type Recipe } from "./layout";
import {
  applyEdit,
  EditTargetError,
  noTargetsReason,
  parentStepOf,
  parseAmount,
  validMoveTargets,
} from "./edits";

/** The guacamole demo's shape: two branches converging on a fold, then a rest.
 *  Small enough to reason about, and the tree the drag was designed against. */
const RECIPE = (): Recipe => ({
  title: "Guacamole",
  servings: 4,
  sections: [
    {
      name: "Guacamole",
      ingredients: [
        { id: "avocados", qty: 3, unit: null, name: "ripe avocados" },
        { id: "lime", qty: 1, unit: null, name: "lime", note: "juiced" },
        { id: "salt", qty: 0.5, unit: "tsp", name: "kosher salt" },
        { id: "onion", qty: 0.25, unit: "cup", name: "white onion" },
        { id: "tomato", qty: 1, unit: null, name: "roma tomato" },
      ],
      nodes: [
        { id: "d1", label: "halve and scoop", inputs: ["avocados"] },
        { id: "d2", label: "mash", inputs: ["d1", "lime", "salt"] },
        { id: "d3", label: "combine", inputs: ["onion", "tomato"] },
        { id: "d4", label: "fold together", inputs: ["d2", "d3"] },
      ],
      root: "d4",
    },
  ],
});

const step = (r: Recipe, id: string) => r.sections[0].nodes.find((n) => n.id === id)!;
const ing = (r: Recipe, id: string) => r.sections[0].ingredients.find((i) => i.id === id)!;

test("the fixture is valid to begin with", () => {
  assert.deepEqual(validateRecipe(RECIPE()), []);
});

// ------------------------------------------------------- ingredient fields --

test("setIngredientFields changes only the fields given", () => {
  const before = RECIPE();
  const after = applyEdit(before, {
    type: "setIngredientFields",
    ingredientId: "salt",
    fields: { qty: 1, unit: "tbsp" },
  });
  assert.equal(ing(after, "salt").qty, 1);
  assert.equal(ing(after, "salt").unit, "tbsp");
  assert.equal(ing(after, "salt").name, "kosher salt", "name was not in the op");
  assert.deepEqual(validateRecipe(after), []);
});

test("an absent field is left alone, an explicit null clears it", () => {
  const withNote = applyEdit(RECIPE(), {
    type: "setIngredientFields",
    ingredientId: "lime",
    fields: { name: "key lime" },
  });
  assert.equal(ing(withNote, "lime").note, "juiced", "absent means leave alone");

  const cleared = applyEdit(RECIPE(), {
    type: "setIngredientFields",
    ingredientId: "lime",
    fields: { note: null },
  });
  assert.equal(ing(cleared, "lime").note, null, "present-and-null means clear");
});

test("applyEdit never mutates the recipe it is given", () => {
  const before = RECIPE();
  const snapshot = JSON.stringify(before);
  applyEdit(before, {
    type: "setIngredientFields",
    ingredientId: "salt",
    fields: { name: "flaky salt" },
  });
  applyEdit(before, { type: "setStepLabel", stepId: "d1", label: "scoop" });
  applyEdit(before, { type: "moveIngredient", ingredientId: "salt", toStepId: "d3" });
  assert.equal(JSON.stringify(before), snapshot);
});

test("clearing a name produces an invalid candidate rather than throwing", () => {
  // The sheet shows the validator's message and declines to commit. An
  // operation that silently refused would leave the user retyping into a box
  // that never changes.
  const after = applyEdit(RECIPE(), {
    type: "setIngredientFields",
    ingredientId: "salt",
    fields: { name: "" },
  });
  assert.ok(validateRecipe(after).some((e) => /missing a name/.test(e)));
});

// -------------------------------------------------------------- step label --

test("setStepLabel renames one step", () => {
  const after = applyEdit(RECIPE(), { type: "setStepLabel", stepId: "d3", label: "dice and mix" });
  assert.equal(step(after, "d3").label, "dice and mix");
  assert.deepEqual(validateRecipe(after), []);
});

test("an over-long label is a validator problem, not a thrown one", () => {
  const after = applyEdit(RECIPE(), {
    type: "setStepLabel",
    stepId: "d3",
    label: "one two three four five six seven eight nine",
  });
  assert.ok(validateRecipe(after).some((e) => /too long/.test(e)));
});

test("an unknown id throws, because that is a caller bug", () => {
  assert.throws(
    () => applyEdit(RECIPE(), { type: "setStepLabel", stepId: "nope", label: "x" }),
    EditTargetError
  );
});

// ---------------------------------------------------------------- moving --

test("moveIngredient detaches from the old step and attaches to the new one", () => {
  const after = applyEdit(RECIPE(), {
    type: "moveIngredient",
    ingredientId: "salt",
    toStepId: "d3",
  });
  assert.deepEqual(step(after, "d2").inputs, ["d1", "lime"]);
  assert.deepEqual(step(after, "d3").inputs, ["onion", "tomato", "salt"]);
  assert.deepEqual(validateRecipe(after), []);
});

test("an ingredient is never left in two steps at once", () => {
  const after = applyEdit(RECIPE(), {
    type: "moveIngredient",
    ingredientId: "salt",
    toStepId: "d3",
  });
  const holders = after.sections[0].nodes.filter((n) => n.inputs.includes("salt"));
  assert.equal(holders.length, 1);
});

test("moving to the step that already has it is a no-op, not a duplicate", () => {
  const after = applyEdit(RECIPE(), {
    type: "moveIngredient",
    ingredientId: "salt",
    toStepId: "d2",
  });
  assert.deepEqual(step(after, "d2").inputs, ["d1", "lime", "salt"]);
  assert.deepEqual(validateRecipe(after), []);
});

test("parentStepOf finds the consuming step", () => {
  assert.equal(parentStepOf(RECIPE(), "salt")?.id, "d2");
  assert.equal(parentStepOf(RECIPE(), "onion")?.id, "d3");
  assert.equal(parentStepOf(RECIPE(), "missing"), null);
});

// ------------------------------------------------------------ drop rules --

test("valid targets are every step but the current parent", () => {
  // salt sits in d2, which has three inputs, so emptying is not a risk.
  assert.deepEqual(validMoveTargets(RECIPE(), "salt").sort(), ["d1", "d3", "d4"]);
});

test("every advertised target really does validate", () => {
  // The property the whole design rests on: the highlight is the gate.
  const recipe = RECIPE();
  for (const id of ["avocados", "lime", "salt", "onion", "tomato"]) {
    for (const target of validMoveTargets(recipe, id)) {
      const after = applyEdit(recipe, { type: "moveIngredient", ingredientId: id, toStepId: target });
      assert.deepEqual(
        validateRecipe(after),
        [],
        `${id} -> ${target} was offered but does not validate`
      );
    }
  }
});

test("every step NOT advertised really would fail", () => {
  // The other half: nothing valid is being hidden from the user.
  const recipe = RECIPE();
  for (const id of ["avocados", "lime", "salt", "onion", "tomato"]) {
    const ok = new Set(validMoveTargets(recipe, id));
    const parent = parentStepOf(recipe, id)!.id;
    for (const node of recipe.sections[0].nodes) {
      if (ok.has(node.id) || node.id === parent) continue;
      const after = applyEdit(recipe, {
        type: "moveIngredient",
        ingredientId: id,
        toStepId: node.id,
      });
      assert.notDeepEqual(
        validateRecipe(after),
        [],
        `${id} -> ${node.id} was withheld but would have been fine`
      );
    }
  }
});

test("the last input of a step cannot be moved out, and says why", () => {
  // avocados is d1's only input. Moving it would leave "halve and scoop" with
  // nothing, which validateRecipe refuses — so no target lights up at all.
  assert.deepEqual(validMoveTargets(RECIPE(), "avocados"), []);
  assert.match(noTargetsReason(RECIPE(), "avocados") ?? "", /halve and scoop/);
  assert.match(noTargetsReason(RECIPE(), "avocados") ?? "", /at least one input/);
});

test("a step with a step input can still give up its last ingredient", () => {
  // d2 is [d1, lime, salt]: taking both ingredients still leaves d1 feeding it.
  let r = applyEdit(RECIPE(), { type: "moveIngredient", ingredientId: "salt", toStepId: "d3" });
  r = applyEdit(r, { type: "moveIngredient", ingredientId: "lime", toStepId: "d3" });
  assert.deepEqual(step(r, "d2").inputs, ["d1"]);
  assert.deepEqual(validateRecipe(r), []);
});

test("noTargetsReason stays quiet when there is somewhere to go", () => {
  assert.equal(noTargetsReason(RECIPE(), "salt"), null);
});

test("a cross-section move is refused rather than left to the validator", () => {
  const two: Recipe = {
    ...RECIPE(),
    sections: [
      RECIPE().sections[0],
      {
        name: "Chips",
        ingredients: [{ id: "tortillas", qty: 200, unit: "g", name: "tortillas" }],
        nodes: [{ id: "c1", label: "fry", inputs: ["tortillas"] }],
        root: "c1",
      },
    ],
  };
  assert.throws(
    () => applyEdit(two, { type: "moveIngredient", ingredientId: "salt", toStepId: "c1" }),
    EditTargetError
  );
  assert.ok(!validMoveTargets(two, "salt").includes("c1"));
});

// ---------------------------------------------------------------- amount --

test("parseAmount reads the shapes people type", () => {
  assert.deepEqual(parseAmount("2"), { qty: 2, qtyMax: null, text: null });
  assert.deepEqual(parseAmount("2.5"), { qty: 2.5, qtyMax: null, text: null });
  assert.deepEqual(parseAmount("1/2"), { qty: 0.5, qtyMax: null, text: null });
  assert.deepEqual(parseAmount("2 1/2"), { qty: 2.5, qtyMax: null, text: null });
  assert.deepEqual(parseAmount("½"), { qty: 0.5, qtyMax: null, text: null });
  assert.deepEqual(parseAmount("2½"), { qty: 2.5, qtyMax: null, text: null });
});

test("parseAmount reads ranges, including en dashes", () => {
  assert.deepEqual(parseAmount("2-3"), { qty: 2, qtyMax: 3, text: null });
  assert.deepEqual(parseAmount("2 – 3"), { qty: 2, qtyMax: 3, text: null });
  assert.deepEqual(parseAmount("1/2 - 3/4"), { qty: 0.5, qtyMax: 0.75, text: null });
});

test("anything else is kept verbatim as text", () => {
  // The case validateRecipe's `text` fallback exists for. Storing it as text
  // rather than rejecting it is what stops the sheet arguing with a cook.
  assert.deepEqual(parseAmount("to taste"), { qty: null, qtyMax: null, text: "to taste" });
  assert.deepEqual(parseAmount("1 (14 oz) can"), {
    qty: null,
    qtyMax: null,
    text: "1 (14 oz) can",
  });
});

test("an empty amount clears both qty and text", () => {
  assert.deepEqual(parseAmount("   "), { qty: null, qtyMax: null, text: null });
});

test("a parsed amount keeps the recipe valid", () => {
  for (const typed of ["2", "2-3", "to taste", "½"]) {
    const p = parseAmount(typed);
    const after = applyEdit(RECIPE(), {
      type: "setIngredientFields",
      ingredientId: "salt",
      fields: { qty: p.qty, qtyMax: p.qtyMax, text: p.text },
    });
    assert.deepEqual(validateRecipe(after), [], `"${typed}" made the recipe invalid`);
  }
});
