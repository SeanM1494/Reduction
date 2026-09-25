/**
 * stepSource.ts — which of the recipe's own steps each diagram step came from.
 *
 * The diagram rewrites a recipe into a tree, and in doing so loses two
 * things the source had: its ORDER (the tree only knows what feeds what, so
 * Step-by-Step used to walk sections whole and columns left to right — an
 * egg wash beaten first, pastry cut before the eggs were scrambled) and its
 * WORDS ("then beat egg" where the source said which bowl and how long).
 * `src` puts both back: a step's `src` is the NUMBER of the source's own
 * method step it was drawn from, 1-based, counting steps and not
 * sub-headings — the same numbering as the INSTRUCTIONS list the model is
 * shown on a structured-data page, and as `originalStepNumbers` over the
 * stored original wording.
 *
 *   - sequence.ts orders cards by it wherever the tree allows
 *     (`sourceSequence`), and
 *   - Step-by-Step shows the source's sentence for it under the terse label.
 *
 * A WRONG TAG IS WORSE THAN NONE: it reorders cards away from the recipe
 * and captions a step with somebody else's sentence. So the model is asked
 * for tags only when the EXTRACTION_STEP_SOURCES secret is on, which waits
 * on a check of real, messy recipes (README "Extraction speed"), and a
 * recipe without tags — every recipe saved before this — keeps exactly the
 * order it had. Nothing is backfilled; a re-read brings them.
 *
 * Deliberately NOT a field on the Step type in layout.ts, the same way
 * totalTime.ts keeps `totalMinutes` off Recipe: it rides the recipe JSON
 * through the cache, the claim and the editor untouched, and is read only
 * through `stepSource` and gated only by `sanitizeStepSources`.
 */

import type { Recipe, Step } from "./layout";

/** No recipe has hundreds of numbered steps; past this it is not a step number. */
export const MAX_STEP_SOURCE = 400;

/** The gate for one value: a whole number in [1, MAX_STEP_SOURCE], else null. */
export function sanitizeStepSource(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= MAX_STEP_SOURCE ? raw : null;
}

/** A step's source step number, or null when it has none. */
export function stepSource(step: Step | null | undefined): number | null {
  return sanitizeStepSource((step as { src?: unknown } | null | undefined)?.src);
}

/**
 * Every step's `src` through the gate, in place: kept when valid, removed
 * otherwise (a removed key, not a stored null, so an untagged recipe stays
 * byte-for-byte what it was). Applied wherever a tree enters the server.
 */
export function sanitizeStepSources<T>(recipe: T): T {
  const sections = (recipe as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(sections)) return recipe;
  for (const section of sections) {
    const nodes = (section as { nodes?: unknown } | null)?.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      if (!node || typeof node !== "object" || !("src" in node)) continue;
      const v = sanitizeStepSource((node as { src?: unknown }).src);
      if (v === null) delete (node as { src?: unknown }).src;
      else (node as { src?: unknown }).src = v;
    }
  }
  return recipe;
}

/** Does any step carry a source step number? The switch for source order. */
export function hasStepSources(recipe: Recipe | null | undefined): boolean {
  return !!recipe?.sections?.some((s) => s.nodes?.some((n) => stepSource(n) !== null));
}

/** Every `src` removed: what a tree gets when source numbers are switched
 *  off, so "off" never depends on the model having obeyed the prompt. */
export function stripStepSources<T>(recipe: T): T {
  const sections = (recipe as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(sections)) return recipe;
  for (const section of sections) {
    const nodes = (section as { nodes?: unknown } | null)?.nodes;
    if (Array.isArray(nodes)) for (const node of nodes) if (node && typeof node === "object") delete (node as { src?: unknown }).src;
  }
  return recipe;
}
