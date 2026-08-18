/**
 * shared/sync.test.ts — the three-way merge, including the property that
 * makes `done`-by-union safe rather than merely convenient.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { Recipe, Section } from "./layout";
import { mergeCooked, mergeDone, mergeEntry, mergeTimer, type SyncableEntry } from "./sync";

const RECIPE = (): Recipe => ({
  title: "Guacamole",
  servings: 4,
  sections: [
    {
      name: "G",
      ingredients: [
        { id: "avocados", qty: 3, unit: null, name: "avocados" },
        { id: "lime", qty: 1, unit: null, name: "lime" },
        { id: "onion", qty: 1, unit: null, name: "onion" },
        { id: "tomato", qty: 1, unit: null, name: "tomato" },
      ],
      nodes: [
        { id: "d1", label: "scoop", inputs: ["avocados"] },
        { id: "d2", label: "mash", inputs: ["d1", "lime"] },
        { id: "d3", label: "combine", inputs: ["onion", "tomato"] },
        { id: "d4", label: "fold", inputs: ["d2", "d3"] },
      ],
      root: "d4",
    },
  ],
});

const entry = (over: Partial<SyncableEntry> = {}): SyncableEntry => ({
  recipe: RECIPE(),
  done: [],
  servings: 4,
  mode: "diagram",
  timer: null,
  cooked: [],
  ...over,
});

// ------------------------------------------------------------- mergeDone --

test("additions from both devices survive: the union half", () => {
  // phone did the mash branch, laptop the salsa branch, from an empty base
  const mine = ["avocados", "d1", "lime", "d2"];
  const theirs = ["onion", "tomato", "d3"];
  assert.deepEqual(mergeDone([], mine, theirs).sort(), [...mine, ...theirs].sort());
});

test("MY uncheck beats their stale set, via the base", () => {
  const base = ["avocados", "d1", "lime", "d2"];
  const mine = ["avocados", "d1", "lime"];   // I unchecked d2
  const theirs = base;                       // stale: untouched
  const merged = mergeDone(base, mine, theirs);
  assert.ok(!merged.includes("d2"));
  assert.deepEqual(merged.sort(), mine.sort());
});

test("THEIR uncheck beats my stale set, via the base — no tombstone needed", () => {
  // The direction the tombstone alone could never cover: the other device
  // unchecked, and I merely still hold the old value.
  const base = ["avocados", "d1", "lime", "d2"];
  const mine = [...base, "onion"];           // I only ADDED onion
  const theirs = ["avocados", "d1", "lime"]; // they unchecked d2
  const merged = mergeDone(base, mine, theirs);
  assert.ok(!merged.includes("d2"), "their removal must win over my unchanged copy");
  assert.ok(merged.includes("onion"), "my addition must survive their removal");
});

test("the tombstone still covers the base-less case", () => {
  const merged = mergeDone(null, ["avocados"], ["avocados", "d2"], new Set(["d2"]));
  assert.ok(!merged.includes("d2"));
});

test("a re-checked id survives its own tombstone", () => {
  const merged = mergeDone(null, ["d2"], [], new Set(["d2"]));
  assert.deepEqual(merged, ["d2"]);
});

test("removal honoured on one branch cascades off dependent completions via closure repair", () => {
  // They retract d2; I completed d4 on top of it. Element-wise merge keeps my
  // d4 and drops their d2 — enforceClosure then retracts d4 exactly as the
  // app's own uncheck would have.
  const base = entry({ done: ["avocados", "d1", "lime", "d2"] });
  const mine = entry({
    done: ["avocados", "d1", "lime", "d2", "onion", "tomato", "d3", "d4"],
  });
  const theirs = entry({ done: ["avocados", "d1", "lime"] });
  const { merged } = mergeEntry(
    { ...base },
    { ...mine },
    { ...theirs }
  );
  assert.ok(!merged.done.includes("d2"), "their uncheck holds");
  assert.ok(!merged.done.includes("d4"), "my completion built on d2 is retracted with it");
  assert.ok(merged.done.includes("d3"), "my independent branch survives");
});

// --------------------------------------------- the closure property, fuzzed --

/** Toggle exactly as RecipeView does: complete = mark whole upstream chain,
 *  uncheck = clear whole downstream chain. Produces upstream-closed sets. */
