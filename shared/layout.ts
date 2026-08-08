/**
 * shared/layout.ts — the single source of truth for what a renderable recipe
 * tree is.
 *
 * The client imports computeLayout to draw the table. The server imports
 * validateRecipe to gate model output. Same code, so anything that validates
 * renders, and anything that renders validated.
 */

export type Unit =
  | "g" | "kg" | "oz" | "lb"
  | "ml" | "l" | "tsp" | "tbsp" | "cup" | "fl_oz"
  | "pinch";

export interface Ingredient {
  id: string;
  /** Decimal. 2.5 for "2-1/2". Null when the amount is not numeric. */
  qty: number | null;
  /** Upper bound for ranges like "2-3 cloves". */
  qtyMax?: number | null;
  /** Null means countable — 6 eggs, 3 cloves. Counting noun lives in `name`. */
  unit: Unit | null;
  name: string;
  /** Verbatim amount when qty is null: "to taste", "1 (14 oz) can". */
  text?: string | null;
  /** Prep state that is not a step: "softened", "room temperature". */
  note?: string | null;
}

export interface Step {
  id: string;
  /** Terse. "mix", "melt", "bake 325°F 12 min". */
  label: string;
  /** Ids of ingredients and/or earlier steps consumed here. */
  inputs: string[];
  minutes?: number | null;
  tempF?: number | null;
}

export interface Section {
  name: string;
  /** Standing instruction shown above the table, e.g. oven temp. */
  header?: string | null;
  ingredients: Ingredient[];
  nodes: Step[];
  root: string;
}

export interface Recipe {
  title: string;
  servings: number | null;
  yieldText?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  sections: Section[];
}

export type CellKind = "ingredient" | "op" | "gap" | "collapsed";

export interface Cell {
  key: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  kind: CellKind;
  depth?: number;
  owner?: string;
  inputs?: string[];
  ingredient?: Ingredient;
  text?: string;
  /** "collapsed" cells only: how many ingredients+steps are folded inside. */
  itemCount?: number;
}

export interface Layout {
  rows: Cell[][];
  totalCols: number;
  totalRows: number;
  parentOf: Map<string, string>;
}

export interface LayoutOptions {
  /**
   * Step ids to draw as a single collapsed leaf instead of expanding their
   * subtree. Traversal stops at each one — it lands at column 0 like an
   * ingredient, carrying its label and a count of everything folded inside.
   * Omitting this (or passing nothing) reproduces today's output exactly.
   */
  collapsed?: Set<string>;
}

/**
 * column   = 1 + max(column of inputs), ingredients at 0
 * rowSpan  = leaves beneath the node
 * rowStart = first of those leaf rows
 *
 * Leaves are emitted in DFS order, which is the only reason every node's
 * inputs land on contiguous rows and rowspan works at all.
 *
 * A step id named in `opts.collapsed` is treated as a leaf too: its whole
 * subtree is swallowed into one row/column-0 cell instead of being drawn.
 * Row-collapsing and column-collapsing fall out of this one leaf treatment —
 * there is no separate mechanism for each.
 *
 * Throws on any tree that cannot be drawn. Messages are user-facing.
 */
