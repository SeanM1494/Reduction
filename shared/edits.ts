/**
 * shared/edits.ts — the three things the visual editor can do to a recipe.
 *
 * One pure function, `applyEdit`, and one op type per operation. It lives in
 * `shared/` for the same reason `layout.ts` does: the server has to be able to
 * apply and check the same edit the client just made, and when corrections
 * start propagating between users (ROADMAP #3/#6) the propagating thing is an
 * op, not a diff of two trees.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * It does not decide whether an edit is *allowed*. `applyEdit` produces a
 * candidate tree and nothing more; `validateRecipe` is the only thing that
 * says yes or no, here and on the server. That split is the whole point of
 * `validMoveTargets` below: rather than re-deriving "which steps may this
 * ingredient move to" from the tree invariants — a predicate that would start
 * correct and drift the first time `computeLayout` gained a rule — it builds
 * the candidate for every step and asks the real validator. The highlight the
 * user drags against IS the gate that will judge the drop. They cannot
 * disagree, because they are the same call.
 *
 * It also does not add, delete, split or merge steps. Those are the next op
 * types against this same signature, not a rewrite of it.
 */

import {
  validateRecipe,
  type Ingredient,
  type Recipe,
  type Section,
  type Step,
  type Unit,
} from "./layout";

// ------------------------------------------------------------------- ops --

/** The fields the ingredient sheet can change. Absent means "leave alone",
 *  which is not the same as present-and-null (that clears it). */
export interface IngredientFields {
  qty?: number | null;
  qtyMax?: number | null;
  unit?: Unit | null;
  name?: string;
  text?: string | null;
  note?: string | null;
}

export type EditOp =
  | { type: "setIngredientFields"; ingredientId: string; fields: IngredientFields }
  | { type: "setStepLabel"; stepId: string; label: string }
  | { type: "moveIngredient"; ingredientId: string; toStepId: string }
  /** Insert a new step between `afterStepId` and whatever consumed it. */
  | { type: "addStepAfter"; afterStepId: string; label: string; newId?: string }
  /** Splice a step out; its inputs move into its consumer, in place. */
  | { type: "deleteStep"; stepId: string }
  /** Split into a CHAIN: first half keeps the id, second half is new and
   *  takes the consumer. `toSecond` names the inputs that move. */
  | {
      type: "splitStep";
      stepId: string;
      firstLabel: string;
      secondLabel: string;
      toSecond: string[];
      newId?: string;
    }
  /** Merge a step into the step that consumes it. */
  | { type: "mergeStepInto"; stepId: string; label?: string };

/** Thrown when an op names something that is not in the recipe. That is a
 *  caller bug rather than a rejected edit, so it is loud instead of silent. */
export class EditTargetError extends Error {}

// --------------------------------------------------------------- lookups --

/** Ids are unique across the whole recipe (validateRecipe enforces it), so an
 *  id is enough to find anything — no section index has to be threaded
 *  through the UI and kept in sync with array positions. */
export function sectionIndexOfId(recipe: Recipe, id: string): number {
  for (let i = 0; i < recipe.sections.length; i++) {
    const s = recipe.sections[i];
    if (s.ingredients?.some((x) => x.id === id)) return i;
    if (s.nodes?.some((x) => x.id === id)) return i;
  }
  return -1;
}

/** The step that consumes `id` — an ingredient or another step. Null for the
 *  root, and for anything orphaned, which validateRecipe already rejects. */
export function consumerOf(recipe: Recipe, id: string): Step | null {
  const si = sectionIndexOfId(recipe, id);
  if (si < 0) return null;
  for (const node of recipe.sections[si].nodes ?? []) {
    if ((node.inputs ?? []).includes(id)) return node;
  }
  return null;
}

/** The step that currently consumes `ingredientId`. Null when nothing does,
 *  which validateRecipe already treats as an orphan. */