function makeToggler(section: Section) {
  const inputs = new Map(section.nodes.map((n) => [n.id, n.inputs ?? []]));
  const parent = new Map<string, string>();
  for (const n of section.nodes) for (const i of n.inputs ?? []) parent.set(i, n.id);
  const upstream = (id: string, acc = new Set<string>()): Set<string> => {
    if (acc.has(id)) return acc;
    acc.add(id);
    (inputs.get(id) ?? []).forEach((i) => upstream(i, acc));
    return acc;
  };
  return (done: Set<string>, id: string): Set<string> => {
    const next = new Set(done);
    if (next.has(id)) {
      let cur: string | undefined = id;
      while (cur) {
        next.delete(cur);
        cur = parent.get(cur);
      }
    } else {
      upstream(id).forEach((u) => next.add(u));
    }
    return next;
  };
}

function isUpstreamClosed(section: Section, done: Set<string>): boolean {
  for (const n of section.nodes) {
    if (!done.has(n.id)) continue;
    for (const i of n.inputs ?? []) if (!done.has(i)) return false;
  }
  return true;
}

test("union of two toggle-produced sets is always upstream-closed", () => {
  let seed = 424242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const section = RECIPE().sections[0];
  const ids = [...section.ingredients.map((i) => i.id), ...section.nodes.map((n) => n.id)];
  const toggle = makeToggler(section);

  for (let iter = 0; iter < 500; iter++) {
    let a = new Set<string>();
    let b = new Set<string>();
    for (let k = 0; k < 6; k++) {
      a = toggle(a, ids[Math.floor(rnd() * ids.length)]);
      b = toggle(b, ids[Math.floor(rnd() * ids.length)]);
    }
    assert.ok(isUpstreamClosed(section, a), "toggle itself must produce closed sets");
    assert.ok(isUpstreamClosed(section, b));
    const union = new Set(mergeDone([], [...a], [...b]));
    assert.ok(
      isUpstreamClosed(section, union),
      `union broke closure: ${[...union]} from ${[...a]} + ${[...b]}`
    );
  }
});

// ------------------------------------------------------------ mergeTimer --

test("an explicit cancel beats a running timer", () => {
  assert.equal(mergeTimer(null, { stepId: "d2", endsAt: 99 }), null);
});

test("otherwise the later end time wins", () => {
  const early = { stepId: "d2", endsAt: 100 };
  const late = { stepId: "d3", endsAt: 200 };
  assert.deepEqual(mergeTimer(early, late), late);
  assert.deepEqual(mergeTimer(late, early), late);
});

// ----------------------------------------------------------- mergeCooked --

test("cook timestamps union, and near-duplicates collapse", () => {
  const H = 60 * 60 * 1000;
  assert.deepEqual(mergeCooked([0], [26 * H]), [0, 26 * H]);
  // two devices logging the same dinner ten minutes apart is one meal
  assert.deepEqual(mergeCooked([0], [10 * 60 * 1000]), [0]);
});

// ------------------------------------------------------------ mergeEntry --

test("a field changed on one side takes that side", () => {
  const base = entry();
  const mine = entry({ mode: "steps" });
  const theirs = entry({ done: ["avocados", "d1"], servings: 6 });
  const { merged, treeConflict } = mergeEntry(base, mine, theirs);
  assert.equal(merged.mode, "steps");
  assert.equal(merged.servings, 6);
  assert.deepEqual(merged.done, ["avocados", "d1"]);
  assert.equal(treeConflict, false);
});

test("the clobber scenario: stale device's mode tap does not erase fresh cooking", () => {
  // Server (theirs): the phone cooked to done. Mine: stale laptop that only
  // changed mode. Base: what the laptop last synced — nothing done.
  const base = entry();
  const mine = entry({ mode: "steps" });
  const theirs = entry({ done: ["avocados", "d1", "lime", "d2", "onion", "tomato", "d3", "d4"] });
  const { merged } = mergeEntry(base, mine, theirs);
  assert.equal(merged.done.length, 8, "dinner must survive the mode tap");
  assert.equal(merged.mode, "steps", "and the tap must survive too");
});

