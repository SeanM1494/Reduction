import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTags, costUsd, outline, ruleOf, summarize, tallyRules, words, type EvalResult } from "./evalReport";
import type { Recipe } from "../shared/layout";

const ORIGINAL = {
  ingredients: [{ text: "1 egg" }],
  steps: [
    { text: "Preheat the oven to 400°F." },
    { text: "Melt the butter in a large skillet and sauté the sausage and pepper for 5 minutes." },
    { text: "Pour in the eggs and cheddar and scramble until just set." },
    { text: "Spoon the filling onto the pastry and fold it over." },
  ],
  truncated: false,
  from: "page" as const,
};

const tree = (srcs: Array<number | null>): Recipe =>
  ({
    title: "t",
    servings: 1,
    sections: [
      {
        name: "Pockets",
        ingredients: [
          { id: "b", qty: 1, unit: null, name: "butter" },
          { id: "s", qty: 1, unit: null, name: "sausage" },
          { id: "e", qty: 1, unit: null, name: "eggs" },
          { id: "p", qty: 1, unit: null, name: "puff pastry" },
        ],
        nodes: [
          { id: "n1", label: "sauté", inputs: ["b", "s"], ...(srcs[0] != null ? { src: srcs[0] } : {}) },
          { id: "n2", label: "scramble", inputs: ["n1", "e"], ...(srcs[1] != null ? { src: srcs[1] } : {}) },
          { id: "n3", label: "fill and fold", inputs: ["n2", "p"], ...(srcs[2] != null ? { src: srcs[2] } : {}) },
        ],
        root: "n3",
      },
    ],
  }) as Recipe;

test("words: content words, crudely stemmed, stopwords and units out", () => {
  assert.deepEqual([...words("Spoon the filling onto the pastry and fold it over")].sort(), ["fill", "fold", "pastry", "spoon"]);
  assert.equal(words("bake 400°F 20 min").has("bake"), true);
  assert.equal(words("bake 400°F 20 min").has("min"), false);
});

test("right tags pass; each wrong kind is flagged by name", () => {
  const good = checkTags(tree([2, 3, 4]), ORIGINAL);
  assert.equal(good.tagged, 3);
  assert.deepEqual(good.suspects, []);

  // Scramble pointed at the preheat: nothing in common.
  const swapped = checkTags(tree([2, 1, 4]), ORIGINAL);
  assert.deepEqual(
    swapped.suspects.map((r) => [r.label, r.flag]),
    [["scramble", "no shared words"]]
  );

  // A number past the end of the source, and a tag earlier than an input's.
  assert.equal(checkTags(tree([2, 3, 9]), ORIGINAL).suspects[0].flag, "out of range");
  // A tag that shares words with its sentence but numbers the step BEFORE
  // a step it depends on: the tree says that cannot be.
  const reordered = {
    ...ORIGINAL,
    steps: [{ text: "Scramble the eggs into the sausage." }, { text: "Sauté the sausage in butter." }, { text: "Fill the pastry and fold it." }],
  };
  const inverted = checkTags(tree([2, 1, 3]), reordered);
  assert.deepEqual(
    inverted.suspects.map((r) => [r.label, r.flag]),
    [["scramble", "before its input"]]
  );

  // A reply cut off before its wording says nothing about the tags.
  const noWording = checkTags(tree([2, 3, 4]), null);
  assert.deepEqual(noWording.rows.map((r) => r.flag), ["no wording to check", "no wording to check", "no wording to check"]);
  assert.deepEqual(noWording.suspects, []);
  const cut = checkTags(tree([2, 3, 9]), { ...ORIGINAL, truncated: true });
  assert.equal(cut.rows[2].flag, "past the wording's cut-off");

  // Untagged is counted, not flagged as wrong.
  const none = checkTags(tree([null, null, null]), ORIGINAL);
  assert.equal(none.tagged, 0);
  assert.deepEqual(none.suspects, []);
});

test("summary counts retries, cap hits and runs past the phone's old limit", () => {
  const r = (config: string, ms: number, calls: number, stops: string[]): EvalResult => ({
    caseId: "x",
    kind: "url",
    config,
    ok: true,
    ms,
    path: "jsonld",
    calls,
    attempts: calls,
    stopReasons: stops,
    failures: [],
    inputTokens: 1000,
    outputTokens: 1000,
    recipe: null,
    original: null,
  });
  const [a] = summarize([r("A", 130_000, 2, ["max_tokens", "end_turn"]), r("A", 20_000, 1, ["end_turn"])]);
  assert.deepEqual(
    { runs: a.runs, over120: a.over120, multiCall: a.multiCall, hitCap: a.hitCap, maxS: a.maxS },
    { runs: 2, over120: 1, multiCall: 1, hitCap: 1, maxS: 130 }
  );
  assert.equal(costUsd(1_000_000, 100_000), 3);
});

test("outline shows tags so a reader can check them by eye", () => {
  assert.match(outline(tree([2, 3, 4])), /scramble \(src 3\) ← \[sauté\], eggs/);
});

test("turned-down answers are tallied by rule, without the particulars", () => {
  assert.equal(ruleOf('section "Dough": step "dough_6" is missing a label.'), 'step "…" is missing a label.');
  assert.equal(ruleOf('section 2: "final_rice" has no qty and no text fallback. One is required.'), '"…" has no qty and no text fallback. One is required.');
  assert.equal(ruleOf("Response was not valid JSON: Unexpected end of JSON input"), "Response was not valid JSON.");
  assert.equal(ruleOf('section "A": "x" has unit "pinch". Use one of cup, tbsp, or null.'), '"…" has unit "…". Use one of the allowed units.');

  const r = (caseId: string, failures: string[][]): EvalResult => ({
    caseId,
    kind: "text",
    config: "S",
    ok: true,
    ms: 1,
    path: "paste",
    calls: failures.length + 1,
    attempts: failures.length + 1,
    stopReasons: [],
    failures,
    inputTokens: 0,
    outputTokens: 0,
    recipe: null,
    original: null,
  });
  const rules = tallyRules([
    // One answer breaking a rule on two steps counts ONCE for that answer.
    r("a", [['section "X": step "s1" is missing a label.', 'section "X": step "s2" is missing a label.']]),
    r("b", [['section "Y": step "q" is missing a label.', 'section "Y": "egg" qty must be a number, not a string.']]),
    r("c", []),
  ]);
  assert.deepEqual(
    rules.map((x) => [x.rule, x.answers, x.cases]),
    [
      ['step "…" is missing a label.', 2, ["a", "b"]],
      ['"…" qty must be a number, not a string.', 1, ["b"]],
    ]
  );
  const [s] = summarize([r("a", [["x"]]), r("b", [["y"], ["z"]])]);
  assert.equal(s.turnedDown, 3);
});
