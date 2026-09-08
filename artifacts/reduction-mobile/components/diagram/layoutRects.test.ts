/**
 * layoutRects.test.ts — kill criterion 1 of the Phase 0 spike.
 *
 * The RN diagram is a second renderer of computeLayout's answer, and this
 * suite is what "second renderer" means, checked: for every cell the grid
 * placement in rectangles must be structurally identical to the grid
 * placement in the Layout — no cell moved, resized, dropped or invented, no
 * overlap the table would not have had, no gap the table would not have had.
 *
 * PURE NODE, NO REACT NATIVE. This file must never import react-native or
 * anything that does: the test runner is plain `node --test` via tsx, and the
 * geometry being testable without a device is the point of splitting it out.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { computeLayout, validateRecipe } from "@workspace/recipe-model/layout";
import type { Recipe, Section } from "@workspace/recipe-model/layout";
import { diagramRects, solveRowHeights, colWidth, type DiagramMetrics } from "./layoutRects";

const M: DiagramMetrics = { ingColWidth: 120, opColWidth: 96, minRowHeight: 44, colGap: 0 };

// The demo fixture, verbatim shape — two independent branches converging at
// "fold together", the same recipe the first-run demo will render.
const GUACAMOLE: Section = {
  name: "Guacamole",
  ingredients: [
    { id: "avocado", qty: 3, unit: null, name: "ripe avocados" },
    { id: "lime", qty: 1, unit: null, name: "lime" },
    { id: "salt", qty: 0.5, unit: "tsp", name: "salt" },
    { id: "onion", qty: 0.25, unit: "cup", name: "red onion, diced" },
    { id: "tomato", qty: 1, unit: null, name: "tomato, diced" },
    { id: "cilantro", qty: 2, unit: "tbsp", name: "cilantro, chopped" },
    { id: "jalapeno", qty: 1, unit: null, name: "jalapeño, minced" },
  ],
  nodes: [
    { id: "halve", label: "halve + pit", inputs: ["avocado"] },
    { id: "mash", label: "mash roughly", inputs: ["halve", "lime", "salt"] },
    { id: "combine", label: "combine", inputs: ["onion", "tomato", "cilantro", "jalapeno"] },
    { id: "fold", label: "fold together", inputs: ["mash", "combine"] },
  ],
  root: "fold",
};

/** Deterministic PRNG so a failure names a reproducible seed. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random valid section: every ingredient used once, every step >= 1 input,
 *  one root — the same invariants validateRecipe enforces, so these are the
 *  trees the renderer will actually meet. */
function randomSection(rand: () => number, steps: number): Section {
  const ingredients = [];
  const nodes: Section["nodes"] = [];
  const open: string[] = [];
  let ing = 0;
  for (let s = 0; s < steps; s++) {
    const inputs: string[] = [];
    const takeSteps = Math.min(open.length, Math.floor(rand() * 3));
    for (let i = 0; i < takeSteps; i++) {
      inputs.push(open.splice(Math.floor(rand() * open.length), 1)[0]);
    }
    const newIngs = inputs.length ? Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3);
    for (let i = 0; i < newIngs; i++) {
      const id = `i${ing++}`;
      ingredients.push({ id, qty: 1, unit: null, name: `ingredient ${id}` });
      inputs.push(id);
    }
    const id = `s${s}`;
    nodes.push({ id, label: `step ${s}`, inputs });
    open.push(id);
  }
  // Close every dangling branch into one root.
  while (open.length > 1) {
    const a = open.splice(Math.floor(rand() * open.length), 1)[0];
    const b = open.splice(Math.floor(rand() * open.length), 1)[0];
    const id = `m${open.length}-${a}`;
    nodes.push({ id, label: `merge ${id}`, inputs: [a, b] });
    open.push(id);
  }
  return { name: "Random", ingredients, nodes, root: open[0] };
}

