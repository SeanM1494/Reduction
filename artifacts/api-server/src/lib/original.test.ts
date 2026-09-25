import { test } from "node:test";
import assert from "node:assert/strict";
import { closeTruncatedJson, takeOriginal } from "./original";
import { sanitizeOriginal } from "@workspace/recipe-model";

const TREE = '{"title":"T","sections":[{"name":"T","ingredients":[{"id":"a","name":"egg"}],"nodes":[{"id":"n","label":"beat","inputs":["a"]}],"root":"n"}]';

test("a complete reply comes back as it was", () => {
  const whole = `${TREE},"original":{"ingredients":["1 egg"],"steps":["Beat it."]}}`;
  assert.equal(closeTruncatedJson(whole), whole);
  assert.equal(closeTruncatedJson("```json\n" + whole + "\n```"), whole);
});

test("a reply cut mid-step keeps the tree and every complete line", () => {
  const cut = `${TREE},"original":{"ingredients":["1 egg","2 cups flour"],"steps":["Beat it.","Fold in the fl`;
  const parsed = JSON.parse(closeTruncatedJson(cut));
  assert.equal(parsed.sections[0].root, "n");
  assert.deepEqual(parsed.original, { ingredients: ["1 egg", "2 cups flour"], steps: ["Beat it."] });
});

test("a cut inside a heading object, or right after a key, still closes", () => {
  for (const cut of [
    `${TREE},"original":{"ingredients":["1 egg",{"heading":"For the gl`,
    `${TREE},"original":{"ingredients":["1 egg"],"steps":`,
    `${TREE},"original":{"ingr`,
    `${TREE},"orig`,
    `${TREE},"original":{"ingredients":["a \\"quoted\\" egg","b`,
  ]) {
    const parsed = JSON.parse(closeTruncatedJson(cut));
    assert.equal(parsed.title, "T", cut);
  }
  assert.deepEqual(
    JSON.parse(closeTruncatedJson(`${TREE},"original":{"ingredients":["a \\"quoted\\" egg","b`)).original.ingredients,
    ['a "quoted" egg']
  );
});

test("a cut inside the tree closes to JSON that validation then rejects", () => {
  const parsed = JSON.parse(closeTruncatedJson('{"title":"T","sections":[{"name":"T","ingredients":[{"id":"a","na'));
  assert.equal(parsed.title, "T");
  assert.equal(parsed.sections[0].root, undefined);
});

test("takeOriginal lifts the wording off the tree, and marks a cut-off one truncated", () => {
  const parsed: Record<string, unknown> = JSON.parse(`${TREE},"original":{"ingredients":["1 egg"],"steps":[]}}`);
  const o = takeOriginal(parsed, true);
  assert.equal("original" in parsed, false, "the tree is validated without it");
  assert.equal(sanitizeOriginal(o, "text")?.truncated, true);
  assert.equal(takeOriginal({ title: "no wording" }, false), null);
  assert.equal(takeOriginal({ original: "a string" }, false), null);
});
