/**
 * components/diagram/layoutRects.ts — computeLayout's grid, as rectangles.
 *
 * THE PREMISE OF THE WHOLE REBUILD, stated once where it is implemented:
 * `computeLayout` already answers WHERE every cell goes — row, col, rowSpan,
 * colSpan on an explicit grid. The web app's HTML table was only ever one
 * RENDERER of that answer, borrowing rowspan as a drawing primitive and the
 * browser's text layout for row heights. This module is the second renderer's
 * geometry half: given the same Layout and a set of measured content heights,
 * it produces absolute rectangles. React Native contributes nothing to the
 * layout logic — which is why this file imports nothing from react-native and
 * is tested under plain node against the same fixtures as the model itself.
 *
 * Row heights are the one problem the browser used to solve for us. The
 * algorithm is the classic table one, in two passes:
 *   1. every row starts at MIN_ROW_H, then single-row cells raise their row
 *      to fit their measured content;
 *   2. multi-row (rowSpan > 1) cells, in increasing span order, check the sum
 *      of their spanned rows and distribute any deficit equally across them.
 * Deterministic, order-independent within a pass, and O(cells · span).
 */

import type { Layout, Cell } from "@workspace/recipe-model/layout";

export interface DiagramMetrics {
  /** Column 0 — ingredients and collapsed leaves. The web app constrains this
   *  column to 84-120px; the constant is the renderer's to choose. */
  ingColWidth: number;
  /** Every later column (ops). */
  opColWidth: number;
  /** Minimum row height. 44 is the touch-target floor, not a style choice. */
  minRowHeight: number;
  /** Horizontal gap painted between columns (borders live inside cells). */
  colGap: number;
}

export interface CellRect {
  cell: Cell;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramRects {
  rects: CellRect[];
  rowHeights: number[];
  colOffsets: number[];
  totalWidth: number;
  totalHeight: number;
}

export function colWidth(col: number, span: number, m: DiagramMetrics): number {
  let w = 0;
  for (let c = col; c < col + span; c++) {
    w += c === 0 ? m.ingColWidth : m.opColWidth;
    if (c > col) w += m.colGap;
  }
  return w;
}

function colOffsetsOf(totalCols: number, m: DiagramMetrics): number[] {
  const out: number[] = [0];
  for (let c = 1; c <= totalCols; c++) {
    out.push(out[c - 1] + (c - 1 === 0 ? m.ingColWidth : m.opColWidth) + m.colGap);
  }
  return out;
}

/**
 * Solve row heights from measured content heights.
 *
 * `contentHeights` maps cell.key -> the cell's natural content height at its
 * final width (the measure pass supplies it; tests supply it directly). A
 * missing entry means "fits in the minimum", which is also what makes the
 * function total: geometry never blocks on an unmeasured cell, it just
 * gives it the floor.
 */
export function solveRowHeights(
  layout: Layout,
  contentHeights: ReadonlyMap<string, number>,
  m: DiagramMetrics
): number[] {
  const heights = new Array<number>(layout.totalRows).fill(m.minRowHeight);
  const cells = layout.rows.flat();

  for (const c of cells) {
    if (c.rowSpan !== 1) continue;
    const h = contentHeights.get(c.key);
    if (h != null && h > heights[c.row]) heights[c.row] = h;
  }

  // Increasing span order: a 2-span deficit distributed first can absorb part
  // of what a 3-span cell would otherwise have demanded — the same order a
  // table engine uses so tall outer spans do not double-pay.
  const spanned = cells
    .filter((c) => c.rowSpan > 1)
    .sort((a, b) => a.rowSpan - b.rowSpan);
  for (const c of spanned) {
    const h = contentHeights.get(c.key);
    if (h == null) continue;
    let sum = 0;
    for (let r = c.row; r < c.row + c.rowSpan; r++) sum += heights[r];
    if (sum >= h) continue;
    const extra = (h - sum) / c.rowSpan;
    for (let r = c.row; r < c.row + c.rowSpan; r++) heights[r] += extra;
  }

  return heights;
}

/** The full geometry: every cell as an absolute rectangle. */
export function diagramRects(
  layout: Layout,
  contentHeights: ReadonlyMap<string, number>,
  m: DiagramMetrics
): DiagramRects {
  const rowHeights = solveRowHeights(layout, contentHeights, m);
  const rowOffsets: number[] = [0];
  for (let r = 1; r <= layout.totalRows; r++) {
    rowOffsets.push(rowOffsets[r - 1] + rowHeights[r - 1]);
  }
  const colOffsets = colOffsetsOf(layout.totalCols, m);

  const rects: CellRect[] = [];
  for (const c of layout.rows.flat()) {
    rects.push({
      cell: c,
      x: colOffsets[c.col],
      y: rowOffsets[c.row],
      width: colWidth(c.col, c.colSpan, m),
      height: rowOffsets[c.row + c.rowSpan] - rowOffsets[c.row],
    });
  }

  return {
    rects,
    rowHeights,
    colOffsets,
    totalWidth: colOffsets[layout.totalCols],
    totalHeight: rowOffsets[layout.totalRows],
  };
}
