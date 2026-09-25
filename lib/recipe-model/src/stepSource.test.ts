import { test } from "node:test";
import assert from "node:assert/strict";
import { hasStepSources, sanitizeStepSource, sanitizeStepSources, stepSource } from "./stepSource";

test("a source step number is a whole number from 1 up, and nothing else", () => {
  assert.equal(sanitizeStepSource(3), 3);
  for (const bad of [0, -1, 2.5, "3", null, undefined, NaN, 401]) assert.equal(sanitizeStepSource(bad), null, String(bad));
});

test("the gate keeps good tags, removes bad ones as KEYS, and leaves an untagged tree untouched", () => {
  const tree = {
    sections: [
      { nodes: [{ id: "a", src: 2 }, { id: "b", src: "4" }, { id: "c", src: 0 }, { id: "d" }] },
    ],
  };
  sanitizeStepSources(tree);
  assert.deepEqual(tree.sections[0].nodes, [{ id: "a", src: 2 }, { id: "b" }, { id: "c" }, { id: "d" }]);
  const plain = { sections: [{ nodes: [{ id: "a" }] }] };
  const before = JSON.stringify(plain);
  sanitizeStepSources(plain);
  assert.equal(JSON.stringify(plain), before);
  assert.equal(sanitizeStepSources(null), null);
});

test("hasStepSources is the switch: one valid tag turns source order on", () => {
  const r = (nodes: object[]) => ({ title: "t", servings: 1, sections: [{ name: "s", ingredients: [], nodes, root: "a" }] }) as never;
  assert.equal(hasStepSources(r([{ id: "a", label: "x", inputs: [] }])), false);
  assert.equal(hasStepSources(r([{ id: "a", label: "x", inputs: [], src: 0 }])), false);
  assert.equal(hasStepSources(r([{ id: "a", label: "x", inputs: [], src: 1 }])), true);
  assert.equal(stepSource({ id: "a", label: "x", inputs: [], src: 5 } as never), 5);
});
