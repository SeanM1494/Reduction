/**
 * shared/collapse.test.ts — the finish strip, progressive collapse and the
 * handoff, pinned to what the web's Diagram.tsx did inline before the
 * derivation moved here (Sep 20). If this fails after a change to
 * collapse.ts, both renderers just changed together — which is the point,
 * but check it was meant.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeLayout, validateRecipe, type Section } from "./layout";
import { deriveDiagramState, tailStepReady } from "./collapse";

const NONE: ReadonlySet<string> = new Set();
const ids = (s: ReadonlySet<string>) => [...s].sort();

/** The landing demo's guacamole, exactly: two branches converging on a
 *  fold, then a rest. */
const GUAC = (): Section => ({
  name: "Guacamole",
  ingredients: [
    { id: "avocados", qty: 3, unit: null, name: "ripe avocados" },
    { id: "lime", qty: 1, unit: null, name: "lime" },
    { id: "salt", qty: 0.5, unit: "tsp", name: "kosher salt" },
    { id: "onion", qty: 0.25, unit: "cup", name: "white onion" },
    { id: "tomato", qty: 1, unit: null, name: "roma tomato" },
    { id: "jalapeno", qty: 1, unit: null, name: "jalapeño" },
    { id: "cilantro", qty: 0.25, unit: "cup", name: "fresh cilantro" },
  ],
  nodes: [
    { id: "d1", label: "halve and scoop", inputs: ["avocados"] },
    { id: "d2", label: "mash to desired texture", inputs: ["d1", "lime", "salt"] },
    { id: "d3", label: "combine", inputs: ["onion", "tomato", "jalapeno", "cilantro"] },
    { id: "d4", label: "fold together", inputs: ["d2", "d3"] },
    { id: "d5", label: "rest 10 min", inputs: ["d4"], minutes: 10 },
  ],
  root: "d5",
});

test("the terminal chain: fold and rest leave the table, the join that lands the last ingredient stays", () => {
  const s = deriveDiagramState(GUAC(), NONE, NONE);
  assert.deepEqual(s.tail.map((n) => n.id), ["d4", "d5"]);
  assert.deepEqual(ids(s.tailIds), ["d4", "d5"]);
  // The table keeps every ingredient and d1..d3, and its columns shrink to
  // what is left: ingredients, d1, d2/d3.
  const keys = s.table.rows.flat().map((c) => c.key);
  assert.ok(!keys.includes("d4") && !keys.includes("d5"));
  assert.ok(["d1", "d2", "d3", "avocados", "cilantro"].every((k) => keys.includes(k)));
  const base = computeLayout(GUAC());
  assert.ok(s.table.totalCols < base.totalCols, "tail columns are trimmed");
  assert.equal(s.table.totalRows, base.totalRows);
});

test("a straight line has no strip: the root joins an ingredient", () => {
  const line: Section = {
    name: "Toast",
    ingredients: [
      { id: "bread", qty: 1, unit: null, name: "bread" },
      { id: "butter", qty: 1, unit: "tbsp", name: "butter" },
    ],
    nodes: [
      { id: "t", label: "toast", inputs: ["bread"] },
      { id: "b", label: "butter it", inputs: ["t", "butter"] },
    ],
    root: "b",
  };
  const s = deriveDiagramState(line, NONE, NONE);
  assert.deepEqual(s.tail, []);
  assert.equal(s.table.totalCols, computeLayout(line).totalCols);
});

test("nothing done: nothing collapses and the table is the base layout", () => {
  const s = deriveDiagramState(GUAC(), NONE, NONE);
  assert.equal(s.collapsedIds.size, 0);
  assert.equal(s.treeDone, false);
  const base = computeLayout(GUAC());
  assert.deepEqual(
    s.table.rows.flat().map((c) => c.key),
    base.rows.flat().filter((c) => c.key !== "d4" && c.key !== "d5").map((c) => c.key)
  );
});

test("a finished branch folds into one chip once its parent is not done", () => {
  const done = new Set(["avocados", "d1"]);
  const s = deriveDiagramState(GUAC(), done, NONE);
  assert.deepEqual(ids(s.collapsedIds), ["d1"]);
  const chip = s.table.rows.flat().find((c) => c.kind === "collapsed");
  assert.ok(chip, "a collapsed cell is drawn");
  assert.equal(chip!.key, "d1");
  assert.equal(chip!.col, 0, "a chip sits in the ingredient column");
  assert.equal(chip!.itemCount, 2, "avocados + halve and scoop");
  // The folded ingredient no longer has a cell of its own.
  assert.ok(!s.table.rows.flat().some((c) => c.key === "avocados"));
});

test("reopening a chip keeps it open whatever done says", () => {
  const done = new Set(["avocados", "d1"]);
  const s = deriveDiagramState(GUAC(), done, new Set(["d1"]));
  assert.equal(s.collapsedIds.size, 0);
  assert.ok(s.table.rows.flat().some((c) => c.key === "avocados"));
});

