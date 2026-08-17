/**
 * shared/progress.ts — keeping the `done` set honest when the tree changes.
 *
 * Editing a recipe can delete or rename the very ids that `done` is a list
 * of. A `done` entry pointing at an id that is no longer in the tree is a
 * checkmark on nothing: the diagram cannot render it, progress counts drift,
 * and it never becomes reachable again.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It prunes exactly the entries whose ids have gone, and nothing else. It
 * does not clear progress wholesale, because the common edit is small — a
 * label typo, a wrong amount, one ingredient attached to the wrong step —
 * and wiping someone's place mid-cook to fix a typo is a worse failure than
 * the typo. Most ids survive a correction; the ones that do not are the only
 * ones that have to go.
 *
 * It also does not repair the *upstream* invariant that the rest of the app
 * maintains — "a step is done only if everything feeding it is done". An
 * edit can break that: add a forgotten ingredient to a step already ticked
 * off, and that step is now done while its new input is not. That state
 * renders correctly (Diagram derives `ready` from inputs and `is-done` from
 * the set, and disagreement between them is drawn, not crashed), and the
 * next toggle on that branch heals it, because completing a step marks
 * everything upstream done. Cascading un-completion instead would mean one
 * added ingredient could silently wipe every step after it — a much bigger
 * loss than the inconsistency it fixes.
 *
 * So: dangling ids are impossible, temporary inconsistency is possible and
 * survivable, and the caller is told what was dropped so it is never a
 * surprise.
 */

import type { Recipe } from "./layout";

/** Every id a `done` entry could legitimately refer to. Tolerates a
 *  half-formed recipe, since this runs against user-edited JSON. */
export function idsInRecipe(recipe: unknown): Set<string> {
  const ids = new Set<string>();
  const r = recipe as Recipe | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.sections)) return ids;

  for (const section of r.sections) {
    if (!section || typeof section !== "object") continue;
    for (const ingredient of Array.isArray(section.ingredients) ? section.ingredients : []) {
      if (ingredient && typeof ingredient.id === "string") ids.add(ingredient.id);
    }
    for (const node of Array.isArray(section.nodes) ? section.nodes : []) {
      if (node && typeof node.id === "string") ids.add(node.id);
    }
  }
  return ids;
}

export interface ReconciledProgress {
  /** The entries worth keeping, in their original order. */
  done: string[];
  /** The entries dropped because their ids are no longer in the tree. */
  dropped: string[];
}

/**
 * Drops `done` entries whose ids are not in `recipe`, keeping the rest in
 * order. Duplicates collapse, since a set is what this really is.
 */
export function reconcileDone(recipe: unknown, done: unknown): ReconciledProgress {
  const list = Array.isArray(done) ? done : [];
  const ids = idsInRecipe(recipe);

  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    if (typeof entry !== "string") continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    (ids.has(entry) ? kept : dropped).push(entry);
  }

  return { done: kept, dropped };
}
