/**
 * shared/progress.test.ts — what reconcileDone owes.
 *
 * Editing a tree can strand progress, and progress is the thing a user
 * accumulates while standing at a hob. These cases pin down both halves:
 * nothing dangling survives, and nothing that still exists is thrown away.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDone, idsInRecipe } from "./progress";
import type { Recipe } from "./layout";

const recipe = (ingredientIds: string[], stepIds: string[]): Recipe =>
  ({
    title: "T",
    servings: 1,
    sections: [
      {
        name: "S",
        ingredients: ingredientIds.map((id) => ({ id, qty: 1, unit: null, name: id })),
        nodes: stepIds.map((id) => ({ id, label: id, inputs: [] })),
        root: stepIds[stepIds.length - 1] ?? "",
      },
    ],
  }) as Recipe;

test("an unchanged tree keeps every entry, in order", () => {
  const r = recipe(["a", "b"], ["s1", "s2"]);
  const got = reconcileDone(r, ["a", "s1", "b"]);
  assert.deepEqual(got.done, ["a", "s1", "b"]);
  assert.deepEqual(got.dropped, []);
});

test("entries whose ids are gone are dropped, and reported", () => {
  const r = recipe(["a"], ["s1"]);
  const got = reconcileDone(r, ["a", "deleted-step", "s1", "removed-ingredient"]);
  assert.deepEqual(got.done, ["a", "s1"]);
  assert.deepEqual(
    got.dropped,
    ["deleted-step", "removed-ingredient"],
    "the caller shows these, so a user is never silently un-completed"
  );
});

test("a renamed id counts as gone", () => {
  // Renaming is how most ids disappear in practice: the tree still has the
  // same shape, but the old string no longer refers to anything.
  const before = reconcileDone(recipe(["flour"], ["mix"]), ["flour", "mix"]);
  assert.deepEqual(before.dropped, []);
  const after = reconcileDone(recipe(["plain-flour"], ["mix"]), ["flour", "mix"]);
  assert.deepEqual(after.done, ["mix"]);
  assert.deepEqual(after.dropped, ["flour"]);
});

test("progress survives an edit that only changes labels", () => {
  // The common case, and the reason this prunes rather than clearing.
  const r = recipe(["a", "b"], ["s1"]);
  r.sections[0].nodes[0].label = "a much better label";
  const got = reconcileDone(r, ["a", "b", "s1"]);
  assert.deepEqual(got.done, ["a", "b", "s1"]);
  assert.deepEqual(got.dropped, []);
});

test("ids are collected across every section", () => {
  const r = recipe(["a"], ["s1"]);
  r.sections.push({
    name: "second",
    ingredients: [{ id: "b", qty: 1, unit: null, name: "b" }],
    nodes: [{ id: "s2", label: "s2", inputs: [] }],
    root: "s2",
  } as Recipe["sections"][number]);
  const got = reconcileDone(r, ["a", "s1", "b", "s2"]);
  assert.deepEqual(got.done, ["a", "s1", "b", "s2"]);
  assert.deepEqual([...idsInRecipe(r)].sort(), ["a", "b", "s1", "s2"]);
});

test("duplicates collapse", () => {
  const got = reconcileDone(recipe(["a"], ["s1"]), ["a", "a", "s1", "a"]);
  assert.deepEqual(got.done, ["a", "s1"]);
});

test("an empty done set stays empty rather than erroring", () => {
  const got = reconcileDone(recipe(["a"], ["s1"]), []);
  assert.deepEqual(got.done, []);
  assert.deepEqual(got.dropped, []);
});

test("a malformed recipe drops everything instead of throwing", () => {
  // This runs against JSON a user typed, so it meets shapes the types say
  // are impossible. Losing the checkmarks is recoverable; a crash on the
  // save path is not.
  for (const bad of [null, undefined, 42, "nope", {}, { sections: null }, { sections: [null] }]) {
    const got = reconcileDone(bad, ["a", "b"]);
    assert.deepEqual(got.done, [], `expected nothing kept for ${JSON.stringify(bad)}`);
    assert.deepEqual(got.dropped, ["a", "b"]);
  }
});

test("a malformed done set is tolerated", () => {
  const got = reconcileDone(recipe(["a"], ["s1"]), [null, 7, "a", undefined, "s1"]);
  assert.deepEqual(got.done, ["a", "s1"]);
});

test("sections missing their arrays contribute no ids and do not throw", () => {
  const got = reconcileDone({ title: "T", servings: 1, sections: [{ name: "S" }] }, ["a"]);
  assert.deepEqual(got.done, []);
  assert.deepEqual(got.dropped, ["a"]);
});
