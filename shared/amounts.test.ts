/**
 * shared/amounts.test.ts — the timing helpers.
 *
 * Only those two, deliberately: `formatAmount` and the scaling functions are
 * exercised through the fixtures in the layout and sequence suites, but
 * `formatMinutes` and `stepMinutes` exist to survive input those never carry.
 * `minutes` is a box a person types into and a field `validateRecipe` has no
 * opinion on, so it is the one number in a stored recipe that can be any
 * shape at all by the time it reaches a render.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { formatMinutes, stepMinutes } from "./amounts";

test("formatMinutes renders minutes and hours", () => {
  assert.equal(formatMinutes(12), "12 min");
  assert.equal(formatMinutes(59), "59 min");
  assert.equal(formatMinutes(60), "1 hr");
  assert.equal(formatMinutes(90), "1 hr 30 min");
  assert.equal(formatMinutes(125), "2 hr 5 min");
  // Fractions are typeable ("1 1/2"), so they must not render as "1.5 min".
  assert.equal(formatMinutes(1.5), "2 min");
});

test("formatMinutes returns null for anything that is not a usable number", () => {
  // The failure this exists for: "12 min" is truthy, so every caller's
  // `step.minutes ? …` test passed it straight into `min < 60`.
  assert.equal(formatMinutes("12 min"), null);
  assert.equal(formatMinutes("12"), null);
  assert.equal(formatMinutes(null), null);
  assert.equal(formatMinutes(undefined), null);
  assert.equal(formatMinutes(0), null);
  assert.equal(formatMinutes(-5), null);
  assert.equal(formatMinutes(NaN), null);
  assert.equal(formatMinutes(Infinity), null);
});

test("stepMinutes is the same guard as a number, for the timer's arithmetic", () => {
  assert.equal(stepMinutes(12), 12);
  assert.equal(stepMinutes(1.5), 1.5);
  assert.equal(stepMinutes("12 min"), null);
  assert.equal(stepMinutes(0), null);
  assert.equal(stepMinutes(NaN), null);
  // The bug in one line: this used to be NaN, and a NaN endsAt renders a
  // countdown of "NaN:NaN" that never elapses.
  assert.ok(Number.isFinite(Date.parse("2020-01-01") + (stepMinutes("12 min") ?? 0) * 60_000));
});
