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
export function sectionOrder(recipe: Recipe, prefer?: OrderPreference): number[] {
  const n = recipe.sections?.length ?? 0;
  if (n <= 1) return n === 1 ? [0] : [];

  const deps = componentLinks(recipe);
  const done = new Set<number>();
  const out: number[] = [];

  /**
   * With a preference, sections are emitted one at a time, each round taking
   * the ready section the preference ranks earliest (original index breaking
   * ties, so unranked sections keep their arrival order). The topological
   * constraint still runs the show: a ranked consumer stays behind its
   * producer no matter what the preference says, which is what makes the
   * preference safe to store without validating it against the tree.
   *
   * The unpreferred path below is kept EXACTLY as it was, not rewritten in
   * terms of this one. The two differ on a corner: the batch loop emits
   * every already-ready section before anything it unblocked mid-pass, while
   * one-at-a-time selection would interleave them. sequence.test.ts pins the
   * batch behaviour, and an ordering that shifted for people who never
   * expressed a preference would be this feature's one way to break users who
   * never touched it.
   */
  const ranks = prefer?.sections?.length
    ? new Map(prefer.sections.map((name, i) => [norm(name), i]))
    : null;

  if (ranks) {
    const rankOf = (i: number) => ranks.get(norm(recipe.sections[i].name)) ?? Infinity;
    while (out.length < n) {
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (done.has(i)) continue;
        let ready = true;
        for (const d of deps.get(i) ?? new Set<number>()) {
          if (!done.has(d)) { ready = false; break; }
        }
        if (!ready) continue;
        if (
          best === -1 ||
          rankOf(i) < rankOf(best) ||
          (rankOf(i) === rankOf(best) && i < best)
        ) best = i;
      }
      if (best === -1) {
        // Cycle. Emit what is left in original order rather than looping.
        for (let i = 0; i < n; i++) if (!done.has(i)) out.push(i);
        break;
      }
      done.add(best);
      out.push(best);
    }
    return out;
  }

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

/**
 * Every step of the recipe, in the order to cook them.
 *
 * `prefer` is HOW I AM COOKING TONIGHT, not a correction to the recipe — the
 * third instance of a split this codebase has already made twice.
 * `entry.servings` scales without touching `recipe.servings`; `entry.rating`
 * is an opinion that never enters the tree; and `entry.order` reorders the
 * cards without touching `inputs`. The same fact has a tree-level twin in
 * both other cases too: the step sheet's Order list (`reorderInputs`) changes
 * branch order FOR EVERYONE and moves the diagram rows, because input order
 * is what the diagram draws. This preference changes it for one entry, cards
 * only, and never propagates through the extraction cache or a claim. The
 * overlap is deliberate, not an accident of two features landing separately.
 *
 * The preference is advisory and is never trusted with the dependency
 * guarantee. Branch preferences are applied by building a candidate section
 * and running the SAME `stepSequence` walk on it (so producers-before-
 * consumers holds structurally, not by promise), and section preferences are
 * a tie-break inside the same topological sort that enforces name links. A
 * preference naming a step or section that no longer exists is inert.
 */
export function cardSequence(recipe: Recipe, prefer?: OrderPreference): SequencedStep[] {
  const out: SequencedStep[] = [];
  for (const si of sectionOrder(recipe, prefer)) {
    const section = prefer?.branches
      ? applyBranchPreference(recipe.sections[si], prefer.branches)
      : recipe.sections[si];
    for (const stepId of stepSequence(section)) {
      out.push({ sectionIndex: si, stepId });
    }
  }
  return out;
}

// -------------------------------------------------------------- preference --

/**
 * How one entry wants its cards ordered, where the tree leaves a choice.
 *
 * Stored on the ENTRY (`recipes.card_order`), not in the recipe: see the
 * comment on `cardSequence`. Both halves are advisory:
 *
 * - `sections` ranks sections BY NORMALISED NAME. Names because sections have
 *   no id (the one asymmetry, see shared/edits.ts) and indices do not survive
 *   an add or delete; normalised because that is how `componentLinks` matches
 *   them. Renaming a section orphans its rank and it falls back to its
 *   natural position — a small loss with an obvious cause.
 * - `branches` maps a convergence step's id to its step-inputs in preferred
 *   order. Applied as a permutation of the step-input slots only; ingredient
 *   inputs keep their positions, so the "running mixture first" convention
 *   the prompt asks for is untouched.
 */
export interface OrderPreference {
  sections?: string[];
  branches?: Record<string, string[]>;
}