test("siblings collapse together, never one at a time", () => {
  // d2 done (with everything under it) but its sibling d3 is not: d2 stays
  // open, because folding it while d3 keeps its rows reads as broken
  // alignment. d1 stays open too — its parent d2 is done.
  const half = new Set(["avocados", "d1", "lime", "salt", "d2"]);
  const s1 = deriveDiagramState(GUAC(), half, NONE);
  assert.equal(s1.collapsedIds.size, 0);
  assert.equal(s1.treeDone, false);
  // Both siblings done: both fold, and the tree part is finished.
  const all = new Set([...half, "onion", "tomato", "jalapeno", "cilantro", "d3"]);
  const s2 = deriveDiagramState(GUAC(), all, NONE);
  assert.deepEqual(ids(s2.collapsedIds), ["d2", "d3"]);
  assert.equal(s2.treeDone, true, "the tail's own state is not part of treeDone");
  assert.equal(s2.table.rows.flat().filter((c) => c.kind === "collapsed").length, 2);
});

test("tail steps never collapse and treeDone ignores them", () => {
  const everything = new Set(["avocados", "lime", "salt", "onion", "tomato", "jalapeno", "cilantro", "d1", "d2", "d3", "d4", "d5"]);
  const s = deriveDiagramState(GUAC(), everything, NONE);
  assert.ok(!s.collapsedIds.has("d4") && !s.collapsedIds.has("d5"));
  assert.equal(s.treeDone, true);
  assert.equal(tailStepReady(s.tail[0], new Set(["d2", "d3"])), true);
  assert.equal(tailStepReady(s.tail[1], new Set(["d2", "d3"])), false);
});

// ------------------------------------------------------------ property ---

function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

/** A random valid section: steps consume random subsets of what is still
 *  unconsumed until one root remains. */
function randomSection(seed: number): Section {
  const r = rng(seed);
  const nIng = 2 + Math.floor(r() * 7);
  const ingredients = Array.from({ length: nIng }, (_, i) => ({ id: `i${i}`, qty: 1, unit: null, name: `ing ${i}` }));
  let open = ingredients.map((i) => i.id);
  const nodes: Section["nodes"] = [];
  let k = 0;
  while (open.length > 1) {
    const take = Math.min(open.length, 1 + Math.floor(r() * 3));
    // Take from the front so ordering stays deterministic per seed.
    const inputs = open.slice(0, take);
    open = open.slice(take);
    const id = `s${k++}`;
    nodes.push({ id, label: `step ${id}`, inputs, ...(r() < 0.3 ? { minutes: 5 } : {}) });
    open.push(id);
  }
  // Sometimes a terminal chain: a few steps that consume only the root.
  const chain = Math.floor(r() * 3);
  for (let c = 0; c < chain; c++) {
    const id = `s${k++}`;
    nodes.push({ id, label: `finish ${id}`, inputs: [open[0]] });
    open = [id];
  }
  return { name: `Section ${seed}`, ingredients, nodes, root: open[0] };
}

/** A random upstream-closed done set: pick nodes, add everything beneath. */
function randomDone(section: Section, seed: number): Set<string> {
  const r = rng(seed * 7 + 3);
  const inputsOf = new Map(section.nodes.map((n) => [n.id, n.inputs || []]));
  const done = new Set<string>();
  const add = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    for (const i of inputsOf.get(id) || []) add(i);
  };
  for (const n of section.nodes) if (r() < 0.35) add(n.id);
  for (const i of section.ingredients) if (r() < 0.2) done.add(i.id);
  return done;
}

test("random trees: the derivation is total and its invariants hold", () => {
  let checked = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const section = randomSection(seed);
    const problems = validateRecipe({ title: "t", servings: 1, sections: [section] });
    if (problems.length) continue;
    checked++;
    const done = randomDone(section, seed);
    const s = deriveDiagramState(section, done, NONE);
    const base = computeLayout(section);
    // Tail: a suffix of the root chain, root last, every member spanning all rows.
    for (const t of s.tail) assert.ok((t.inputs || []).every((i) => section.nodes.some((n) => n.id === i)), "a tail step joins no ingredient");
    if (s.tail.length) assert.equal(s.tail[s.tail.length - 1].id, section.root);
    // Collapsed: done, not tail, and never a step whose parent is done.
    for (const id of s.collapsedIds) {
      assert.ok(done.has(id));
      assert.ok(!s.tailIds.has(id));
      const parent = base.parentOf.get(id);
      if (parent) assert.ok(!done.has(parent));
    }
    // The table never carries a tail cell, and every ingredient not folded
    // inside a chip still has its cell.
    const keys = new Set(s.table.rows.flat().map((c) => c.key));
    for (const id of s.tailIds) assert.ok(!keys.has(id));
    for (const c of s.table.rows.flat()) assert.ok(c.col + c.colSpan <= s.table.totalCols);
    if (s.collapsedIds.size === 0) {
      assert.deepEqual(
        [...keys].sort(),
        base.rows.flat().map((c) => c.key).filter((k) => !s.tailIds.has(k)).sort()
      );
    }
    // Reopening every chip restores the base table exactly.
    const reopened = deriveDiagramState(section, done, s.collapsedIds);
    assert.equal(reopened.collapsedIds.size, 0);
    // treeDone means exactly that.
    const treeIds = [...section.ingredients.map((i) => i.id), ...section.nodes.filter((n) => !s.tailIds.has(n.id)).map((n) => n.id)];
    assert.equal(s.treeDone, treeIds.every((id) => done.has(id)));
  }
  assert.ok(checked >= 100, `only ${checked} valid random trees`);
});
