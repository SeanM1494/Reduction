import test from "node:test";
import assert from "node:assert/strict";
import { labelTiming, sanitizeStepTimings } from "./stepTiming";
import type { Recipe } from "./layout";

test("labelTiming reads time and °F the label states", () => {
  assert.deepEqual(labelTiming("bake 325°F 12 min"), { minutes: 12, tempF: 325 });
  assert.deepEqual(labelTiming("chill 4 hr"), { minutes: 240, tempF: null });
  assert.deepEqual(labelTiming("simmer 1 hr 15 min"), { minutes: 75, tempF: null });
  assert.deepEqual(labelTiming("bake 20-25 min"), { minutes: 20, tempF: null });
  assert.deepEqual(labelTiming("toast 30 sec"), { minutes: 0.5, tempF: null });
  assert.deepEqual(labelTiming("simmer 1½ hr"), { minutes: 90, tempF: null });
  assert.deepEqual(labelTiming("whisk until smooth"), { minutes: null, tempF: null });
  assert.deepEqual(labelTiming("press into 10-in pan"), { minutes: null, tempF: null });
  assert.deepEqual(labelTiming("fry 350 F"), { minutes: null, tempF: 350 });
});

const recipe = (nodes: any[]): Recipe => ({
  title: "t",
  servings: null,
  sections: [{ name: "s", ingredients: [], nodes, root: "n1" }],
});

test("sanitizeStepTimings fills nulls from the label and never overwrites a filled field", () => {
  const r = recipe([
    { id: "n1", label: "bake 350°F 25 min", inputs: ["x"] },
    { id: "n2", label: "sear 3 min per side", inputs: ["x"], minutes: 6, tempF: null },
    { id: "n3", label: "mix", inputs: ["x"], minutes: "12", tempF: "oops" },
  ]);
  assert.equal(sanitizeStepTimings(r), 2);
  const [a, b, c] = r.sections[0].nodes;
  assert.deepEqual([a.minutes, a.tempF], [25, 350]);
  assert.deepEqual([b.minutes, b.tempF], [6, null]);
  assert.deepEqual([c.minutes, c.tempF], [12, null]);
});