export function computeLayout(section: Section, opts?: LayoutOptions): Layout {
  const collapsed = opts?.collapsed;
  const ingById = new Map((section.ingredients || []).map((i) => [i.id, i]));
  const nodeById = new Map((section.nodes || []).map((n) => [n.id, n]));

  if (!section.root) throw new Error("Section is missing a root.");
  if (!nodeById.has(section.root))
    throw new Error(`Root "${section.root}" is not a step.`);

  const leafRow = new Map<string, number>();
  const order: string[] = [];
  const parentOf = new Map<string, string>();
  const inPath = new Set<string>();
  const visited = new Set<string>();
  const collapsedInfo = new Map<string, { label: string; count: number }>();
  // Ids folded inside a collapsed subtree never get their own row, so they
  // must not trip the "never used"/"not connected" checks below.
  const swallowed = new Set<string>();

  /** Every ingredient/step reachable from `id`, id included. */
  const collectSubtree = (id: string, acc: Set<string>) => {
    if (acc.has(id)) return;
    acc.add(id);
    const node = nodeById.get(id);
    if (!node) return;
    (node.inputs || []).forEach((child) => collectSubtree(child, acc));
  };

  (function visit(id: string, parent: string | null) {
    if (parent) parentOf.set(id, parent);
    if (ingById.has(id)) {
      if (leafRow.has(id))
        throw new Error(
          `"${id}" is used twice. A rowspan table can only place it once.`
        );
      leafRow.set(id, order.length);
      order.push(id);
      return;
    }
    const node = nodeById.get(id);
    if (!node)
      throw new Error(
        `"${id}" is referenced by ${parent ? `"${parent}"` : "the root"} but does not exist.`
      );
    if (inPath.has(id)) throw new Error(`Cycle detected at "${id}".`);
    if (visited.has(id))
      throw new Error(`"${id}" feeds two later steps. This layout needs a tree.`);

    if (collapsed?.has(id)) {
      visited.add(id);
      leafRow.set(id, order.length);
      order.push(id);
      const acc = new Set<string>();
      collectSubtree(id, acc);
      acc.forEach((x) => swallowed.add(x));
      collapsedInfo.set(id, { label: node.label, count: acc.size });
      return;
    }

    inPath.add(id);
    visited.add(id);
    (node.inputs || []).forEach((child) => visit(child, id));
    inPath.delete(id);
  })(section.root, null);

  const orphanIng = (section.ingredients || []).filter(
    (i) => !leafRow.has(i.id) && !swallowed.has(i.id)
  );
  if (orphanIng.length)
    throw new Error(
      `Never used in any step: ${orphanIng.map((i) => i.name).join(", ")}.`
    );

  const orphanSteps = (section.nodes || []).filter(
    (n) => !visited.has(n.id) && !swallowed.has(n.id)
  );
  if (orphanSteps.length)
    throw new Error(
      `Steps not connected to the root: ${orphanSteps.map((n) => n.id).join(", ")}.`
    );

  const colMemo = new Map<string, number>();
  const colOf = (id: string): number => {
    if (ingById.has(id)) return 0;
    if (collapsed?.has(id)) return 0;
    if (colMemo.has(id)) return colMemo.get(id)!;
    const inputs = nodeById.get(id)!.inputs || [];
    const c = inputs.length ? 1 + Math.max(...inputs.map(colOf)) : 1;
    colMemo.set(id, c);
    return c;
  };

  const spanMemo = new Map<string, [number, number]>();
  const spanOf = (id: string): [number, number] => {
    if (ingById.has(id) || collapsed?.has(id)) {
      const r = leafRow.get(id)!;
      return [r, r];
    }
    if (spanMemo.has(id)) return spanMemo.get(id)!;
    let lo = Infinity;
    let hi = -Infinity;
    for (const inp of nodeById.get(id)!.inputs || []) {
      const [a, b] = spanOf(inp);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    }
    const span: [number, number] = [lo, hi];
    spanMemo.set(id, span);
    return span;
  };

  const cells: Cell[] = [];

  order.forEach((id) => {
    if (ingById.has(id)) {
      cells.push({
        key: id,
        row: leafRow.get(id)!,
        col: 0,
        rowSpan: 1,
        colSpan: 1,
        kind: "ingredient",
        ingredient: ingById.get(id)!,
      });
      return;
    }
    const info = collapsedInfo.get(id)!;
    cells.push({
      key: id,
      row: leafRow.get(id)!,
      col: 0,
      rowSpan: 1,
      colSpan: 1,
      kind: "collapsed",
      text: info.label,
      itemCount: info.count,
    });
  });

  for (const node of section.nodes) {
    if (!visited.has(node.id)) continue;
    if (collapsed?.has(node.id)) continue;
    const c = colOf(node.id);
    const [lo, hi] = spanOf(node.id);
    cells.push({
      key: node.id,
      row: lo,
      col: c,
      rowSpan: hi - lo + 1,
      colSpan: 1,
      kind: "op",
      depth: c,
      text: node.label,
      inputs: node.inputs || [],
    });

    // Inputs arriving from further left leave a rectangular hole. Consecutive
    // inputs with the same hole shape merge into one cell.
    let pending:
      | { row: number; endRow: number; col: number; endCol: number }
      | null = null;
    let gapCount = 0;
    const flush = () => {
      if (!pending) return;
      cells.push({
        key: `${node.id}-gap-${gapCount++}`,
        row: pending.row,
        col: pending.col,
        rowSpan: pending.endRow - pending.row + 1,
        colSpan: pending.endCol - pending.col + 1,
        kind: "gap",
        depth: c,
        owner: node.id,
      });
      pending = null;
    };

    for (const inp of node.inputs || []) {
      const ic = colOf(inp);
      const [a, b] = spanOf(inp);
      if (ic + 1 > c - 1) {
        flush();
        continue;
      }
      const gap = { row: a, endRow: b, col: ic + 1, endCol: c - 1 };
      if (
        pending &&
        pending.col === gap.col &&
        pending.endCol === gap.endCol &&
        pending.endRow + 1 === gap.row
      ) {
        pending.endRow = gap.endRow;
      } else {
        flush();
        pending = gap;
      }
    }
    flush();
  }

  const totalCols = Math.max(...cells.map((c) => c.col + c.colSpan));
  const rows: Cell[][] = Array.from({ length: order.length }, () => []);
  cells.forEach((c) => rows[c.row].push(c));
  rows.forEach((r) => r.sort((a, b) => a.col - b.col));

  return { rows, totalCols, totalRows: order.length, parentOf };
}

