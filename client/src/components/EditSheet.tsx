/**
 * client/src/components/EditSheet.tsx — the fields behind a tap in edit mode.
 *
 * One bottom sheet at every width. A popover anchored to a cell would fight
 * the horizontally scrolling table it is anchored inside, and on a phone the
 * keyboard would cover it; a sheet is reachable with one thumb and stays put
 * while the table scrolls behind it.
 *
 * AMOUNT IS ONE FIELD, NOT THREE
 *
 * The model stores qty, qtyMax and text, and validateRecipe wants a number or
 * a text fallback. Exposing that as three boxes would make someone decide what
 * kind of amount they are typing before typing it, and leave "empty qty, empty
 * text" reachable — a validation error the user never asked for. `parseAmount`
 * does the deciding: a number is a qty, "2-3" is a range, "to taste" is text.
 *
 * MOVE IS HERE TOO, AND NOT ONLY AS A DRAG
 *
 * Press-and-hold is the fast path. It is also unusable with a keyboard, and
 * awkward with a screen reader, so the same operation appears here as a list
 * of the steps this ingredient may move to — built by the same
 * `validMoveTargets` the drag highlights with, so the two can never disagree
 * about what is allowed.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { UNITS, validateRecipe, type Recipe, type Unit } from "../../../shared/layout";
import { formatAmount } from "../../../shared/amounts";
import {
  applyEdit,
  noTargetsReason,
  parentStepOf,
  parseAmount,
  validMoveTargets,
  type EditOp,
} from "../../../shared/edits";

interface Props {
  recipe: Recipe;
  /** Ingredient or step id being edited. */
  targetId: string;
  onApply: (op: EditOp) => void;
  onClose: () => void;
}

const UNIT_LABEL: Record<string, string> = { fl_oz: "fl oz", tbsp: "Tbs" };

/** The picker's options come from the validator's own set, so it can never
 *  offer a unit the server will refuse. */
const UNIT_OPTIONS = [...UNITS] as Unit[];

export default function EditSheet({ recipe, targetId, onApply, onClose }: Props) {
  const section = recipe.sections.find(
    (s) =>
      s.ingredients.some((i) => i.id === targetId) || s.nodes.some((n) => n.id === targetId)
  );
  const ingredient = section?.ingredients.find((i) => i.id === targetId) ?? null;
  const stepNode = section?.nodes.find((n) => n.id === targetId) ?? null;

  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [targetId]);

  // Escape closes; the sheet is a transient surface, not a page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!ingredient && !stepNode) return null;

  return (
    <div className="rd-sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="rd-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ingredient ? "Edit ingredient" : "Edit step"}
      >
        <div className="rd-sheet-grab" aria-hidden="true" />
        {ingredient ? (
          <IngredientFieldsForm
            key={targetId}
            recipe={recipe}
            ingredientId={targetId}
            onApply={onApply}
            onClose={onClose}
            firstFieldRef={firstFieldRef}
          />
        ) : (
          <StepFieldsForm
            key={targetId}
            recipe={recipe}
            stepId={targetId}
            onApply={onApply}
            onClose={onClose}
            firstFieldRef={firstFieldRef}
          />
        )}
      </div>
    </div>
  );
}

/** Problems the candidate tree would have. Shown rather than swallowed: the
 *  validator's messages were written to be read by a person. */
function problemsWith(recipe: Recipe, op: EditOp): string[] {
  try {
    return validateRecipe(applyEdit(recipe, op));
  } catch (e) {
    return [(e as Error).message];
  }
}

