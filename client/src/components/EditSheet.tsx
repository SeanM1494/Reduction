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
  consumerOf,
  deleteIngredientBlocker,
  noTargetsReason,
  parentStepOf,
  parseAmount,
  parseTiming,
  validMoveTargets,
  type EditOp,
  type StepFields,
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

/**
 * A field and, when it has one, its problem — which is drawn OVER the sheet
 * rather than inside its flow.
 *
 * This is geometry, not decoration. The sheet is bottom-anchored
 * (`.rd-sheet-scrim` is `align-items: flex-end`) and capped at 86svh, and an
 * error box used to be appended at its foot. Both of those states move the
 * controls when the box appears, in opposite directions:
 *
 *   - below the cap, the sheet grows upward and everything above the box
 *     lifts — measured at 19px on an iPhone SE and 67px on an iPhone 13;
 *   - at the cap the sheet scrolls instead, and anything inserted above the
 *     buttons pushes them DOWN — 56px on the SE, with "Delete step" landing
 *     partly off screen.
 *
 * Either way a 44px target moves further than its own height, and a tap
 * straddles the move: blur fires on pointerdown and React's onClick on
 * pointerup, so committing an invalid label by tapping "Add an ingredient
 * here" slid "Split…" under the finger before it lifted. CLAUDE.md's rule —
 * nothing may resize under a fingertip — with a sheet instead of a chip.
 *
 * So the message is positioned absolutely against this wrapper: it takes no
 * space, and nothing in the sheet moves at all. It is also
 * `pointer-events: none`, which is the half that makes it honest — the tap
 * that revealed the error still reaches the control it was aimed at, rather
 * than being swallowed by the thing that appeared over it.
 */
