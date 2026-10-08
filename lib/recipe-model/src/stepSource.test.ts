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

import { boundStepSources, claimedStepCount } from "./stepSource";

test("boundStepSources drops tags past the end of the source's method, keeps the rest", () => {
  const r: any = { sections: [{ nodes: [{ id: "a", src: 1 }, { id: "b", src: 3 }, { id: "c", src: 4 }, { id: "d" }] }] };
  boundStepSources(r, 3);
  assert.deepEqual(r.sections[0].nodes.map((n: any) => n.src), [1, 3, undefined, undefined]);
  assert.ok(!("src" in r.sections[0].nodes[2]));
});

test("boundStepSources does nothing when the count is unknown", () => {
  for (const c of [null, undefined, 0, -1, 2.5]) {
    const r: any = { sections: [{ nodes: [{ id: "a", src: 9 }] }] };
    boundStepSources(r, c as any);
    assert.equal(r.sections[0].nodes[0].src, 9);
  }
});

test("claimedStepCount counts steps, not headings, and is null without any", () => {
  assert.equal(claimedStepCount({ steps: ["a", { heading: "For the sauce" }, "b"] }), 2);
  assert.equal(claimedStepCount({ steps: [] }), null);
  assert.equal(claimedStepCount(null), null);
  assert.equal(claimedStepCount({}), null);
});

test("claimedStepCount is unknown for a wording the token limit cut short", () => {
  assert.equal(claimedStepCount({ steps: ["a", "b"], truncated: true }), null);
});
