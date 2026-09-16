import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeDir, stepAt, toContent } from "./dragMath";
import type { CellRect } from "./layoutRects";

const rect = (key: string, kind: string, x: number, y: number, w: number, h: number): CellRect =>
  ({ cell: { key, kind, row: 0, col: 0, rowSpan: 1, colSpan: 1 } as CellRect["cell"], x, y, width: w, height: h });

const rects: CellRect[] = [
  rect("avocados", "ingredient", 0, 0, 120, 44),
  rect("g1", "gap", 120, 0, 104, 44),
  rect("d1", "op", 224, 0, 104, 44),
  rect("d2", "collapsed", 328, 0, 104, 88),
  rect("d3", "op", 224, 44, 104, 44),
];

test("stepAt finds the step containing a point and ignores ingredients and gaps", () => {
  assert.equal(stepAt(rects, 230, 10), "d1");
  assert.equal(stepAt(rects, 400, 80), "d2");
  assert.equal(stepAt(rects, 230, 50), "d3");
  assert.equal(stepAt(rects, 10, 10), null, "ingredient column is not a target");
  assert.equal(stepAt(rects, 150, 10), null, "gap is not a target");
  assert.equal(stepAt(rects, 500, 10), null, "outside every cell");
});

test("stepAt treats the right and bottom edges as exclusive so adjacent cells never both match", () => {
  assert.equal(stepAt(rects, 328, 10), "d2");
  assert.equal(stepAt(rects, 327, 10), "d1");
  assert.equal(stepAt(rects, 230, 44), "d3");
});

test("edgeDir scrolls toward the edge the finger is near and never for a tiny surface", () => {
  assert.equal(edgeDir(10, 0, 390, 44), -1);
  assert.equal(edgeDir(380, 0, 390, 44), 1);
  assert.equal(edgeDir(200, 0, 390, 44), 0);
  assert.equal(edgeDir(5, 0, 60, 44), 0, "a 60px surface cannot host two 44px edges");
});

test("toContent maps a window point through the frame origin, the scroller and page scroll", () => {
  assert.deepEqual(toContent(100, 500, { x: 20, y: 400 }, 0, 0), { x: 80, y: 100 });
  assert.deepEqual(toContent(100, 500, { x: 20, y: 400 }, 150, 0), { x: 230, y: 100 });
  // The page scrolled 60px down since pickup: the frame rose 60px, so the
  // same window point is 60px further into the content.
  assert.deepEqual(toContent(100, 500, { x: 20, y: 400 }, 0, 60), { x: 80, y: 160 });
});
