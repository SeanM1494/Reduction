/**
 * lib/usage.test.ts — the usage report's arithmetic and its text, without a
 * database (the queries are under routes/counters.db.test.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { formatUsageText, MIN_FOR_SHARE, share, type UsageReport } from "./usage";

test("usage: a share hides below the minimum and rounds above it", () => {
  assert.equal(share(3, MIN_FOR_SHARE - 1), "—");
  assert.equal(share(0, 0), "—");
  assert.equal(share(1, 3 * MIN_FOR_SHARE), "3%");
  assert.equal(share(5, 10), "50%");
});

const empty: UsageReport = {
  days: 30,
  excluded: 0,
  comingBack: { signedUp: 0, cookedOne: 0, cookedTwoRecipes: 0, cookedTwoDays: 0, cookedAfterWeek: 0 },
  cookedThrough: [],
  views: { recipe_opened: 0, view_steps: 0, ticked_diagram: 0, ticked_steps: 0, finished_diagram: 0, finished_steps: 0 },
};

test("usage: the text reads with nothing in it, and never divides by zero", () => {
  const s = formatUsageText(empty);
  assert.match(s, /Usage, last 30 days\n/);
  assert.doesNotMatch(s, /NaN|Infinity/);
});

test("usage: the text carries every section and the view split", () => {
  const s = formatUsageText({
    ...empty,
    excluded: 1,
    comingBack: { signedUp: 40, cookedOne: 20, cookedTwoRecipes: 8, cookedTwoDays: 10, cookedAfterWeek: 4 },
    cookedThrough: [
      { kind: "link", saved: 100, started: 60, cooked: 40, lastViewSteps: 30 },
      { kind: "other", saved: 20, started: 10, cooked: 5, lastViewSteps: 10 },
    ],
    views: { recipe_opened: 200, view_steps: 90, ticked_diagram: 30, ticked_steps: 70, finished_diagram: 10, finished_steps: 30 },
  });
  assert.match(s, /leaving out 1 account\)/);
  assert.match(s, /cooked at least 1 recipe\s+20\s+50%/);
  assert.match(s, /all\s+120\s+70\s+45\s+38%/);
  assert.match(s, /last view left in.*\s+67%\s+33%/);
  assert.match(s, /visits that opened Step-by-Step\s+45%/);
  assert.match(s, /cooks finished in \(40\)\s+25%\s+75%/);
});