function Field({ messages, children }: { messages: string[]; children: React.ReactNode }) {
  return (
    <div className="rd-field-anchor">
      {children}
      {messages.length ? (
        <div className="rd-error rd-field-error" role="alert">
          <ul className="rd-json-errors">
            {messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
  // Keyed by field so the message can be rendered under the box that caused
  // it — see Field for why that is load-bearing rather than tidy.
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const at = (field: string) => problems[field] ?? [];

  const commit = (field: string, fields: Parameters<typeof buildOp>[1]) => {
    const op = buildOp(ingredientId, fields);
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };

  const commitAmount = () => {
    const p = parseAmount(amount);
    commit("amount", { qty: p.qty, qtyMax: p.qtyMax, text: p.text });
  };

  const targets = useMemo(() => validMoveTargets(recipe, ingredientId), [recipe, ingredientId]);
  const parent = parentStepOf(recipe, ingredientId);
  const blocked = targets.length ? null : noTargetsReason(recipe, ingredientId);
  const blockedDelete = useMemo(
    () => deleteIngredientBlocker(recipe, ingredientId),
    [recipe, ingredientId]
  );

  return (
    <>
      <div className="rd-sheet-head">
        <h2 className="rd-sheet-title">{ing.name || "Ingredient"}</h2>
        <button className="rd-btn" onClick={onClose}>
          Done
        </button>
      </div>

      <Field messages={at("amount")}>
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
      </Field>

      <Field messages={at("unit")}>
  <label className="rd-field">
          <span className="rd-field-label">Unit</span>
          <select
            className="rd-field-input"
            value={ing.unit ?? ""}
            onChange={(e) => commit("unit", { unit: (e.target.value || null) as Unit | null })}
          >
            <option value="">none (countable)</option>
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u] ?? u}
              </option>
            ))}
          </select>
        </label>
      </Field>

      <Field messages={at("name")}>
  <label className="rd-field">
          <span className="rd-field-label">Name</span>
          <input
            className="rd-field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => commit("name", { name })}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit("name", { name }))}
          />
        </label>
      </Field>

      <Field messages={at("note")}>
  <label className="rd-field">
          <span className="rd-field-label">
            Note <span className="rd-field-hint">prep that isn’t a step</span>
          </span>
          <input
            className="rd-field-input"
            value={note}
            placeholder="finely diced"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => commit("note", { note: note.trim() || null })}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.preventDefault(), commit("note", { note: note.trim() || null }))
            }
          />
        </label>
      </Field>

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

      {/* Delete is last, is the only red thing in the sheet, and says why it
          cannot happen rather than going grey with no explanation. The
          blocker is computed from the candidate tree, so it is the same
          answer the server would give. */}
      <div className="rd-field">
        <button
          className="rd-btn rd-step-danger"
          disabled={!!blockedDelete}
          onClick={() => onApply({ type: "deleteIngredient", ingredientId })}
        >
          Delete “{ing.name || "this ingredient"}”
        </button>
        {blockedDelete ? <p className="rd-sheet-blocked">{blockedDelete}</p> : null}
      </div>

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
  const [minutes, setMinutes] = useState(
    typeof node.minutes === "number" ? String(node.minutes) : ""
  );
  const [tempF, setTempF] = useState(
    typeof node.tempF === "number" ? String(node.tempF) : ""
  );
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const at = (field: string) => problems[field] ?? [];

  const commit = (field: string, fields: StepFields) => {
    const op: EditOp = { type: "setStepFields", stepId, fields };
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };

  const commitLabel = () => commit("label", { label: label.trim() });

  return (
    <>
      <div className="rd-sheet-head">
        <h2 className="rd-sheet-title">Step</h2>
        <button className="rd-btn" onClick={onClose}>
          Done
        </button>
      </div>

      <Field messages={at("label")}>
        <label className="rd-field">
          <span className="rd-field-label">
            Label <span className="rd-field-hint">a few words</span>
          </span>
          <input
            ref={firstFieldRef}
            className="rd-field-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitLabel())}
          />
        </label>
      </Field>

      {/* Time and temperature are not decoration on the label. `minutes` is
          what StepsMode offers a timer for and what the library card totals;
          `tempF` is what the finish strip shows. A step whose label says
          "bake 325°F 12 min" with both fields empty looks right and silently
          has no timer, which is exactly the recipe someone is editing here to
          fix. Two boxes side by side — they are short, and stacking them
          would push the structural actions below the fold on an SE. */}
      <Field messages={[...at("minutes"), ...at("tempF")]}>
        <div className="rd-field-row">
        <label className="rd-field">
          <span className="rd-field-label">
            Time <span className="rd-field-hint">minutes</span>
          </span>
          <input
            className="rd-field-input"
            value={minutes}
            inputMode="decimal"
            placeholder="—"
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={() => commit("minutes", { minutes: parseTiming(minutes) })}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              (e.preventDefault(), commit("minutes", { minutes: parseTiming(minutes) }))
            }
          />
        </label>
        <label className="rd-field">
          <span className="rd-field-label">
            Temp <span className="rd-field-hint">°F</span>
          </span>
          <input
            className="rd-field-input"
            value={tempF}
            inputMode="decimal"
            placeholder="—"
            onChange={(e) => setTempF(e.target.value)}
            onBlur={() => commit("tempF", { tempF: parseTiming(tempF) })}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              (e.preventDefault(), commit("tempF", { tempF: parseTiming(tempF) }))
            }
          />
        </label>
        </div>
      </Field>

      <StepActions recipe={recipe} stepId={stepId} onApply={onApply} onClose={onClose} />
    </>
  );
}

/**
 * The four shape-changing operations, under the label field in the step
 * sheet — no new gesture and no new mode, because edit mode already brings
 * someone here by tapping the step they think is wrong.
 *
 * Order is deliberate: the two constructive actions first, the two
 * destructive ones last.
 */