function IngredientFieldsForm({
  recipe,
  ingredientId,
  onApply,
  onClose,
  firstFieldRef,
}: {
  recipe: Recipe;
  ingredientId: string;
  onApply: (op: EditOp) => void;
  onClose: () => void;
  firstFieldRef: React.RefObject<HTMLInputElement>;
}) {
  const ing = recipe.sections
    .flatMap((s) => s.ingredients)
    .find((i) => i.id === ingredientId)!;

  // Seeded from the stored value, then owned by the field while it is focused
  // — a controlled input reset from props on every keystroke would fight the
  // caret. Commit happens on blur and on Enter.
  const [amount, setAmount] = useState(() =>
    ing.qty == null ? (ing.text ?? "") : formatAmount({ ...ing, unit: null })
  );
  const [name, setName] = useState(ing.name ?? "");
  const [note, setNote] = useState(ing.note ?? "");
  const [problems, setProblems] = useState<string[]>([]);

  const commit = (fields: Parameters<typeof buildOp>[1]) => {
    const op = buildOp(ingredientId, fields);
    const errors = problemsWith(recipe, op);
    if (errors.length) {
      setProblems(errors);
      return;
    }
    setProblems([]);
    onApply(op);
  };

  const commitAmount = () => {
    const p = parseAmount(amount);
    commit({ qty: p.qty, qtyMax: p.qtyMax, text: p.text });
  };

  const targets = useMemo(() => validMoveTargets(recipe, ingredientId), [recipe, ingredientId]);
  const parent = parentStepOf(recipe, ingredientId);
  const blocked = targets.length ? null : noTargetsReason(recipe, ingredientId);

  return (
    <>
      <div className="rd-sheet-head">
        <h2 className="rd-sheet-title">{ing.name || "Ingredient"}</h2>
        <button className="rd-btn" onClick={onClose}>
          Done
        </button>
      </div>

      <label className="rd-field">
        <span className="rd-field-label">Amount</span>
        <input
          ref={firstFieldRef}
          className="rd-field-input"
          value={amount}
          inputMode="text"
          placeholder="2, 2-3, ½, or “to taste”"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitAmount())}
        />
      </label>

      <label className="rd-field">
        <span className="rd-field-label">Unit</span>
        <select
          className="rd-field-input"
          value={ing.unit ?? ""}
          onChange={(e) => commit({ unit: (e.target.value || null) as Unit | null })}
        >
          <option value="">none (countable)</option>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u] ?? u}
            </option>
          ))}
        </select>
      </label>

      <label className="rd-field">
        <span className="rd-field-label">Name</span>
        <input
          className="rd-field-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit({ name })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit({ name }))}
        />
      </label>

      <label className="rd-field">
        <span className="rd-field-label">
          Note <span className="rd-field-hint">prep that isn’t a step</span>
        </span>
        <input
          className="rd-field-input"
          value={note}
          placeholder="finely diced"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => commit({ note: note.trim() || null })}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), commit({ note: note.trim() || null }))
          }
        />
      </label>

      <div className="rd-field">
        <span className="rd-field-label">
          Used in <span className="rd-field-hint">or press and hold the cell to drag it</span>
        </span>
        {blocked ? (
          <p className="rd-sheet-blocked">{blocked}</p>
        ) : (
          <div className="rd-move-list">
            {recipe.sections
              .find((s) => s.ingredients.some((i) => i.id === ingredientId))!
              .nodes.map((n) => {
                const isCurrent = parent?.id === n.id;
                const allowed = isCurrent || targets.includes(n.id);
                return (
                  <button
                    key={n.id}
                    className={`rd-move-opt ${isCurrent ? "is-current" : ""}`}
                    disabled={!allowed}
                    aria-pressed={isCurrent}
                    onClick={() =>
                      !isCurrent && onApply({ type: "moveIngredient", ingredientId, toStepId: n.id })
                    }
                  >
                    {n.label}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {problems.length ? (
        <div className="rd-error" role="alert">
          <ul className="rd-json-errors">
            {problems.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function buildOp(
  ingredientId: string,
  fields: {
    qty?: number | null;
    qtyMax?: number | null;
    unit?: Unit | null;
    name?: string;
    text?: string | null;
    note?: string | null;
  }
): EditOp {
  return { type: "setIngredientFields", ingredientId, fields };
}

function StepFieldsForm({
  recipe,
  stepId,
  onApply,
  onClose,
  firstFieldRef,
}: {
  recipe: Recipe;
  stepId: string;
  onApply: (op: EditOp) => void;
  onClose: () => void;
  firstFieldRef: React.RefObject<HTMLInputElement>;
}) {
  const node = recipe.sections.flatMap((s) => s.nodes).find((n) => n.id === stepId)!;
  const [label, setLabel] = useState(node.label ?? "");
  const [problems, setProblems] = useState<string[]>([]);

  const commit = () => {
    const op: EditOp = { type: "setStepLabel", stepId, label: label.trim() };
    const errors = problemsWith(recipe, op);
    if (errors.length) {
      setProblems(errors);
      return;
    }
    setProblems([]);
    onApply(op);
  };

  return (
    <>
      <div className="rd-sheet-head">
        <h2 className="rd-sheet-title">Step</h2>
        <button className="rd-btn" onClick={onClose}>
          Done
        </button>
      </div>

      <label className="rd-field">
        <span className="rd-field-label">
          Label <span className="rd-field-hint">a few words</span>
        </span>
        <input
          ref={firstFieldRef}
          className="rd-field-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())}
        />
      </label>

      <p className="rd-sheet-note">
        Adding, splitting and deleting steps aren’t here yet — use{" "}
        <strong>Advanced: edit raw data</strong> for those.
      </p>

      {problems.length ? (
        <div className="rd-error" role="alert">
          <ul className="rd-json-errors">
            {problems.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