/**
 * A candidate section with one convergence's branches reordered — the same
 * move as the editor's `reorderInputs`, minus the permutation *requirement*:
 * a stale preference (step deleted, branch merged away) contributes the
 * entries that still exist and drops the rest, because a stored preference
 * must never make a recipe fail to sequence.
 */
export function applyBranchPreference(
  section: Section,
  branches: Record<string, string[]>
): Section {
  let nodes = section.nodes;
  let changed = false;

  for (const [stepId, wanted] of Object.entries(branches)) {
    const node = nodes.find((n) => n.id === stepId);
    if (!node) continue;
    const stepIds = new Set(nodes.map((n) => n.id));
    const inputs = node.inputs ?? [];
    const current = inputs.filter((i) => stepIds.has(i));
    if (current.length < 2) continue;

    // The surviving wanted ids first, then anything the preference has never
    // heard of (a branch added since) in its current order.
    const currentSet = new Set(current);
    const orderedKids = [
      ...wanted.filter((i) => currentSet.has(i)),
      ...current.filter((i) => !wanted.includes(i)),
    ];
    if (orderedKids.every((id, i) => id === current[i])) continue;

    // Rethread the step ids through the slots they occupied, ingredients
    // staying exactly where they were.
    let k = 0;
    const nextInputs = inputs.map((i) => (stepIds.has(i) ? orderedKids[k++] : i));
    nodes = nodes.map((n) => (n.id === stepId ? { ...n, inputs: nextInputs } : n));
    changed = true;
  }

  return changed ? { ...section, nodes } : section;
}

/** A convergence someone can express a preference about: a step consuming
 *  two or more other steps, listed with those step-inputs in current order. */
export interface BranchChoice {
  sectionIndex: number;
  stepId: string;
  branchRoots: string[];
}

/**
 * Where this recipe actually leaves the cook a choice. The reorder view is
 * built from this rather than from its own reading of the tree, so what gets
 * a drag handle and what the walk will honour cannot disagree — the same
 * single-authority rule as validMoveTargets, with the walk as the authority.
 */
export function branchChoices(recipe: Recipe): BranchChoice[] {
  const out: BranchChoice[] = [];
  recipe.sections.forEach((s, sectionIndex) => {
    const stepIds = new Set(s.nodes.map((n) => n.id));
    for (const n of s.nodes) {
      const kids = (n.inputs ?? []).filter((i) => stepIds.has(i));
      if (kids.length > 1) out.push({ sectionIndex, stepId: n.id, branchRoots: kids });
    }
  });
  return out;
}

/**
 * Which sections may be freely reordered.
 *
 * Sections in a name link are pinned: their relative order is the cooking
 *-order fix of #6's cookie bug, and a preference is a tie-break that could
 * not violate it anyway — but offering a drag the sort would then quietly
 * correct would be rejecting after the drop, which is the thing this view
 * promises not to do. So linked sections get no handle at all.
 */
export function freeSectionIndices(recipe: Recipe): Set<number> {
  const linked = new Set<number>();
  for (const [to, froms] of componentLinks(recipe)) {
    if (froms.size) {
      linked.add(to);
      for (const f of froms) linked.add(f);
    }
  }
  const free = new Set<number>();
  recipe.sections.forEach((_, i) => {
    if (!linked.has(i)) free.add(i);
  });
  return free;
}

/**
 * Drops every part of a preference that no longer refers to anything, and
 * normalises away no-ops. Returns null when nothing meaningful is left, so
 * callers can store the absence rather than an empty husk. Runs on write —
 * the same place `reconcileDone` prunes vanished ids from `done` — while the
 * read path stays tolerant of anything stale that got through.
 */
export function pruneOrderPreference(
  recipe: Recipe,
  prefer: OrderPreference | null | undefined
): OrderPreference | null {
  if (!prefer) return null;

  const names = new Set(recipe.sections.map((s) => norm(s.name)));
  const sections = (prefer.sections ?? []).filter((n) => names.has(norm(n)));

  const choices = new Map(branchChoices(recipe).map((c) => [c.stepId, c.branchRoots]));
  const branches: Record<string, string[]> = {};
  for (const [stepId, wanted] of Object.entries(prefer.branches ?? {})) {
    const roots = choices.get(stepId);
    if (!roots) continue;
    const rootSet = new Set(roots);
    const kept = wanted.filter((i) => rootSet.has(i));
    if (kept.length < 2) continue;
    branches[stepId] = kept;
  }

  const out: OrderPreference = {};
  if (sections.length) out.sections = sections;
  if (Object.keys(branches).length) out.branches = branches;
  return out.sections || out.branches ? out : null;
}