export function parentStepOf(recipe: Recipe, ingredientId: string): Step | null {
  const si = sectionIndexOfId(recipe, ingredientId);
  if (si < 0) return null;
  for (const node of recipe.sections[si].nodes ?? []) {
    if ((node.inputs ?? []).includes(ingredientId)) return node;
  }
  return null;
}

// ----------------------------------------------------------------- apply --

/** Structural copy of one section, leaving the others by reference. Cheap,
 *  and enough for React: every array an edit touches is replaced. */
function withSection(recipe: Recipe, index: number, next: Section): Recipe {
  return {
    ...recipe,
    sections: recipe.sections.map((s, i) => (i === index ? next : s)),
  };
}

/**
 * Produces the tree this edit would make. Pure: `recipe` is never mutated.
 *
 * The result is a *candidate*. It can be invalid — clearing a name, emptying a
 * step — and that is intentional: the caller runs `validateRecipe` and shows
 * what is wrong, which is a better experience than an operation that silently
 * refuses. The server runs the same check before storing anything.
 */
export function applyEdit(recipe: Recipe, op: EditOp): Recipe {
  switch (op.type) {
    case "setIngredientFields": {
      const si = sectionIndexOfId(recipe, op.ingredientId);
      if (si < 0) throw new EditTargetError(`No ingredient "${op.ingredientId}".`);
      const section = recipe.sections[si];
      const ingredients = section.ingredients.map((ing) =>
        ing.id === op.ingredientId ? mergeFields(ing, op.fields) : ing
      );
      return withSection(recipe, si, { ...section, ingredients });
    }

    case "setStepLabel": {
      const si = sectionIndexOfId(recipe, op.stepId);
      if (si < 0) throw new EditTargetError(`No step "${op.stepId}".`);
      const section = recipe.sections[si];
      const nodes = section.nodes.map((n) =>
        n.id === op.stepId ? { ...n, label: op.label } : n
      );
      return withSection(recipe, si, { ...section, nodes });
    }

    case "addStepAfter": {
      const si = sectionIndexOfId(recipe, op.afterStepId);
      if (si < 0) throw new EditTargetError(`No step "${op.afterStepId}".`);
      const section = recipe.sections[si];
      if (!section.nodes.some((n) => n.id === op.afterStepId)) {
        throw new EditTargetError(`"${op.afterStepId}" is not a step.`);
      }
      const id = op.newId ?? mintStepId(section);
      const inserted: Step = { id, label: op.label, inputs: [op.afterStepId] };
      // Whatever consumed the old step now consumes the new one. If nothing
      // did, the old step was the root and the new step becomes it.
      const consumer = consumerOf(recipe, op.afterStepId);
      const nodes = section.nodes.map((n) =>
        consumer && n.id === consumer.id
          ? { ...n, inputs: (n.inputs ?? []).map((x) => (x === op.afterStepId ? id : x)) }
          : n
      );
      return withSection(recipe, si, {
        ...section,
        nodes: [...nodes, inserted],
        root: consumer ? section.root : id,
      });
    }

    case "deleteStep": {
      const si = sectionIndexOfId(recipe, op.stepId);
      if (si < 0) throw new EditTargetError(`No step "${op.stepId}".`);
      const section = recipe.sections[si];
      const victim = section.nodes.find((n) => n.id === op.stepId);
      if (!victim) throw new EditTargetError(`"${op.stepId}" is not a step.`);
      const consumer = consumerOf(recipe, op.stepId);
      const inputs = victim.inputs ?? [];

      if (!consumer) {
        // The root. Its inputs would each become a root of their own, and a
        // section has exactly one — so this is only legal when it has a
        // single input, and that input is a step (an ingredient cannot be a
        // root). Left to validateRecipe alone this would surface as a
        // confusing "not connected to the root" for every other branch.
        const onlyStep =
          inputs.length === 1 && section.nodes.some((n) => n.id === inputs[0]) ? inputs[0] : null;
        if (!onlyStep) {
          throw new EditTargetError(
            `"${victim.label}" is the last step. Deleting it would leave the section without one.`
          );
        }
        return withSection(recipe, si, {
          ...section,
          nodes: section.nodes.filter((n) => n.id !== op.stepId),
          root: onlyStep,
        });
      }

      // Splice the victim's inputs into its consumer, in place — input order
      // drives row order, so appending them would reshuffle the diagram.
      const nodes = section.nodes
        .filter((n) => n.id !== op.stepId)
        .map((n) =>
          n.id === consumer.id
            ? {
                ...n,
                inputs: (n.inputs ?? []).flatMap((x) => (x === op.stepId ? inputs : [x])),
              }
            : n
        );
      return withSection(recipe, si, { ...section, nodes });
    }

    case "splitStep": {
      const si = sectionIndexOfId(recipe, op.stepId);
      if (si < 0) throw new EditTargetError(`No step "${op.stepId}".`);
      const section = recipe.sections[si];
      const original = section.nodes.find((n) => n.id === op.stepId);
      if (!original) throw new EditTargetError(`"${op.stepId}" is not a step.`);

      /**
       * WHICH HALF KEEPS THE ID IS DERIVED, NOT PREFERRED.
       *
       * `done` is upstream-closed: a step is only ever done when everything
       * feeding it is done, and the whole app depends on that (see
       * shared/sync.ts). A split has to leave a done set that still satisfies
       * it.
       *
       * Give the SECOND half the old id and a done entry for the original now
       * marks the second half done while the first — its own input — is new
       * and undone. That is precisely the invalid state, produced silently,
       * on every split of a completed step.
       *
       * Give the FIRST half the old id and the same entry marks the first
       * half done and the second not. The first is upstream of the second, so
       * that is an ordinary partial state and closure holds untouched. Hence:
       * first keeps the id, second is new, and the consumer is rewired.
       */
      const secondId = op.newId ?? mintStepId(section);
      const moving = new Set(op.toSecond);
      const firstInputs = (original.inputs ?? []).filter((x) => !moving.has(x));
      const secondInputs = [
        op.stepId,
        ...(original.inputs ?? []).filter((x) => moving.has(x)),
      ];

      const first: Step = { ...original, label: op.firstLabel, inputs: firstInputs };
      const second: Step = {
        id: secondId,
        label: op.secondLabel,
        inputs: secondInputs,
        // Time and temperature describe the finishing action, so they travel
        // with the second half rather than being duplicated onto both.
        minutes: original.minutes ?? null,
        tempF: original.tempF ?? null,
      };
      delete (first as { minutes?: number | null }).minutes;
      delete (first as { tempF?: number | null }).tempF;

      const consumer = consumerOf(recipe, op.stepId);
      const nodes = section.nodes
        .map((n) => (n.id === op.stepId ? first : n))
        .map((n) =>
          consumer && n.id === consumer.id
            ? { ...n, inputs: (n.inputs ?? []).map((x) => (x === op.stepId ? secondId : x)) }
            : n
        );
      return withSection(recipe, si, {
        ...section,
        nodes: [...nodes, second],
        root: consumer ? section.root : secondId,
      });
    }

    case "mergeStepInto": {
      const si = sectionIndexOfId(recipe, op.stepId);
      if (si < 0) throw new EditTargetError(`No step "${op.stepId}".`);
      const section = recipe.sections[si];
      const victim = section.nodes.find((n) => n.id === op.stepId);
      if (!victim) throw new EditTargetError(`"${op.stepId}" is not a step.`);
      const consumer = consumerOf(recipe, op.stepId);
      if (!consumer || !section.nodes.some((n) => n.id === consumer.id)) {
        throw new EditTargetError(
          `"${victim.label}" is the last step, so there is nothing after it to merge into.`
        );
      }

      /**
       * The CONSUMER's id survives, so whatever consumes IT needs no rewrite.
       * Its label survives by default too — the later step usually names the
       * finished state — but the caller may pass either. Concatenating them
       * is not offered: validateRecipe caps a label at eight words, so joined
       * labels would routinely be rejected and a reasonable edit would
       * surface as an error message.
       */
      const nodes = section.nodes
        .filter((n) => n.id !== op.stepId)
        .map((n) =>
          n.id === consumer.id
            ? {
                ...n,
                label: op.label ?? consumer.label,
                inputs: (n.inputs ?? []).flatMap((x) =>
                  x === op.stepId ? victim.inputs ?? [] : [x]
                ),
                minutes: consumer.minutes ?? victim.minutes ?? null,
                tempF: consumer.tempF ?? victim.tempF ?? null,
              }
            : n
        );
      return withSection(recipe, si, { ...section, nodes });
    }

    case "moveIngredient": {
      const si = sectionIndexOfId(recipe, op.ingredientId);
      if (si < 0) throw new EditTargetError(`No ingredient "${op.ingredientId}".`);
      const ti = sectionIndexOfId(recipe, op.toStepId);
      if (ti < 0) throw new EditTargetError(`No step "${op.toStepId}".`);
      const section = recipe.sections[si];
      if (!section.nodes.some((n) => n.id === op.toStepId)) {
        // Either a cross-section move or an id that names an ingredient. Both
        // are refused here rather than left to produce a confusing validator
        // message about an id that "does not exist" in a section it is not in.
        throw new EditTargetError(
          `Step "${op.toStepId}" is not in the same section as "${op.ingredientId}".`
        );
      }
      const nodes = section.nodes.map((n) => {
        const has = (n.inputs ?? []).includes(op.ingredientId);
        if (n.id === op.toStepId) {
          // Re-adding to the step that already has it is a no-op, not a
          // duplicate input.
          return has ? n : { ...n, inputs: [...(n.inputs ?? []), op.ingredientId] };
        }
        if (!has) return n;
        return { ...n, inputs: (n.inputs ?? []).filter((x) => x !== op.ingredientId) };
      });
      return withSection(recipe, si, { ...section, nodes });
    }
  }
}

