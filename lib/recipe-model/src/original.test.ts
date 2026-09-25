import { test } from "node:test";
import assert from "node:assert/strict";
import { ORIGINAL_LIMITS, originalStepNumbers, sanitizeOriginal } from "./original";

test("keeps each line as its own element, in order, with headings marked", () => {
  const o = sanitizeOriginal(
    {
      ingredients: ["2 cups flour", { heading: "For the frosting" }, "1 cup  powdered sugar"],
      steps: ["Preheat the oven to 350°F.", "Mix."],
    },
    "page"
  );
  assert.deepEqual(o, {
    ingredients: [{ text: "2 cups flour" }, { text: "For the frosting", heading: true }, { text: "1 cup powdered sugar" }],
    steps: [{ text: "Preheat the oven to 350°F." }, { text: "Mix." }],
    truncated: false,
    from: "page",
  });
});

test("the stored shape passes through unchanged", () => {
  const stored = {
    ingredients: [{ text: "For the dough", heading: true as const }, { text: "1 egg" }],
    steps: [{ text: "Beat the egg." }],
    truncated: true,
    from: "text" as const,
  };
  assert.deepEqual(sanitizeOriginal(stored, "text"), stored);
});

test("tags and entities from JSON-LD come out as text", () => {
  const o = sanitizeOriginal({ ingredients: ["1&nbsp;cup <b>milk</b> &amp; honey"], steps: [] }, "page");
  assert.equal(o?.ingredients[0].text, "1 cup milk & honey");
});

test("nothing usable is null — including headings with no lines", () => {
  assert.equal(sanitizeOriginal(null, "page"), null);
  assert.equal(sanitizeOriginal({ ingredients: [], steps: [] }, "page"), null);
  assert.equal(sanitizeOriginal({ ingredients: [{ heading: "For the dough" }], steps: ["  "] }, "page"), null);
  assert.equal(sanitizeOriginal("2 cups flour", "page"), null);
});

test("a heading with nothing under it is dropped", () => {
  const o = sanitizeOriginal({ ingredients: ["1 egg", { heading: "Garnish" }], steps: [{ heading: "A" }, { heading: "B" }, "Go."] }, "page");
  assert.deepEqual(o?.ingredients, [{ text: "1 egg" }]);
  assert.deepEqual(o?.steps, [{ text: "B", heading: true }, { text: "Go." }]);
});

test("a long recipe is truncated, never refused", () => {
  const many = Array.from({ length: ORIGINAL_LIMITS.steps + 5 }, (_, i) => `Step ${i + 1}.`);
  const o = sanitizeOriginal({ ingredients: ["1 egg"], steps: many }, "page");
  assert.equal(o?.steps.length, ORIGINAL_LIMITS.steps);
  assert.equal(o?.truncated, true);
});

test("an over-long line is cut with an ellipsis and marks the recipe truncated", () => {
  const o = sanitizeOriginal({ ingredients: ["1 egg"], steps: ["x".repeat(ORIGINAL_LIMITS.line + 50)] }, "page");
  assert.equal(o?.steps[0].text.length, ORIGINAL_LIMITS.line + 1);
  assert.ok(o?.steps[0].text.endsWith("…"));
  assert.equal(o?.truncated, true);
});

test("the total budget stops the lists rather than growing without bound", () => {
  const line = "y".repeat(1000);
  const o = sanitizeOriginal({ ingredients: Array(60).fill(line), steps: Array(60).fill(line) }, "page");
  const total = [...o!.ingredients, ...o!.steps].reduce((n, l) => n + l.text.length, 0);
  assert.ok(total <= ORIGINAL_LIMITS.total);
  assert.equal(o?.truncated, true);
});

test("truncated from upstream (a cut-off model reply) is kept", () => {
  assert.equal(sanitizeOriginal({ ingredients: ["1 egg"], steps: [], truncated: true }, "photo")?.truncated, true);
});

test("steps are numbered across headings, headings unnumbered", () => {
  assert.deepEqual(
    originalStepNumbers([{ text: "a" }, { text: "H", heading: true }, { text: "b" }, { text: "c" }]),
    [1, null, 2, 3]
  );
});
