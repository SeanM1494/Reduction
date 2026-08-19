/**
 * shared/edits.test.ts — every edit operation and the drop rule.
 *
 * These run without a database or a browser: applyEdit is pure and
 * validMoveTargets is pure, which is exactly why the drag's validity logic was
 * put there rather than in the pointer handlers. What the user drags against
 * is asserted here, once, instead of being inferred from a screenshot.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateRecipe, type Recipe } from "./layout";
import { reconcileDone } from "./progress";
import {
  applyEdit,
  consumerOf,
  deleteIngredientBlocker,
  EditTargetError,
  noTargetsReason,
  parentStepOf,
  parseAmount,
  parseTiming,
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
  applyEdit(before, { type: "setStepFields", stepId: "d1", fields: { label: "scoop" } });
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

// ------------------------------------------------------------- step fields --

test("setStepFields renames one step", () => {
  const after = applyEdit(RECIPE(), { type: "setStepFields", stepId: "d3", fields: { label: "dice and mix" } });
  assert.equal(step(after, "d3").label, "dice and mix");
  assert.deepEqual(validateRecipe(after), []);
});

test("an over-long label is a validator problem, not a thrown one", () => {
  const after = applyEdit(RECIPE(), {
    type: "setStepFields",
    stepId: "d3",
    fields: { label: "one two three four five six seven eight nine" },
  });
  assert.ok(validateRecipe(after).some((e) => /too long/.test(e)));
});

test("an unknown id throws, because that is a caller bug", () => {
  assert.throws(
    () => applyEdit(RECIPE(), { type: "setStepFields", stepId: "nope", fields: { label: "x" } }),
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

// ------------------------------------------------- add / delete / split / merge --

const stepIds = (r: Recipe) => r.sections[0].nodes.map((n) => n.id);
const inputsOf = (r: Recipe, id: string) =>
  r.sections[0].nodes.find((n) => n.id === id)!.inputs;

test("addStepAfter inserts between a step and its consumer", () => {
  const after = applyEdit(RECIPE(), {
    type: "addStepAfter",
    afterStepId: "d2",
    label: "rest 10 min",
    newId: "new1",
  });
  assert.deepEqual(inputsOf(after, "new1"), ["d2"]);
  assert.ok(inputsOf(after, "d4").includes("new1"), "d4 consumes the new step");
  assert.ok(!inputsOf(after, "d4").includes("d2"), "and no longer d2 directly");
  assert.deepEqual(validateRecipe(after), []);
});

test("adding after the root makes the new step the root", () => {
  const after = applyEdit(RECIPE(), {
    type: "addStepAfter",
    afterStepId: "d4",
    label: "serve",
    newId: "new1",
  });
  assert.equal(after.sections[0].root, "new1");
  assert.deepEqual(inputsOf(after, "new1"), ["d4"]);
  assert.deepEqual(validateRecipe(after), []);
});

test("deleteStep splices its inputs into the consumer, in place", () => {
  // d2 = [d1, lime, salt] feeding d4 = [d2, d3]. Deleting d2 should put its
  // inputs exactly where d2 sat, because input order drives row order.
  const after = applyEdit(RECIPE(), { type: "deleteStep", stepId: "d2" });
  assert.deepEqual(inputsOf(after, "d4"), ["d1", "lime", "salt", "d3"]);
  assert.ok(!stepIds(after).includes("d2"));
  assert.deepEqual(validateRecipe(after), []);
});

test("deleting the root is refused when it has more than one input", () => {
  assert.throws(
    () => applyEdit(RECIPE(), { type: "deleteStep", stepId: "d4" }),
    /last step/
  );
});

test("deleting a root with a single step input promotes that input", () => {
  const r = applyEdit(RECIPE(), {
    type: "addStepAfter",
    afterStepId: "d4",
    label: "serve",
    newId: "tip",
  });
  const after = applyEdit(r, { type: "deleteStep", stepId: "tip" });
  assert.equal(after.sections[0].root, "d4");
  assert.deepEqual(validateRecipe(after), []);
});

test("splitStep chains: first keeps the id, second is new and takes the consumer", () => {
  const after = applyEdit(RECIPE(), {
    type: "splitStep",
    stepId: "d2",
    firstLabel: "mash",
    secondLabel: "season",
    toSecond: ["salt"],
    newId: "d2b",
  });
  assert.deepEqual(inputsOf(after, "d2"), ["d1", "lime"], "first half keeps the rest");
  assert.deepEqual(inputsOf(after, "d2b"), ["d2", "salt"], "second consumes the first");
  assert.ok(inputsOf(after, "d4").includes("d2b"), "the consumer now takes the second half");
  assert.equal(consumerOf(after, "d2")?.id, "d2b");
  assert.deepEqual(validateRecipe(after), []);
});

test("splitting a DONE step leaves a done set that is still upstream-closed", () => {
  // The derivation behind the id choice. Everything up to and including d2 is
  // done; splitting d2 must not produce a done step whose input is undone.
  const before = RECIPE();
  const done = ["avocados", "d1", "lime", "salt", "d2"];
  const after = applyEdit(before, {
    type: "splitStep",
    stepId: "d2",
    firstLabel: "mash",
    secondLabel: "season",
    toSecond: ["salt"],
    newId: "d2b",
  });
  const kept = new Set(reconcileDone(after, done).done);
  assert.ok(kept.has("d2"), "the first half stays done");
  assert.ok(!kept.has("d2b"), "the new second half is not");
  for (const n of after.sections[0].nodes) {
    if (!kept.has(n.id)) continue;
    for (const i of n.inputs ?? []) {
      assert.ok(kept.has(i), `closure broken: ${n.id} is done but its input ${i} is not`);
    }
  }
});

test("splitting the root makes the second half the root", () => {
  const after = applyEdit(RECIPE(), {
    type: "splitStep",
    stepId: "d4",
    firstLabel: "fold",
    secondLabel: "rest",
    toSecond: [],
    newId: "d4b",
  });
  assert.equal(after.sections[0].root, "d4b");
  assert.deepEqual(inputsOf(after, "d4b"), ["d4"]);
  assert.deepEqual(validateRecipe(after), []);
});

test("split with every input left on the first half is still valid", () => {
  // The sheet's default. The second half is never input-less because it
  // always consumes the first.
  const after = applyEdit(RECIPE(), {
    type: "splitStep",
    stepId: "d2",
    firstLabel: "mash",
    secondLabel: "then",
    toSecond: [],
    newId: "d2b",
  });
  assert.deepEqual(inputsOf(after, "d2b"), ["d2"]);
  assert.deepEqual(validateRecipe(after), []);
});

test("moving EVERY input to the second half empties the first, and is caught", () => {
  const after = applyEdit(RECIPE(), {
    type: "splitStep",
    stepId: "d2",
    firstLabel: "mash",
    secondLabel: "then",
    toSecond: ["d1", "lime", "salt"],
    newId: "d2b",
  });
  assert.ok(validateRecipe(after).some((e) => /has no inputs/.test(e)));
});

test("mergeStepInto folds a step into its consumer, keeping the consumer's id", () => {
  const after = applyEdit(RECIPE(), { type: "mergeStepInto", stepId: "d1" });
  assert.ok(!stepIds(after).includes("d1"));
  assert.deepEqual(inputsOf(after, "d2"), ["avocados", "lime", "salt"], "spliced in place");
  assert.deepEqual(validateRecipe(after), []);
});

test("merge keeps the consumer's label by default, or the one given", () => {
  const dflt = applyEdit(RECIPE(), { type: "mergeStepInto", stepId: "d1" });
  assert.equal(dflt.sections[0].nodes.find((n) => n.id === "d2")!.label, "mash");
  const chosen = applyEdit(RECIPE(), {
    type: "mergeStepInto",
    stepId: "d1",
    label: "halve and scoop",
  });
  assert.equal(chosen.sections[0].nodes.find((n) => n.id === "d2")!.label, "halve and scoop");
});

test("merging the root is refused — there is nothing after it", () => {
  assert.throws(
    () => applyEdit(RECIPE(), { type: "mergeStepInto", stepId: "d4" }),
    /nothing after it/
  );
});

test("split then merge returns the tree to its original shape", () => {
  const before = RECIPE();
  const split = applyEdit(before, {
    type: "splitStep",
    stepId: "d2",
    firstLabel: "mash",
    secondLabel: "season",
    toSecond: ["salt"],
    newId: "d2b",
  });
  const back = applyEdit(split, { type: "mergeStepInto", stepId: "d2", label: "mash" });
  const merged = back.sections[0].nodes.find((n) => n.id === "d2b")!;
  assert.deepEqual(merged.inputs, ["d1", "lime", "salt"], "inputs are restored in order");
  assert.equal(merged.label, "mash");
  assert.deepEqual(validateRecipe(back), []);
});

test("the new ops never mutate the recipe they are given", () => {
  const before = RECIPE();
  const snapshot = JSON.stringify(before);
  applyEdit(before, { type: "addStepAfter", afterStepId: "d2", label: "x" });
  applyEdit(before, { type: "deleteStep", stepId: "d2" });
  applyEdit(before, {
    type: "splitStep",
    stepId: "d2",
    firstLabel: "a",
    secondLabel: "b",
    toSecond: ["salt"],
  });
  applyEdit(before, { type: "mergeStepInto", stepId: "d1" });
  assert.equal(JSON.stringify(before), snapshot);
});

test("minted step ids do not collide with existing ones", () => {
  let r = RECIPE();
  for (let i = 0; i < 5; i++) {
    r = applyEdit(r, { type: "addStepAfter", afterStepId: "d4", label: `step ${i}` });
  }
  const ids = [...r.sections[0].ingredients.map((x) => x.id), ...stepIds(r)];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(validateRecipe(r), []);
});

// ------------------------------------------------------------ step timing --

test("setStepFields sets minutes and tempF without touching the label", () => {
  const after = applyEdit(RECIPE(), {
    type: "setStepFields",
    stepId: "d4",
    fields: { minutes: 10, tempF: 325 },
  });
  assert.equal(step(after, "d4").label, "fold together");
  assert.equal(step(after, "d4").minutes, 10);
  assert.equal(step(after, "d4").tempF, 325);
  assert.deepEqual(validateRecipe(after), []);
});

test("an absent field is left alone and a null one clears it", () => {
  // The whole reason these ops take a bag rather than a value: a sheet
  // commits on blur, and blurring the label box must not wipe the time.
  const timed = applyEdit(RECIPE(), {
    type: "setStepFields",
    stepId: "d4",
    fields: { minutes: 10, tempF: 325 },
  });
  const renamed = applyEdit(timed, {
    type: "setStepFields",
    stepId: "d4",
    fields: { label: "fold gently" },
  });
  assert.equal(renamed.sections[0].nodes.find((n) => n.id === "d4")!.minutes, 10);

  const cleared = applyEdit(renamed, {
    type: "setStepFields",
    stepId: "d4",
    fields: { minutes: null },
  });
  assert.equal(step(cleared, "d4").minutes, null);
  assert.equal(step(cleared, "d4").tempF, 325);
});

test("parseTiming takes what people type and refuses what breaks a timer", () => {
  assert.equal(parseTiming("12"), 12);
  assert.equal(parseTiming(" 90 "), 90);
  assert.equal(parseTiming("1 1/2"), 1.5);
  assert.equal(parseTiming("½"), 0.5);
  assert.equal(parseTiming(""), null);
  assert.equal(parseTiming("soon"), null);
  assert.equal(parseTiming("12 min"), null);
  // A negative time would run the timer backwards; it is absent, not an error.
  assert.equal(parseTiming("-5"), null);
});

// --------------------------------------------------------- add ingredient --

test("addIngredient appends to the section and to the step's inputs", () => {
  const after = applyEdit(RECIPE(), {
    type: "addIngredient",
    toStepId: "d3",
    fields: { qty: 2, unit: "tbsp", name: "cilantro" },
  });
  const added = after.sections[0].ingredients.at(-1)!;
  assert.equal(added.name, "cilantro");
  assert.equal(added.qty, 2);
  assert.equal(added.unit, "tbsp");
  // Appended, not inserted: row order comes from input order, and inserting
  // would push existing rows around under someone who was reading them.
  assert.deepEqual(step(after, "d3").inputs, ["onion", "tomato", added.id]);
  assert.deepEqual(validateRecipe(after), []);
});

test("a minted ingredient id is derived from the name and never collides", () => {
  const one = applyEdit(RECIPE(), {
    type: "addIngredient",
    toStepId: "d3",
    fields: { qty: 1, unit: null, name: "Roma Tomato" },
  });
  assert.equal(one.sections[0].ingredients.at(-1)!.id, "roma_tomato");

  const two = applyEdit(one, {
    type: "addIngredient",
    toStepId: "d3",
    fields: { qty: 1, unit: null, name: "Roma Tomato" },
  });
  assert.equal(two.sections[0].ingredients.at(-1)!.id, "roma_tomato_1");
  assert.deepEqual(validateRecipe(two), []);
});

test("an unnameable ingredient still gets a truthy id", () => {
  // validateRecipe requires an id; a name of "…" slugs to nothing.
  const after = applyEdit(RECIPE(), {
    type: "addIngredient",
    toStepId: "d3",
    fields: { qty: 1, unit: null, name: "…" },
  });
  const added = after.sections[0].ingredients.at(-1)!;
  assert.ok(added.id);
  assert.ok(!after.sections[0].ingredients.some((i) => i !== added && i.id === added.id));
});

test("adding a nameless ingredient is a validator problem, not a thrown one", () => {
  const after = applyEdit(RECIPE(), {
    type: "addIngredient",
    toStepId: "d3",
    fields: { qty: 1, unit: null, name: "" },
  });
  assert.ok(validateRecipe(after).some((e) => /missing a name/.test(e)));
});

test("addIngredient onto something that is not a step throws", () => {
  assert.throws(
    () =>
      applyEdit(RECIPE(), {
        type: "addIngredient",
        toStepId: "salt",
        fields: { qty: 1, unit: null, name: "pepper" },
      }),
    EditTargetError
  );
});

// ------------------------------------------------------ delete ingredient --

test("deleteIngredient removes the row and the input naming it", () => {
  const after = applyEdit(RECIPE(), { type: "deleteIngredient", ingredientId: "salt" });
  assert.ok(!after.sections[0].ingredients.some((i) => i.id === "salt"));
  assert.deepEqual(step(after, "d2").inputs, ["d1", "lime"]);
  assert.deepEqual(validateRecipe(after), []);
});

test("deleting a step's only input leaves an invalid tree rather than cascading", () => {
  // d1's only input is `avocados`. Removing it must NOT also remove d1: one
  // tap deleting two things is a destructive reading of "delete", and
  // deleteStep already exists and splices properly.
  const after = applyEdit(RECIPE(), { type: "deleteIngredient", ingredientId: "avocados" });
  assert.ok(after.sections[0].nodes.some((n) => n.id === "d1"));
  assert.ok(validateRecipe(after).some((e) => /no inputs/.test(e)));
});

test("deleteIngredientBlocker says why, in words that name the step", () => {
  assert.equal(deleteIngredientBlocker(RECIPE(), "salt"), null);
  const why = deleteIngredientBlocker(RECIPE(), "avocados");
  assert.ok(why);
  assert.match(why!, /halve and scoop/);
  assert.match(why!, /Delete the step instead/);
});

test("deleteIngredient on a step id throws, because that is a caller bug", () => {
  assert.throws(
    () => applyEdit(RECIPE(), { type: "deleteIngredient", ingredientId: "d2" }),
    EditTargetError
  );
});

test("add then delete round-trips to the original tree", () => {
  const before = RECIPE();
  const added = applyEdit(before, {
    type: "addIngredient",
    toStepId: "d3",
    fields: { qty: 2, unit: "tbsp", name: "cilantro" },
  });
  const back = applyEdit(added, { type: "deleteIngredient", ingredientId: "cilantro" });
  assert.deepEqual(back, before);
});

test("the ingredient ops do not mutate the input recipe", () => {
  const before = RECIPE();
  const snapshot = JSON.stringify(before);
  applyEdit(before, {
    type: "addIngredient",
    toStepId: "d3",
    fields: { qty: 1, unit: null, name: "pepper" },
  });
  applyEdit(before, { type: "deleteIngredient", ingredientId: "salt" });
  applyEdit(before, { type: "setStepFields", stepId: "d4", fields: { minutes: 5 } });
  assert.equal(JSON.stringify(before), snapshot);
});
