/**
 * shared/sequence.ts — the order steps are cooked in.
 *
 * The diagram can show a recipe as a shape and let the eye find its own way
 * through. Step-by-step cannot: it is a queue, and a queue that hands you
 * "bake" before "mix the dry ingredients" is not merely ugly, it is wrong in
 * a kitchen. So the order is computed here, once, and asserted in
 * sequence.test.ts against the one invariant that matters:
 *
 *   A step never appears after a step that consumes its output.
 *
 * THERE ARE TWO KINDS OF DEPENDENCY, AND ONLY ONE OF THEM IS AN EDGE
 *
 * Within a section, `inputs` names them and `computeLayout` already respects
 * them — see stepSequence below for why.
 *
 * Between sections there are no ids to follow, because ids never cross a
 * section boundary. The link is by *name*: prompt.ts tells the model that a
 * component made separately becomes its own section, and that its finished
 * result then appears as an ingredient in the consuming section "with a name
 * matching the earlier section". That is a real dependency wearing a
 * different coat, and nothing used to order by it.
 *
 * That is the bug this file exists for. A cookie recipe came back as
 * "Dough" + "Dry ingredients", in that array order, with Dough consuming an
 * ingredient named "Dry ingredients". Every check passed — validateRecipe
 * returned no errors, and the diagram drew two correct tables — and
 * step-by-step said: cream, beat, combine, fold, bake, and then, last, mix
 * the dry ingredients. The tree was not wrong. The order was.
 */

import { computeLayout, type Recipe, type Section } from "./layout";

/**
 * The steps of one section, in the order they should be done.
 *
 * Sorted by (column, row) over the cells `computeLayout` already produced.
 * That is dependency-safe, but not for the reason this code used to claim —
 * the comment in StepsMode said columns were "1 + max(column of inputs)",
 * which was true of an earlier pass and has not been true since layout began
 * packing steps as late as possible.
 *
 * The guarantee under late packing is simpler and stronger: `computeLayout`
 * places a step's inputs at exactly (its own column − 1), walking down from
 * the root. So every input sits in a strictly lower column than its consumer,
 * and ascending column order therefore always emits producers first —
 * whatever the shape of the tree. Fuzzed over 397 randomly generated valid
 * trees with no violations, and asserted directly in the tests.
 */
export function stepSequence(section: Section): string[] {
  let layout;
  try {
    layout = computeLayout(section);
  } catch {
    // A section that cannot lay out renders its own error in the diagram;
    // there is nothing to sequence.
    return [];
  }
  return layout.rows
    .flat()
    .filter((c) => c.kind === "op")
    .sort((a, b) => a.col - b.col || a.row - b.row)
    .map((c) => c.key);
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Which sections must be made before which, by the name convention above.
 *
 * Returns, for each section index, the set of section indices it depends on.
 * A match has to be exact once trimmed and lowercased: a looser rule (partial
 * or fuzzy matching) would start inventing dependencies between a "Sauce"
 * section and an ingredient called "sauce", and a wrong edge here reorders
 * someone's cooking for no reason.
 */
export function componentLinks(recipe: Recipe): Map<number, Set<number>> {
  const byName = new Map<string, number>();
  recipe.sections.forEach((s, i) => {
    const key = norm(s.name);
    // First section to claim a name wins; a duplicate name is ambiguous and
    // silently picking the later one would be a coin toss.
    if (key && !byName.has(key)) byName.set(key, i);
  });

  const deps = new Map<number, Set<number>>();
  recipe.sections.forEach((s, i) => {
    const set = new Set<number>();
    for (const ing of s.ingredients ?? []) {
      const from = byName.get(norm(ing.name));
      if (from != null && from !== i) set.add(from);
    }
    deps.set(i, set);
  });
  return deps;
}

/**
 * Section indices, producers before consumers, otherwise unchanged.
 *
 * A stable topological sort: among sections whose dependencies are already
 * satisfied, the one that came first in the recipe still goes first, so a
 * recipe with no component links comes out in exactly the order it arrived.
 * Reordering a recipe that did not need it would be its own bug.
 *
 * A cycle cannot be ordered and must not hang or drop sections. If one
 * exists — two sections each claiming to be an ingredient of the other, which
 * a bad parse can certainly produce — the remaining sections are emitted in
 * their original order. That is no worse than today's behaviour, and every
 * section still appears exactly once.
 */
export function sectionOrder(recipe: Recipe): number[] {
  const n = recipe.sections?.length ?? 0;
  if (n <= 1) return n === 1 ? [0] : [];

  const deps = componentLinks(recipe);
  const done = new Set<number>();
  const out: number[] = [];

  while (out.length < n) {
    let progressed = false;
    for (let i = 0; i < n; i++) {
      if (done.has(i)) continue;
      const need = deps.get(i) ?? new Set<number>();
      let ready = true;
      for (const d of need) {
        if (!done.has(d)) {
          ready = false;
          break;
        }
      }
      if (!ready) continue;
      done.add(i);
      out.push(i);
      progressed = true;
    }
    if (!progressed) {
      // Cycle. Emit what is left in original order rather than looping.
      for (let i = 0; i < n; i++) if (!done.has(i)) out.push(i);
      break;
    }
  }
  return out;
}

export interface SequencedStep {
  sectionIndex: number;
  stepId: string;
}

/** Every step of the recipe, in the order to cook them. */
export function cardSequence(recipe: Recipe): SequencedStep[] {
  const out: SequencedStep[] = [];
  for (const si of sectionOrder(recipe)) {
    for (const stepId of stepSequence(recipe.sections[si])) {
      out.push({ sectionIndex: si, stepId });
    }
  }
  return out;
}
