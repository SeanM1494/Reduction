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
  deleteSectionBlocker,
  linkConsequence,
  noTargetsReason,
  parentStepOf,
  parseAmount,
  parseTiming,
  validMoveTargets,
  type EditOp,
  type RecipeFields,
  type SectionFields,
  type StepFields,
} from "../../../shared/edits";

/**
 * What the sheet is open on.
 *
 * A discriminated union rather than a widened `targetId: string`, because
 * "recipe" and "section 0" would otherwise have to be sentinel id strings —
 * and ids in this app come from an extraction, so an ingredient genuinely
 * called `recipe` is a thing a model can produce. A sentinel that a real id
 * can collide with is a bug waiting for the wrong recipe.
 *
 * Sections are addressed by INDEX, which is the one asymmetry in the editor:
 * every other op takes an id, deliberately, so no array position has to be
 * kept in sync with the UI. Sections have no id — only a name, which is
 * mutable and may repeat — and giving them one would mean touching
 * `layout.ts` and migrating every stored recipe. The index is made safe by
 * closing the sheet on any structural op, so no index outlives the tree it
 * was read from.
 */
export type EditTarget =
  | { kind: "node"; id: string }
  | { kind: "recipe" }
  | { kind: "section"; index: number };

interface Props {
  recipe: Recipe;
  target: EditTarget;
  onApply: (op: EditOp) => void;
  onClose: () => void;
}

const UNIT_LABEL: Record<string, string> = { fl_oz: "fl oz", tbsp: "Tbs" };

/** The picker's options come from the validator's own set, so it can never
 *  offer a unit the server will refuse. */
const UNIT_OPTIONS = [...UNITS] as Unit[];