/** A short id that is unique within the section. Prefixed rather than a raw
 *  UUID so a hand-read tree stays legible, which is the same reason prompt.ts
 *  asks the model for section-prefixed ids. */
function mintStepId(section: Section): string {
  const taken = new Set([
    ...(section.ingredients ?? []).map((i) => i.id),
    ...(section.nodes ?? []).map((n) => n.id),
  ]);
  for (let i = 1; i < 10000; i++) {
    const id = `s${i}`;
    if (!taken.has(id)) return id;
  }
  throw new Error("Could not mint an unused step id.");
}

function mergeFields(ing: Ingredient, fields: IngredientFields): Ingredient {
  const next: Ingredient = { ...ing };
  if ("qty" in fields) next.qty = fields.qty ?? null;
  if ("qtyMax" in fields) next.qtyMax = fields.qtyMax ?? null;
  if ("unit" in fields) next.unit = fields.unit ?? null;
  if ("name" in fields) next.name = fields.name ?? "";
  if ("text" in fields) next.text = fields.text ?? null;
  if ("note" in fields) next.note = fields.note ?? null;
  return next;
}

// ------------------------------------------------------------ drop rules --

/**
 * Which steps this ingredient may be dropped on, decided by the validator.
 *
 * Every candidate is built and checked in full. That costs one
 * `validateRecipe` per step in the section — a handful of passes over a small
 * tree, run once at pickup, never per pointer move — and buys the guarantee
 * that a highlighted target cannot be refused on drop.
 *
 * The interesting case falls out rather than being special-cased: moving the
 * only input out of a step leaves that step with none, `validateRecipe` says
 * "has no inputs", and every target goes dark. The user is told before
 * anything moves, and the alternative — silently deleting the emptied step —
 * is a destructive reading of a drag.
 */