const UNITS = new Set<string>([
  "g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "fl_oz", "pinch",
]);

/**
 * Full-recipe check. Returns human-readable problems; an empty array means the
 * tree is renderable. The strings go straight back to the model on a retry.
 */
export function validateRecipe(recipe: unknown): string[] {
  const errors: string[] = [];
  const r = recipe as Recipe;

  if (!r || typeof r !== "object") return ["Response is not an object."];
  if (!r.title || typeof r.title !== "string") errors.push("Missing title.");
  if (!Array.isArray(r.sections) || r.sections.length === 0)
    return [...errors, "Missing sections array."];

  const seenIds = new Set<string>();

  r.sections.forEach((s, i) => {
    const where = s?.name ? `section "${s.name}"` : `section ${i + 1}`;

    if (!Array.isArray(s.ingredients) || !Array.isArray(s.nodes)) {
      errors.push(`${where}: needs both ingredients and nodes arrays.`);
      return;
    }

    for (const id of [
      ...s.ingredients.map((x) => x?.id),
      ...s.nodes.map((x) => x?.id),
    ]) {
      if (!id) {
        errors.push(`${where}: an entry is missing an id.`);
        continue;
      }
      if (seenIds.has(id))
        errors.push(`Duplicate id "${id}" — ids must be unique across the recipe.`);
      seenIds.add(id);
    }

    for (const ing of s.ingredients) {
      if (ing.unit != null && !UNITS.has(ing.unit))
        errors.push(
          `${where}: "${ing.id}" has unit "${ing.unit}". Use one of ${[...UNITS].join(", ")}, or null for countable items.`
        );
      if (ing.qty == null && !ing.text)
        errors.push(
          `${where}: "${ing.id}" has no qty and no text fallback. One is required.`
        );
      if (ing.qty != null && typeof ing.qty !== "number")
        errors.push(`${where}: "${ing.id}" qty must be a number, not a string.`);
      if (!ing.name) errors.push(`${where}: "${ing.id}" is missing a name.`);
    }

    for (const n of s.nodes) {
      if (!n.label) errors.push(`${where}: step "${n.id}" is missing a label.`);
      if (!Array.isArray(n.inputs) || n.inputs.length === 0)
        errors.push(`${where}: step "${n.id}" has no inputs.`);
      if (n.label && n.label.split(/\s+/).length > 8)
        errors.push(
          `${where}: step "${n.id}" label is too long. Keep it to a few words.`
        );
    }

    // The structural check — cycles, reuse, orphans, unreachable steps.
    try {
      computeLayout(s);
    } catch (e) {
      errors.push(`${where}: ${(e as Error).message}`);
    }
  });

  return errors;
}