export default function EditSheet({ recipe, target, onApply, onClose }: Props) {
  const targetId = target.kind === "node" ? target.id : "";
  const section = recipe.sections.find(
    (s) =>
      s.ingredients.some((i) => i.id === targetId) || s.nodes.some((n) => n.id === targetId)
  );
  const ingredient = section?.ingredients.find((i) => i.id === targetId) ?? null;
  const stepNode = section?.nodes.find((n) => n.id === targetId) ?? null;

  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [targetId, target.kind]);

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

  if (target.kind === "node" && !ingredient && !stepNode) return null;
  if (target.kind === "section" && !recipe.sections[target.index]) return null;

  const label =
    target.kind === "recipe"
      ? "Edit recipe"
      : target.kind === "section"
        ? "Edit section"
        : ingredient
          ? "Edit ingredient"
          : "Edit step";

  return (
    <div className="rd-sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rd-sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="rd-sheet-grab" aria-hidden="true" />
        {target.kind === "recipe" ? (
          <RecipeFieldsForm
            recipe={recipe}
            onApply={onApply}
            onClose={onClose}
            firstFieldRef={firstFieldRef}
          />
        ) : target.kind === "section" ? (
          <SectionFieldsForm
            key={target.index}
            recipe={recipe}
            sectionIndex={target.index}
            onApply={onApply}
            onClose={onClose}
            firstFieldRef={firstFieldRef}
          />
        ) : ingredient ? (
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
function Field({
  messages,
  notice,
  children,
}: {
  messages: string[];
  /** A consequence rather than a problem: the edit is legal and will be
   *  accepted, but something about it is worth knowing first. Shares the
   *  absolute slot with `messages` for the same reason they do — a notice
   *  that took up space would move the controls exactly as an error did. */
  notice?: string | null;
  children: React.ReactNode;
}) {
  const has = messages.length > 0 || !!notice;
  return (
    <div className="rd-field-anchor">
      {children}
      {has ? (
        <div className="rd-field-error" role="alert">
          {messages.length ? (
            <ul className="rd-json-errors rd-error">
              {messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          ) : null}
          {notice ? <p className="rd-link-warn">{notice}</p> : null}
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

  /**
   * Renaming an ingredient can change what order the recipe is cooked in.
   *
   * This is the oldest hole in the editor, not a consequence of the new
   * section ops. `sequence.ts` links a section to its consumer by NAME — the
   * component "Dry ingredients" is made in its own section and appears as an
   * ingredient of that name in the section that uses it — so renaming that
   * ingredient severs the link. Both sections stay internally valid,
   * `validateRecipe` has nothing to say, the diagram stays correct, and
   * step-by-step quietly starts saying bake before mix. That is exactly the
   * cookie bug, and it has been reachable from this box since the ingredient
   * sheet shipped.
   *
   * Computed from the box's live value, not the stored one, so it is a
   * warning before the commit rather than a report after it.
   */
  const renameWarning = useMemo(() => {
    const trimmed = name.trim();
    if (trimmed === (ing.name ?? "")) return null;
    try {
      return linkConsequence(
        recipe,
        applyEdit(recipe, {
          type: "setIngredientFields",
          ingredientId,
          fields: { name: trimmed },
        })
      );
    } catch {
      return null;
    }
  }, [recipe, ingredientId, name, ing.name]);

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

      <Field messages={at("name")} notice={renameWarning}>
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

      <InputOrder recipe={recipe} stepId={stepId} onApply={onApply} />

      <StepActions recipe={recipe} stepId={stepId} onApply={onApply} onClose={onClose} />
    </>
  );
}

/**
 * The order this step's inputs appear in, which is the order their rows
 * appear in the diagram and the order they are read out in step-by-step.
 *
 * The only purely cosmetic operation in the editor, and the last thing the
 * raw JSON could express that this could not. It is reachable by composition
 * in a big section — move an ingredient out to another step and back and it
 * lands at the end — but not in a two-step section, where there is nowhere
 * valid to park it. So it gets its own op.
 *
 * Up/down buttons rather than a drag. The drag that exists is for moving an
 * ingredient BETWEEN steps and is a press-and-hold on the diagram cell;
 * a second drag idiom, inside a scrolling sheet, over a list whose items are
 * 44px apart, would be two gestures competing for the same finger. Two
 * buttons are unambiguous, keyboard-reachable, and cannot be started by
 * accident while scrolling the sheet.
 */
function InputOrder({
  recipe,
  stepId,
  onApply,
}: {
  recipe: Recipe;
  stepId: string;
  onApply: (op: EditOp) => void;
}) {
  const section = recipe.sections.find((s) => s.nodes.some((n) => n.id === stepId))!;
  const node = section.nodes.find((n) => n.id === stepId)!;
  const inputs = node.inputs ?? [];
  if (inputs.length < 2) return null;

  const nameOf = (id: string) =>
    section.ingredients.find((i) => i.id === id)?.name ??
    section.nodes.find((n) => n.id === id)?.label ??
    id;

  const swap = (i: number, j: number) => {
    const next = [...inputs];
    [next[i], next[j]] = [next[j], next[i]];
    onApply({ type: "reorderInputs", stepId, inputs: next });
  };

  return (
    <div className="rd-field">
      <span className="rd-field-label">
        Order <span className="rd-field-hint">how these rows are listed</span>
      </span>
      <ul className="rd-order-list">
        {inputs.map((id, i) => (
          <li key={id} className="rd-order-row">
            <span className="rd-order-name">{nameOf(id)}</span>
            <button
              className="rd-btn rd-order-btn"
              disabled={i === 0}
              aria-label={`Move ${nameOf(id)} up`}
              onClick={() => swap(i, i - 1)}
            >
              ↑
            </button>
            <button
              className="rd-btn rd-order-btn"
              disabled={i === inputs.length - 1}
              aria-label={`Move ${nameOf(id)} down`}
              onClick={() => swap(i, i + 1)}
            >
              ↓
            </button>
          </li>
        ))}
      </ul>
    </div>
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


/**
 * The recipe's own fields, which are the only ones not attached to a cell.
 *
 * They are reached from the edit bar rather than by tapping something,
 * because there is nothing on screen to tap: `.rfx-bar-title` measures 29x16
 * on an iPhone SE and is already truncated, in a bar that at 320px is
 * carrying back, progress, Edit and the overflow menu. Growing it to a 44px
 * target is not a matter of padding, there is no room. The edit bar is the
 * one surface that exists only while editing, already says so, and had space:
 * appending an 84px button to it cost 0px of height at both 320 and 390.
 *
 * SERVINGS HERE IS `recipe.servings`, AND THAT IS NOT THE COOKING NUMBER.
 *
 * `recipe.servings` is what the recipe makes — a correction. `entry.servings`
 * is what you are making tonight, and `scale` is the second divided by the
 * first. They must never be written by one control: it would hold
 * `scale` at exactly 1 for ever, scaling would stop working, and nothing
 * anywhere would report it. See ROADMAP and CLAUDE.md.
 */
function RecipeFieldsForm({
  recipe,
  onApply,
  onClose,
  firstFieldRef,
}: {
  recipe: Recipe;
  onApply: (op: EditOp) => void;
  onClose: () => void;
  firstFieldRef: React.RefObject<HTMLInputElement>;
}) {
  const [title, setTitle] = useState(recipe.title ?? "");
  const [servings, setServings] = useState(
    typeof recipe.servings === "number" ? String(recipe.servings) : ""
  );
  const [source, setSource] = useState(recipe.source ?? "");
  const [sourceUrl, setSourceUrl] = useState(recipe.sourceUrl ?? "");
  const [yieldText, setYieldText] = useState(recipe.yieldText ?? "");
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const at = (field: string) => problems[field] ?? [];

  const commit = (field: string, fields: RecipeFields) => {
    const op: EditOp = { type: "setRecipeFields", fields };
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };

  const text = (
    field: string,
    labelText: string,
    hint: string | null,
    value: string,
    set: (v: string) => void,
    build: () => RecipeFields,
    extra?: { ref?: React.RefObject<HTMLInputElement>; placeholder?: string; mode?: "text" | "decimal" | "url" }
  ) => (
    <Field messages={at(field)}>
      <label className="rd-field">
        <span className="rd-field-label">
          {labelText} {hint ? <span className="rd-field-hint">{hint}</span> : null}
        </span>
        <input
          ref={extra?.ref}
          className="rd-field-input"
          value={value}
          inputMode={extra?.mode === "decimal" ? "decimal" : extra?.mode === "url" ? "url" : "text"}
          placeholder={extra?.placeholder}
          onChange={(e) => set(e.target.value)}
          onBlur={() => commit(field, build())}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit(field, build()))}
        />
      </label>
    </Field>
  );

  return (
    <>
      <div className="rd-sheet-head">
        <h2 className="rd-sheet-title">Recipe</h2>
        <button className="rd-btn" onClick={onClose}>
          Done
        </button>
      </div>

      {text("title", "Title", null, title, setTitle, () => ({ title: title.trim() }), {
        ref: firstFieldRef,
      })}

      {text(
        "servings",
        "Serves",
        "what the recipe makes",
        servings,
        setServings,
        () => ({ servings: parseTiming(servings) }),
        { mode: "decimal", placeholder: "—" }
      )}

      {text(
        "yieldText",
        "Yield",
        "in the source's words",
        yieldText,
        setYieldText,
        () => ({ yieldText: yieldText.trim() || null }),
        { placeholder: "makes 24 cookies" }
      )}

      {text("source", "Source", null, source, setSource, () => ({ source: source.trim() || null }), {
        placeholder: "NYT Cooking",
      })}

      {text(
        "sourceUrl",
        "Link",
        null,
        sourceUrl,
        setSourceUrl,
        () => ({ sourceUrl: sourceUrl.trim() || null }),
        { mode: "url", placeholder: "https://…" }
      )}

      <SectionList recipe={recipe} onApply={onApply} onClose={onClose} />
    </>
  );
}

/**
 * Adding a section, from the recipe sheet — the one structural operation with
 * no cell of its own to hang off.
 *
 * Three fields, not five. A section cannot be empty (validateRecipe wants a
 * step with an input, and an ingredient wants a qty or a text fallback), so
 * something has to be invented; the amount defaults to 1, which always
 * validates and is one tap from being corrected in the pattern the user
 * already knows. Asking for it up front would make a five-field form the
 * first thing anyone meets here.
 */
function SectionList({
  recipe,
  onApply,
  onClose,
}: {
  recipe: Recipe;
  onApply: (op: EditOp) => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [firstStep, setFirstStep] = useState("");
  const [firstIngredient, setFirstIngredient] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  if (!adding) {
    return (
      <div className="rd-field">
        <span className="rd-field-label">
          Sections <span className="rd-field-hint">tap a section's title to rename it</span>
        </span>
        <div className="rd-step-actions">
          <button className="rd-btn" onClick={() => setAdding(true)}>
            Add a section
          </button>
        </div>
      </div>
    );
  }

  const op: EditOp = {
    type: "addSection",
    name: name.trim(),
    firstStep: firstStep.trim(),
    firstIngredient: firstIngredient.trim(),
  };

  return (
    <div className="rd-field">
      <span className="rd-field-label">
        New section <span className="rd-field-hint">a part made separately</span>
      </span>

      <Field messages={[]}>
        <label className="rd-field">
          <span className="rd-field-label">Called</span>
          <input
            className="rd-field-input"
            value={name}
            placeholder="Streusel topping"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </Field>
      <Field messages={[]}>
        <label className="rd-field">
          <span className="rd-field-label">First ingredient</span>
          <input
            className="rd-field-input"
            value={firstIngredient}
            placeholder="rolled oats"
            onChange={(e) => setFirstIngredient(e.target.value)}
          />
        </label>
      </Field>
      <Field messages={[]}>
        <label className="rd-field">
          <span className="rd-field-label">First step</span>
          <input
            className="rd-field-input"
            value={firstStep}
            placeholder="rub together"
            onChange={(e) => setFirstStep(e.target.value)}
          />
        </label>
      </Field>

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
            onClose();
          }}
        >
          Add section
        </button>
        <button className="rd-btn" onClick={() => setAdding(false)}>
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
 * A section's name and header, and the one op that can quietly change what
 * order someone cooks in.
 *
 * The name is half of the section-as-ingredient link `sequence.ts` orders by
 * (see brokenComponentLinks). Renaming or deleting a section can break that
 * link while leaving both sections internally valid, so `validateRecipe`
 * has nothing to say and the only symptom is step-by-step reordering itself.
 * `linkConsequence` is shown BEFORE the tap for a rename, and behind a
 * confirm for a delete — a warning rather than a refusal, because breaking
 * the link is sometimes exactly the intent.
 */
function SectionFieldsForm({
  recipe,
  sectionIndex,
  onApply,
  onClose,
  firstFieldRef,
}: {
  recipe: Recipe;
  sectionIndex: number;
  onApply: (op: EditOp) => void;
  onClose: () => void;
  firstFieldRef: React.RefObject<HTMLInputElement>;
}) {
  const section = recipe.sections[sectionIndex];
  const [name, setName] = useState(section.name ?? "");
  const [header, setHeader] = useState(section.header ?? "");
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const at = (field: string) => problems[field] ?? [];

  const commit = (field: string, fields: SectionFields) => {
    const op: EditOp = { type: "setSectionFields", sectionIndex, fields };
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };

  // Live, from the name in the box rather than from the stored name: the
  // point is to say what WILL happen while there is still time not to do it.
  const renameWarning = useMemo(() => {
    const trimmed = name.trim();
    if (trimmed === (section.name ?? "")) return null;
    try {
      const candidate = applyEdit(recipe, {
        type: "setSectionFields",
        sectionIndex,
        fields: { name: trimmed },
      });
      return linkConsequence(recipe, candidate);
    } catch {
      return null;
    }
  }, [recipe, sectionIndex, name, section.name]);

  const deleteBlocked = deleteSectionBlocker(recipe, sectionIndex);
  const deleteWarning = useMemo(() => {
    if (deleteBlocked) return null;
    try {
      return linkConsequence(
        recipe,
        applyEdit(recipe, { type: "deleteSection", sectionIndex })
      );
    } catch {
      return null;
    }
  }, [recipe, sectionIndex, deleteBlocked]);

  if (confirmingDelete) {
    return (
      <>
        <div className="rd-sheet-head">
          <h2 className="rd-sheet-title">Delete section?</h2>
          <button className="rd-btn" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        </div>
        <div className="rd-field">
          <p className="rd-sheet-blocked">{deleteWarning}</p>
          <div className="rd-step-actions">
            <button
              className="rd-btn rd-step-danger"
              onClick={() => {
                onApply({ type: "deleteSection", sectionIndex });
                onClose();
              }}
            >
              Delete “{section.name || "this section"}”
            </button>
            <button className="rd-btn" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="rd-sheet-head">
        <h2 className="rd-sheet-title">Section</h2>
        <button className="rd-btn" onClick={onClose}>
          Done
        </button>
      </div>

      <Field messages={at("name")} notice={renameWarning}>
        <label className="rd-field">
          <span className="rd-field-label">Called</span>
          <input
            ref={firstFieldRef}
            className="rd-field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => commit("name", { name: name.trim() })}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.preventDefault(), commit("name", { name: name.trim() }))
            }
          />
        </label>
      </Field>

      <Field messages={at("header")}>
        <label className="rd-field">
          <span className="rd-field-label">
            Standing note <span className="rd-field-hint">shown above the table</span>
          </span>
          <input
            className="rd-field-input"
            value={header}
            placeholder="Heat the oven to 350°F"
            onChange={(e) => setHeader(e.target.value)}
            onBlur={() => commit("header", { header: header.trim() || null })}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              (e.preventDefault(), commit("header", { header: header.trim() || null }))
            }
          />
        </label>
      </Field>

      <div className="rd-field">
        <span className="rd-field-label">This section</span>
        <div className="rd-step-actions">
          <button
            className="rd-btn rd-step-danger"
            disabled={!!deleteBlocked}
            onClick={() => {
              // Straight through when nothing consumes this section by name;
              // the confirm exists to carry the consequence, not as ceremony.
              if (deleteWarning) setConfirmingDelete(true);
              else {
                onApply({ type: "deleteSection", sectionIndex });
                onClose();
              }
            }}
          >
            Delete section
          </button>
        </div>
        {deleteBlocked ? <p className="rd-sheet-blocked">{deleteBlocked}</p> : null}
      </div>
    </>
  );
}