export function validMoveTargets(recipe: Recipe, ingredientId: string): string[] {
  const si = sectionIndexOfId(recipe, ingredientId);
  if (si < 0) return [];
  const current = parentStepOf(recipe, ingredientId);

  const targets: string[] = [];
  for (const node of recipe.sections[si].nodes ?? []) {
    if (current && node.id === current.id) continue; // already consumes it
    let candidate: Recipe;
    try {
      candidate = applyEdit(recipe, {
        type: "moveIngredient",
        ingredientId,
        toStepId: node.id,
      });
    } catch {
      continue;
    }
    if (validateRecipe(candidate).length === 0) targets.push(node.id);
  }
  return targets;
}

/** Why nothing can be dropped anywhere, phrased for a person. Null when there
 *  is at least one target, so the caller can stay quiet in the normal case. */
export function noTargetsReason(recipe: Recipe, ingredientId: string): string | null {
  if (validMoveTargets(recipe, ingredientId).length > 0) return null;
  const parent = parentStepOf(recipe, ingredientId);
  if (parent && (parent.inputs ?? []).length <= 1) {
    return `“${parent.label}” would be left with nothing. Every step needs at least one input.`;
  }
  const si = sectionIndexOfId(recipe, ingredientId);
  const stepCount = si < 0 ? 0 : (recipe.sections[si].nodes ?? []).length;
  if (stepCount <= 1) return "There is nowhere else to put this — the section has one step.";
  return "There is nowhere valid to move this.";
}