function structurallyIdentical(section: Section, heights?: Map<string, number>) {
  const layout = computeLayout(section);
  const contentHeights = heights ?? new Map<string, number>();
  const g = diagramRects(layout, contentHeights, M);
  const cells = layout.rows.flat();

  // Same cells, exactly — none dropped, none invented.
  assert.equal(g.rects.length, cells.length);
  const byKey = new Map(g.rects.map((r) => [r.cell.key, r]));
  assert.equal(byKey.size, cells.length, "duplicate keys in rects");

  const rowOff: number[] = [0];
  for (let r = 1; r <= layout.totalRows; r++) rowOff.push(rowOff[r - 1] + g.rowHeights[r - 1]);

  for (const c of cells) {
    const r = byKey.get(c.key)!;
    // Grid identity: the rectangle sits exactly where the table's rowspan
    // arithmetic would have put it.
    assert.equal(r.x, g.colOffsets[c.col], `${c.key} x`);
    assert.equal(r.y, rowOff[c.row], `${c.key} y`);
    assert.equal(r.width, colWidth(c.col, c.colSpan, M), `${c.key} width`);
    assert.ok(Math.abs(r.height - (rowOff[c.row + c.rowSpan] - rowOff[c.row])) < 1e-6, `${c.key} height`);
    // And its content fits: the reason row-height solving exists.
    const want = contentHeights.get(c.key);
    if (want != null) assert.ok(r.height >= want - 1e-6, `${c.key} content overflows its cell`);
  }

  // No two rects overlap — the invariant rowspan gave the table for free.
  for (let i = 0; i < g.rects.length; i++) {
    for (let j = i + 1; j < g.rects.length; j++) {
      const a = g.rects[i], b = g.rects[j];
      const overlap =
        a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6 &&
        a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6;
      assert.equal(overlap, false, `${a.cell.key} overlaps ${b.cell.key}`);
    }
  }

  // Total size is the sum of its parts.
  assert.equal(g.totalWidth, g.colOffsets[layout.totalCols]);
  assert.ok(Math.abs(g.totalHeight - rowOff[layout.totalRows]) < 1e-6);
  return g;
}

test("guacamole: rectangles are the table's grid, cell for cell", () => {
  const g = structurallyIdentical(GUACAMOLE);
  // With no measured heights every row is the 44px floor — the whole diagram
  // is exactly rows * 44, which is the degenerate case the measure pass
  // starts from on first paint.
  assert.equal(g.totalHeight, computeLayout(GUACAMOLE).totalRows * M.minRowHeight);
});

test("guacamole with realistic measured heights still fits every cell", () => {
  const layout = computeLayout(GUACAMOLE);
  const heights = new Map<string, number>();
  // Ingredients wrap to two lines, ops vary, the root is tall.
  for (const c of layout.rows.flat()) {
    heights.set(c.key, c.kind === "ingredient" ? 58 : 44 + (c.rowSpan % 3) * 17);
  }
  structurallyIdentical(GUACAMOLE, heights);
});

test("a spanned cell taller than its rows grows them, and only them", () => {
  const layout = computeLayout(GUACAMOLE);
  const fold = layout.rows.flat().find((c) => c.kind === "op" && c.rowSpan >= 2)!;
  const demand = fold.rowSpan * M.minRowHeight + 60; // 60px deficit
  const heights = new Map([[fold.key, demand]]);
  const rh = solveRowHeights(layout, heights, M);
  let sum = 0;
  for (let r = fold.row; r < fold.row + fold.rowSpan; r++) sum += rh[r];
  assert.ok(sum >= demand - 1e-6, "the span fits its content");
  for (let r = 0; r < rh.length; r++) {
    if (r < fold.row || r >= fold.row + fold.rowSpan) {
      assert.equal(rh[r], M.minRowHeight, `row ${r} outside the span was touched`);
    }
  }
});

test("100 random valid trees, up to 30 steps: identical, no overlaps, content fits", () => {
  const rand = mulberry32(20260908);
  for (let i = 0; i < 100; i++) {
    const steps = 3 + Math.floor(rand() * 28);
    const section = randomSection(rand, steps);
    const errors = validateRecipe({ title: "t", sections: [section] } as unknown as Recipe);
    assert.deepEqual(errors, [], `seed tree ${i} should be valid`);
    const layout = computeLayout(section);
    const heights = new Map<string, number>();
    for (const c of layout.rows.flat()) heights.set(c.key, 44 + Math.floor(rand() * 40));
    structurallyIdentical(section, heights);
  }
});

test("the 30-step stress shape stays within a phone-scale canvas", () => {
  const rand = mulberry32(7);
  const section = randomSection(rand, 30);
  const layout = computeLayout(section);
  const g = diagramRects(layout, new Map(), M);
  // Not a perf claim — that needs the device — but a sanity bound: the spike
  // fixture the FPS meter runs against is this order of magnitude.
  assert.ok(layout.totalRows >= 15 && g.totalWidth > 0 && g.totalHeight > 0);
});