function StepActions({
  recipe,
  stepId,
  onApply,
  onClose,
}: {
  recipe: Recipe;
  stepId: string;
  onApply: (op: EditOp) => void;
  onClose: () => void;
}) {
  const [splitting, setSplitting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [adding, setAdding] = useState(false);

  const node = recipe.sections.flatMap((s) => s.nodes).find((n) => n.id === stepId)!;
  const next = consumerOf(recipe, stepId);
  const isRoot = !next;

  const run = (op: EditOp) => {
    const errors = problemsWith(recipe, op);
    if (errors.length) return errors;
    onApply(op);
    return null;
  };

  const [blocked, setBlocked] = useState<string | null>(null);

  if (adding) {
    return (
      <AddIngredientForm
        recipe={recipe}
        stepId={stepId}
        onApply={onApply}
        onDone={() => {
          setAdding(false);
          onClose();
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }

  if (splitting) {
    return (
      <SplitForm
        recipe={recipe}
        stepId={stepId}
        onApply={onApply}
        onDone={() => {
          setSplitting(false);
          onClose();
        }}
        onCancel={() => setSplitting(false)}
      />
    );
  }

  if (merging && next) {
    return (
      <div className="rd-field">
        <span className="rd-field-label">
          Merge into “{next.label}” <span className="rd-field-hint">which label stays?</span>
        </span>
        <div className="rd-move-list">
          {/* The later label first, because it is the default and usually
              names the finished state. Joining the two is not offered:
              validateRecipe caps a label at eight words, so a joined label
              would routinely be refused. */}
          <button
            className="rd-move-opt is-current"
            onClick={() => {
              const errors = run({ type: "mergeStepInto", stepId, label: next.label });
              if (errors) setBlocked(errors[0]);
              else onClose();
            }}
          >
            {next.label}
          </button>
          <button
            className="rd-move-opt"
            onClick={() => {
              const errors = run({ type: "mergeStepInto", stepId, label: node.label });
              if (errors) setBlocked(errors[0]);
              else onClose();
            }}
          >
            {node.label}
          </button>
        </div>
        <button className="rd-btn rd-step-cancel" onClick={() => setMerging(false)}>
          Cancel
        </button>
        {blocked ? <p className="rd-sheet-blocked">{blocked}</p> : null}
      </div>
    );
  }

  return (
    <div className="rd-field">
      {/* Adding an ingredient is its own row above the structural actions,
          not a fifth button among them. It is the one thing here someone
          reaches for because the recipe is WRONG rather than because they
          want it shaped differently — a missing ingredient makes the recipe
          unusable, where a bad split only makes it awkward — so it does not
          queue behind four ways to rearrange steps. */}
      <span className="rd-field-label">Ingredients</span>
      <div className="rd-step-actions">
        <button className="rd-btn" onClick={() => setAdding(true)}>
          Add an ingredient here
        </button>
      </div>

      <span className="rd-field-label rd-field-label-gap">This step</span>
      <div className="rd-step-actions">
        <button className="rd-btn" onClick={() => setSplitting(true)}>
          Split…
        </button>
        <button
          className="rd-btn"
          onClick={() => {
            const errors = run({
              type: "addStepAfter",
              afterStepId: stepId,
              label: "new step",
            });
            if (errors) setBlocked(errors[0]);
            else onClose();
          }}
        >
          Add step after
        </button>
        <button
          className="rd-btn"
          disabled={isRoot}
          title={isRoot ? "Nothing comes after this step" : `Merge into “${next!.label}”`}
          onClick={() => setMerging(true)}
        >
          Merge into next
        </button>
        <button
          className="rd-btn rd-step-danger"
          onClick={() => {
            const errors = run({ type: "deleteStep", stepId });
            if (errors) setBlocked(errors[0]);
            else onClose();
          }}
        >
          Delete step
        </button>
      </div>
      {blocked ? <p className="rd-sheet-blocked">{blocked}</p> : null}
    </div>
  );
}

/**
 * Splitting needs one decision the other three do not: which inputs go to
 * which half. Everything starts on the FIRST half — the first half is "the
 * step you already had", the second is "the one you are adding after it" —
 * and that default is always valid, because the second half is never
 * input-less: it always consumes the first.
 */
function SplitForm({
  recipe,
  stepId,
  onApply,
  onDone,
  onCancel,
}: {
  recipe: Recipe;
  stepId: string;
  onApply: (op: EditOp) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const section = recipe.sections.find((s) => s.nodes.some((n) => n.id === stepId))!;
  const node = section.nodes.find((n) => n.id === stepId)!;
  const nameOf = (id: string) =>
    section.ingredients.find((i) => i.id === id)?.name ??
    section.nodes.find((n) => n.id === id)?.label ??
    id;

  const [firstLabel, setFirstLabel] = useState(node.label ?? "");
  const [secondLabel, setSecondLabel] = useState("");
  const [toSecond, setToSecond] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);

  const op: EditOp = {
    type: "splitStep",
    stepId,
    firstLabel: firstLabel.trim(),
    secondLabel: secondLabel.trim(),
    toSecond,
  };

  return (
    <div className="rd-field">
      <span className="rd-field-label">
        Split in two <span className="rd-field-hint">the second follows the first</span>
      </span>

      <label className="rd-field">
        <span className="rd-field-label">First step</span>
        <input
          className="rd-field-input"
          value={firstLabel}
          onChange={(e) => setFirstLabel(e.target.value)}
        />
      </label>
      <label className="rd-field">
        <span className="rd-field-label">Then</span>
        <input
          className="rd-field-input"
          value={secondLabel}
          placeholder="what happens next"
          onChange={(e) => setSecondLabel(e.target.value)}
        />
      </label>

      {(node.inputs ?? []).length ? (
        <div className="rd-field">
          <span className="rd-field-label">
            Move to the second step <span className="rd-field-hint">tap to move</span>
          </span>
          <div className="rd-move-list">
            {(node.inputs ?? []).map((id) => {
              const on = toSecond.includes(id);
              return (
                <button
                  key={id}
                  aria-pressed={on}
                  className={`rd-move-opt ${on ? "is-current" : ""}`}
                  onClick={() =>
                    setToSecond((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                    )
                  }
                >
                  {nameOf(id)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="rd-step-actions">
        <button
          className="rd-go"
          onClick={() => {
            const errors = problemsWith(recipe, op);
            if (errors.length) {
              setProblems(errors);
              return;
            }
            onApply(op);
            onDone();
          }}
        >
          Split
        </button>
        <button className="rd-btn" onClick={onCancel}>
          Cancel
        </button>
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
    </div>
  );
}

/**
 * Adding an ingredient. The same three boxes as the ingredient sheet, minus
 * the note and the move list — a thing that does not exist yet has nowhere to
 * move from, and a prep note is an edit you make once you can see it.
 *
 * It does not commit on blur the way the edit sheet does. Blur-commit is
 * right when the row already exists and each field is an independent
 * correction; here the three fields are one act, and committing on the first
 * blur would insert a nameless ingredient the validator immediately rejects,
 * with the sheet still open over it. So: one button, one op.
 */
function AddIngredientForm({
  recipe,
  stepId,
  onApply,
  onDone,
  onCancel,
}: {
  recipe: Recipe;
  stepId: string;
  onApply: (op: EditOp) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const step = recipe.sections.flatMap((s) => s.nodes).find((n) => n.id === stepId)!;
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<string>("");
  const [name, setName] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const build = (): EditOp => {
    const p = parseAmount(amount);
    return {
      type: "addIngredient",
      toStepId: stepId,
      fields: {
        qty: p.qty,
        qtyMax: p.qtyMax,
        text: p.text,
        unit: (unit || null) as Unit | null,
        name: name.trim(),
      },
    };
  };

  return (
    <div className="rd-field">
      <span className="rd-field-label">
        Add to “{step.label}” <span className="rd-field-hint">it joins this step</span>
      </span>

      <label className="rd-field">
        <span className="rd-field-label">Name</span>
        <input
          ref={nameRef}
          className="rd-field-input"
          value={name}
          placeholder="egg yolks"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="rd-field-row">
        <label className="rd-field">
          <span className="rd-field-label">Amount</span>
          <input
            className="rd-field-input"
            value={amount}
            inputMode="text"
            placeholder="2 or 2-3"
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="rd-field">
          <span className="rd-field-label">Unit</span>
          <select
            className="rd-field-input"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="">none</option>
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u] ?? u}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rd-step-actions">
        <button
          className="rd-go"
          onClick={() => {
            const op = build();
            const errors = problemsWith(recipe, op);
            if (errors.length) {
              setProblems(errors);
              return;
            }
            onApply(op);
            onDone();
          }}
        >
          Add
        </button>
        <button className="rd-btn" onClick={onCancel}>
          Cancel
        </button>
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
    </div>
  );
}
