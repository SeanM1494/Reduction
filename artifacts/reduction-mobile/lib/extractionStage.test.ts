import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, LAST_STAGE, SLOW_AFTER_MS, SLOW_MESSAGE, STAGE_MS, STAGES, stageAfter } from "./extractionStage";

// The literals are the web's (artifacts/reduction/src/components/
// ExtractionProgress.tsx). Pasted rather than imported: that file imports
// React and cannot load under node, and a drift between the two clients is
// exactly what this test exists to catch.
test("the five stages and their pace are the web's, verbatim and in order", () => {
  assert.deepEqual([...STAGES], [
    "Reading the recipe",
    "Bringing it to a simmer",
    "Cooking it down",
    "Skimming the excess",
    "Down to the essence",
  ]);
  assert.equal(STAGE_MS, 3000);
  assert.equal(LAST_STAGE, 4);
});

test("stageAfter walks the arc one tick at a time and rests on the last", () => {
  assert.equal(STAGES[stageAfter(0)], "Reading the recipe");
  assert.equal(STAGES[stageAfter(1)], "Bringing it to a simmer");
  assert.equal(STAGES[stageAfter(2)], "Cooking it down");
  assert.equal(STAGES[stageAfter(3)], "Skimming the excess");
  assert.equal(STAGES[stageAfter(4)], "Down to the essence");
  // A wait that outlasts the sequence never loops back to the start.
  assert.equal(stageAfter(5), LAST_STAGE);
  assert.equal(stageAfter(400), LAST_STAGE);
});

test("stageAfter is defensive about its input", () => {
  assert.equal(stageAfter(-1), 0);
  assert.equal(stageAfter(NaN), 0);
  assert.equal(stageAfter(Infinity), 0);
  assert.equal(stageAfter(2.9), 2);
});

test("advance reaches the last stage in four steps and says when the clock can stop", () => {
  let i = 0;
  const seen: number[] = [];
  for (let n = 0; n < 10; n++) {
    const { next, done } = advance(i);
    seen.push(next);
    i = next;
    if (done) break;
  }
  assert.deepEqual(seen, [1, 2, 3, 4]);
  // Already at the end: stays there, still done.
  assert.deepEqual(advance(LAST_STAGE), { next: LAST_STAGE, done: true });
});

test("a long wait says so, well after the last stage and well before the timeout", () => {
  assert.ok(SLOW_AFTER_MS > STAGE_MS * STAGES.length * 2, "not while the stages are still walking");
  assert.ok(SLOW_AFTER_MS < 180_000 / 2, "early enough to matter before the phone gives up");
  assert.ok(SLOW_MESSAGE.length <= 42, "one line on an SE, ellipsis included");
});