// ---------------------------------------------------------------- amount --

/**
 * The amount field is one box to the user and three fields in the model.
 *
 * `validateRecipe` requires a numeric `qty` or a `text` fallback, and `qtyMax`
 * carries the upper end of a range. Exposing those as three inputs would make
 * a person choose which kind of amount they are typing before typing it, and
 * an empty qty with an empty text is a validation error they did not ask for.
 * So one field is parsed: a number is a qty, "2-3" is a range, and anything
 * else is kept verbatim as text — which is what `formatAmount` already renders
 * when qty is null, so it round-trips.
 */
export interface ParsedAmount {
  qty: number | null;
  qtyMax: number | null;
  text: string | null;
}

const VULGAR_TO_NUMBER: Record<string, number> = {
  "⅛": 0.125, "¼": 0.25, "⅓": 1 / 3, "⅜": 0.375,
  "½": 0.5, "⅝": 0.625, "⅔": 2 / 3, "¾": 0.75,
  "⅞": 0.875,
};

/** "2" -> 2, "2.5" -> 2.5, "1/2" -> 0.5, "2 1/2" -> 2.5, "½" -> 0.5, "2½" -> 2.5 */
function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // A trailing or standalone vulgar fraction, optionally after a whole number.
  const vulgar = s.match(/^(\d+)?\s*([¼-¾⅐-⅞])$/);
  if (vulgar) {
    const frac = VULGAR_TO_NUMBER[vulgar[2]];
    if (frac == null) return null;
    return (vulgar[1] ? parseInt(vulgar[1], 10) : 0) + frac;
  }

  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const d = parseInt(mixed[3], 10);
    if (!d) return null;
    return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / d;
  }

  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const d = parseInt(frac[2], 10);
    return d ? parseInt(frac[1], 10) / d : null;
  }

  if (/^\d*\.?\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseAmount(input: string): ParsedAmount {
  const raw = input.trim();
  if (!raw) return { qty: null, qtyMax: null, text: null };

  // A range: "2-3", "2 – 3", "1/2 - 3/4". Split on the first dash that is not
  // part of a number, i.e. any of the dash characters people actually type.
  const range = raw.split(/\s*[-‐-―−]\s*/);
  if (range.length === 2) {
    const lo = parseNumber(range[0]);
    const hi = parseNumber(range[1]);
    if (lo != null && hi != null) return { qty: lo, qtyMax: hi, text: null };
  }

  const single = parseNumber(raw);
  if (single != null) return { qty: single, qtyMax: null, text: null };

  // Not a number in any form we recognise — keep it exactly as typed. This is
  // the "to taste" / "1 (14 oz) can" case validateRecipe's `text` exists for.
  return { qty: null, qtyMax: null, text: raw };
}
