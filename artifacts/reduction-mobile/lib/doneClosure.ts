/**
 * lib/doneClosure.ts — what a tap on a cell does to `done`. PURE.
 *
 * Moved out of RecipeScreen unchanged, so that the one rule has one home:
 * the recipe screen's taps and the demo guide's "Show me" both go through
 * it, and the guide can never teach a tap that behaves differently from a
 * real one.
 */

import type { Recipe } from '@/shared/layout';


/** Every id in the recipe mapped to the ids it directly depends on.
 *  Ingredients are leaves (no inputs). Ids are unique across the whole
 *  recipe — inputs never cross a section boundary (see shared/sequence.ts). */
export function buildInputsOf(recipe: Recipe): Map<string, string[]> {
  const inputsOf = new Map<string, string[]>();
  for (const section of recipe.sections ?? []) {
    for (const ing of section.ingredients ?? []) inputsOf.set(ing.id, []);
    for (const node of section.nodes ?? []) inputsOf.set(node.id, node.inputs ?? []);
  }
  return inputsOf;
}

export function buildDownstreamOf(inputsOf: Map<string, string[]>): Map<string, string[]> {
  const downstream = new Map<string, string[]>();
  for (const [id, inputs] of inputsOf) {
    for (const dep of inputs) {
      const list = downstream.get(dep) ?? [];
      list.push(id);
      downstream.set(dep, list);
    }
  }
  return downstream;
}

/** Checking a step marks its whole upstream chain done (you cannot have
 *  finished a step without its inputs); unchecking clears everything
 *  downstream of it. Keeps `done` upstream-closed, which is what makes the
 *  cross-device merge in shared/sync.ts provably safe (see its header). */
export function toggleDone(recipe: Recipe, done: string[], id: string): string[] {
  const inputsOf = buildInputsOf(recipe);
  const set = new Set(done);
  if (set.has(id)) {
    const downstream = buildDownstreamOf(inputsOf);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (!set.delete(cur)) continue;
      for (const next of downstream.get(cur) ?? []) stack.push(next);
    }
  } else {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (set.has(cur)) continue;
      set.add(cur);
      for (const next of inputsOf.get(cur) ?? []) stack.push(next);
    }
  }
  return [...set];
}

