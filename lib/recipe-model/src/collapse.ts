/**
 * shared/collapse.ts — what a section's diagram shows as it gets done.
 *
 * Three derivations that used to live inside the web's Diagram.tsx and now
 * live here so the two renderers (the web's HTML table and the native
 * DiagramView's absolute grid) cannot drift on them:
 *
 *  - THE TERMINAL CHAIN. Once every ingredient has joined the mixture, the
 *    remaining steps — bake, chill, slice — consume the whole thing and
 *    branch nothing. In the table they render as absurdly tall full-height
 *    cells that say nothing a chip in a row wouldn't, while forcing extra
 *    columns and more horizontal scrolling. So they come out of the table
 *    into a finish strip underneath.
 *  - PROGRESSIVE COLLAPSE. A finished step folds its whole subtree into one
 *    row once its parent isn't finished too — everything upstream of it is
 *    already done, so there is nothing left to decide in that branch.
 *  - THE HANDOFF. Once the tree part is done the table can tuck away and
 *    the strip takes over.
 *
 * Pure: (section, done, expanded) in, the layout to draw out. The renderer
 * keeps the two pieces of UI state — which chips the user reopened, and
 * whether they asked for the tucked table back — and passes them in.
 */

import { computeLayout, type Layout, type Section, type Step } from "./layout";

export interface DiagramState {
  /** The finish strip, first to do first (the root last). */
  tail: Step[];
  tailIds: Set<string>;
  /** Steps drawn as a single collapsed chip instead of their subtree. */
  collapsedIds: Set<string>;
  /** The layout to draw: the base grid, or the collapsed re-layout of it,
   *  with the tail's cells removed and `totalCols` trimmed to what is left. */
  table: Layout;
  /** Every id in the table part — ingredients and non-tail steps — is done. */
  treeDone: boolean;
}

/**
 * Throws only what `computeLayout` throws on the base tree (a section that
 * cannot be drawn at all); a collapsed re-layout that fails falls back to
 * the uncollapsed one rather than breaking the diagram.
 */
export function deriveDiagramState(
  section: Section,
  done: ReadonlySet<string>,
  expanded: ReadonlySet<string>
): DiagramState {
  const baseLayout = computeLayout(section);
  const baseTotalRows = baseLayout.totalRows;

  // ---- terminal chain ----------------------------------------------------
  // Walk down from the root while each step spans every row. A step spanning
  // everything is combining the whole dish, so it has no structure left to
  // show. But the step where the *last* ingredient actually joins is the
  // join itself, not a consequence of it — it stays in the table even though
  // it also spans every row, so the table always shows where every
  // ingredient lands. This always walks the uncollapsed layout, so the
  // finish strip is entirely unaffected by progressive collapse below.
  const nodeById = new Map(section.nodes.map((n) => [n.id, n]));
  const spanById = new Map<string, number>();
  baseLayout.rows.forEach((r) =>
    r.forEach((c) => {
      if (c.kind === "op") spanById.set(c.key, c.rowSpan);
    })
  );

  const tail: Step[] = [];
  let cursor: string | undefined = section.root;
  while (cursor && spanById.get(cursor) === baseTotalRows) {
    const node = nodeById.get(cursor);
    if (!node) break;
    const stepInputs = node.inputs || [];
    const joinsIngredient = stepInputs.some((i) => !nodeById.has(i));
    if (joinsIngredient) break;
    tail.unshift(node);
    const priorSteps = stepInputs.filter((i) => nodeById.has(i));
    cursor = priorSteps.length === 1 ? priorSteps[0] : undefined;
  }
  const tailIds = new Set(tail.map((n) => n.id));

  // ---- progressive collapse -----------------------------------------------
  // Tail steps are the finish strip's job, never the table's, so they're
  // never eligible here regardless of done state.
  //
  // Steps only collapse alongside their fellow inputs of the same parent
  // step, not one at a time — a parent's rowspan is the union of its
  // inputs' rows, so folding one input away while a sibling input stays
  // multi-row reads as broken alignment rather than progress. Grouping by
  // shared parent (rather than by column) matters because layout packs
  // steps as-late-as-possible: an unrelated, short branch elsewhere in the
  // tree can land in the same column as this step's real siblings purely by
  // numeric coincidence, without actually feeding the same parent.
  const siblingsByParent = new Map<string, string[]>();
  for (const node of section.nodes) {
    if (tailIds.has(node.id)) continue;
    const parent = baseLayout.parentOf.get(node.id);
    if (parent == null) continue;
    if (!siblingsByParent.has(parent)) siblingsByParent.set(parent, []);
    siblingsByParent.get(parent)!.push(node.id);
  }
  const siblingGroupFullyDone = (parent: string) =>
    (siblingsByParent.get(parent) || []).every((id) => done.has(id));

  const collapsedIds = new Set<string>();
  for (const node of section.nodes) {
    if (tailIds.has(node.id)) continue;
    if (!done.has(node.id)) continue;
    if (expanded.has(node.id)) continue;
    const parent = baseLayout.parentOf.get(node.id);
    if (parent && done.has(parent)) continue;
    if (parent && !siblingGroupFullyDone(parent)) continue;
    collapsedIds.add(node.id);
  }

  let layout = baseLayout;
  if (collapsedIds.size) {
    try {
      layout = computeLayout(section, { collapsed: collapsedIds });
    } catch {
      // Fall back to the uncollapsed layout rather than breaking the diagram.
    }
  }

  // ---- the table without its tail -------------------------------------------
  // The web table dropped these cells at render time and let HTML shrink the
  // table; an absolute-geometry renderer needs the column count to shrink
  // with them, so both get the trimmed layout.
  const rows = layout.rows.map((r) => r.filter((c) => !tailIds.has(c.key)));
  let totalCols = 0;
  for (const r of rows) for (const c of r) totalCols = Math.max(totalCols, c.col + c.colSpan);
  const table: Layout = { ...layout, rows, totalCols };

  // ---- handoff -----------------------------------------------------------
  const treeIds = [
    ...section.ingredients.map((i) => i.id),
    ...section.nodes.filter((n) => !tailIds.has(n.id)).map((n) => n.id),
  ];
  const treeDone = treeIds.length > 0 && treeIds.every((id) => done.has(id));

  return { tail, tailIds, collapsedIds, table, treeDone };
}

/** A strip step is ready when everything it consumes is done. */
export function tailStepReady(step: Step, done: ReadonlySet<string>): boolean {
  return (step.inputs || []).every((i) => done.has(i));
}