test("both cooked different branches: union, both survive", () => {
  const base = entry();
  const mine = entry({ done: ["avocados", "d1", "lime", "d2"] });
  const theirs = entry({ done: ["onion", "tomato", "d3"] });
  const { merged } = mergeEntry(base, mine, theirs);
  assert.equal(merged.done.length, 7);
});

test("mode and servings: mine wins when both changed", () => {
  const base = entry();
  const mine = entry({ mode: "steps", servings: 2 });
  const theirs = entry({ mode: "diagram", servings: 8, done: ["avocados"] });
  const { merged } = mergeEntry(base, mine, theirs);
  assert.equal(merged.mode, "steps");
  assert.equal(merged.servings, 2);
  assert.deepEqual(merged.done, ["avocados"], "their done still arrives");
});

test("tree conflict: mine wins AND the flag is raised", () => {
  const base = entry();
  const mine = entry();
  mine.recipe = { ...RECIPE(), title: "Guac (mine)" };
  const theirs = entry();
  theirs.recipe = { ...RECIPE(), title: "Guac (theirs)" };
  const { merged, treeConflict } = mergeEntry(base, mine, theirs);
  assert.equal(merged.recipe.title, "Guac (mine)");
  assert.equal(treeConflict, true, "a quiet resolution here is the forbidden outcome");
});

test("identical tree edits on both sides are not a conflict", () => {
  const base = entry();
  const mine = entry();
  mine.recipe = { ...RECIPE(), title: "Fixed" };
  const theirs = entry();
  theirs.recipe = { ...RECIPE(), title: "Fixed" };
  const { treeConflict } = mergeEntry(base, mine, theirs);
  assert.equal(treeConflict, false);
});

test("merged done is reconciled against the winning tree", () => {
  // Their cooking includes ids that my winning tree edit no longer has.
  const base = entry();
  const mine = entry();
  const trimmed = RECIPE();
  trimmed.sections[0].ingredients = trimmed.sections[0].ingredients.filter((i) => i.id !== "tomato");
  trimmed.sections[0].nodes = trimmed.sections[0].nodes.map((n) =>
    n.id === "d3" ? { ...n, inputs: ["onion"] } : n
  );
  mine.recipe = trimmed;
  const theirs = entry({ done: ["onion", "tomato", "d3"] });
  const { merged } = mergeEntry(base, mine, theirs);
  assert.ok(!merged.done.includes("tomato"), "an id the winning tree lost cannot stay done");
  assert.ok(merged.done.includes("onion"));
});

test("rating: one side rated, that rating is adopted", () => {
  const base = entry();
  const mine = entry();
  const theirs = entry({ rating: 1 });
  assert.equal(mergeEntry(base, mine, theirs).merged.rating, 1);
});

test("rating: both rated, mine wins — a tap just made beats a stored one", () => {
  const base = entry({ rating: 0 });
  const mine = entry({ rating: 1 });
  const theirs = entry({ rating: -1 });
  assert.equal(mergeEntry(base, mine, theirs).merged.rating, 1);
});

test("rating: clearing to unrated is a change like any other", () => {
  const base = entry({ rating: 1 });
  const mine = entry({ rating: null });
  const theirs = entry({ rating: 1 });
  assert.equal(mergeEntry(base, mine, theirs).merged.rating, null);
});

test("rating and cooked are independent — merging one never disturbs the other", () => {
  const base = entry({ cooked: [1000] });
  const mine = entry({ cooked: [1000], rating: 1 });
  const theirs = entry({ cooked: [1000, 1000 + 30 * 60 * 60 * 1000] });
  const { merged } = mergeEntry(base, mine, theirs);
  assert.equal(merged.rating, 1, "their cook did not clear my rating");
  assert.equal(merged.cooked!.length, 2, "my rating did not drop their cook");
});

test("null base treats everything as mine-changed but still adopts their additions", () => {
  const mine = entry({ done: ["avocados"] });
  const theirs = entry({ done: ["onion"], servings: 8 });
  const { merged } = mergeEntry(null, mine, theirs, new Set());
  assert.deepEqual(merged.done.sort(), ["avocados", "onion"]);
  assert.equal(merged.servings, 4, "mine counts as changed against a null base");
});
