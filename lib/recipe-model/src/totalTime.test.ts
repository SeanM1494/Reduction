import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TOTAL_MINUTES, parseIsoDuration, recipeTotalMinutes, sanitizeTotalMinutes, setRecipeTotalMinutes } from "./totalTime";

test("schema.org totalTime: the shapes real recipe sites publish", () => {
  const cases: Array<[unknown, number | null]> = [
    ["PT30M", 30],
    ["PT1H30M", 90],
    ["PT2H30M", 150],
    ["PT90M", 90],
    ["PT1.5H", 90],
    ["P1DT2H", 1560],
    ["PT0H45M", 45],
    ["P0Y0M0DT0H45M0.000S", 45], // generator-style, zeros spelled out
    ["pt20m", 20],
    ["  PT20M ", 20],
    ["PT30S", 1],
  ];
  for (const [raw, want] of cases) assert.equal(parseIsoDuration(raw), want, String(raw));
});

test("schema.org totalTime: anything that is not a stated duration is null, never a guess", () => {
  const cases: unknown[] = [
    "PT0M", // sites that never set a time publish zero
    "PT0S",
    "P",
    "PT",
    "45 minutes", // free text in a structured field is not trusted
    "1:30",
    "P1M", // a month is not a recipe time
    "P1Y",
    "",
    null,
    undefined,
    30,
    {},
    ["PT30M"],
    "P8D", // past a week
  ];
  for (const raw of cases) assert.equal(parseIsoDuration(raw), null, JSON.stringify(raw) ?? String(raw));
});

test("the gate: whole minutes in (0, a week], anything else null", () => {
  assert.equal(sanitizeTotalMinutes(45), 45);
  assert.equal(sanitizeTotalMinutes(44.6), 45);
  assert.equal(sanitizeTotalMinutes(MAX_TOTAL_MINUTES), MAX_TOTAL_MINUTES);
  for (const bad of [0, -5, MAX_TOTAL_MINUTES + 1, Number.NaN, Infinity, "45", null, undefined])
    assert.equal(sanitizeTotalMinutes(bad), null, String(bad));
});

test("reading: a recipe states its time, or says nothing — and junk says nothing", () => {
  assert.equal(recipeTotalMinutes({ title: "x", totalMinutes: 45 }), 45);
  assert.equal(recipeTotalMinutes({ title: "x" }), null, "recipes from before this existed");
  assert.equal(recipeTotalMinutes({ title: "x", totalMinutes: "45 min" }), null);
  assert.equal(recipeTotalMinutes({ title: "x", totalMinutes: 0 }), null);
  assert.equal(recipeTotalMinutes(null), null);
});

test("writing: through the gate, and a value that fails leaves no key behind", () => {
  const r: Record<string, unknown> = { title: "x" };
  setRecipeTotalMinutes(r, 45);
  assert.equal(r.totalMinutes, 45);
  setRecipeTotalMinutes(r, "a while");
  assert.equal("totalMinutes" in r, false, "removed, not stored as null — the JSON looks as it always did");
  setRecipeTotalMinutes(r, null);
  assert.equal("totalMinutes" in r, false);
});
