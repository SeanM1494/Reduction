/**
 * client/src/components/RecipeView.tsx
 *
 * Owns the completion logic. Two directions, both derived from the tree:
 *   completing a step marks everything upstream of it done
 *   undoing a step clears everything downstream, which is no longer valid
 *
 * Opening a recipe leads with a Diagram / Step-by-step chooser rather than
 * dropping straight into a view with every control on screen at once.
 * Once a mode is picked, the header collapses to a thin bar (back, title,
 * progress, overflow menu) and the chosen view fills the rest of the
 * available height. Going back to the chooser is deliberate — this is a
 * "which mode am I cooking in" decision, not a toggle to flick mid-glance.
 * `phase` is local, ephemeral state: App.tsx keys this component by
 * `entry.id`, so switching recipes remounts it and always lands back on
 * the chooser, matching what re-opening a recipe should feel like.
 */

import React, { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { computeLayout, validateRecipe, type Recipe } from "../../../shared/layout";
import type { Entry } from "../lib/storage";
import Diagram from "./Diagram";
import StepsMode from "./StepsMode";
import RecipeJsonEditor from "./RecipeJsonEditor";
import EditSheet, { type EditTarget } from "./EditSheet";
import MealTypeSheet from "./MealTypeSheet";
import RatingControl from "./RatingControl";
import { MEAL_TYPE_LABELS, sanitizeMealTypes } from "../../../shared/mealTypes";
import { applyEdit, type EditOp } from "../../../shared/edits";
import { reconcileDone } from "../../../shared/progress";
import { reextract } from "../lib/api";
import ExtractionProgress from "./ExtractionProgress";
import { lastAcceptedEntry, onSyncFailure } from "../lib/storage";
import { useIngredientDrag } from "../lib/useIngredientDrag";
import { saveRecipeAsImage, slugForFile } from "../lib/exportImage";

interface Props {
  entry: Entry;
  onBack: () => void;
  onUpdate: (entry: Entry) => void;
  onDelete: () => void;
  /**
   * Kept as a prop even though everything now sets it true: it is the one
   * switch that turns off every write, and a future read-only case (a shared
   * recipe someone else owns) wants exactly this. The trial recipe used to
   * set it false, because its edits would have been discarded when signup
   * claimed the parked copy — that is fixed: the trial row itself is now
   * patched, so the edits are on the row the account receives.
   */
  canEdit?: boolean;
}

type Phase = "choose" | "diagram" | "steps" | "json";

/** Deep enough that undo is a real safety net rather than a token gesture,
 *  bounded so a long editing session cannot grow without limit. */
const UNDO_LIMIT = 50;

const DiagramGlyph = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
    <rect x="1" y="4" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <rect x="1" y="21" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <rect x="20" y="12.5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 8.5H15a2 2 0 0 1 2 2V17M10 25.5H15a2 2 0 0 1 2-2V17M17 17h3" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
);

const StepsGlyph = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
    <rect x="4" y="3" width="26" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M9 8h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M17 17v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.5 4" />
    <rect x="4" y="21" width="26" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.6" opacity=".45" />
    <path d="M9 26h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
  </svg>
);

export default function RecipeView({
  entry,
  onBack,
  onUpdate,
  onDelete,
  canEdit = true,
}: Props) {
  const { recipe } = entry;
  const [phase, setPhase] = useState<Phase>("choose");
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [savingImage, setSavingImage] = useState(false);

  /**
   * Edit mode. Ephemeral like `phase`: App keys this component by entry id, so
   * opening another recipe lands back in cooking mode, which is the mode
   * someone opening a recipe is nearly always in.
   */
  const [editing, setEditing] = useState(false);
  const [sheetFor, setSheetFor] = useState<EditTarget | null>(null);
  const [confirmReread, setConfirmReread] = useState(false);
  const [rereading, setRereading] = useState(false);
  const [mealSheetOpen, setMealSheetOpen] = useState(false);
  /**
   * Undo is multi-level because it costs almost nothing to make it so: every
   * edit already produces a whole new Recipe, so the stack is just the
   * previous ones. Bounded so a long session cannot grow without limit.
   */
  const [undoStack, setUndoStack] = useState<Array<{ recipe: Recipe; done: string[] }>>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const done = useMemo(() => new Set(entry.done || []), [entry.done]);

  const baseServings = recipe.servings;
  const servings = entry.servings ?? baseServings;
  const scale = baseServings && servings ? servings / baseServings : 1;

  const { parents, inputs, total } = useMemo(() => {
    const parents = new Map<string, string>();
    const inputs = new Map<string, string[]>();
    let total = 0;
    for (const s of recipe.sections) {
      try {
        const l = computeLayout(s);
        l.parentOf.forEach((v, k) => parents.set(k, v));
        total += (s.ingredients || []).length + (s.nodes || []).length;
        for (const n of s.nodes || []) inputs.set(n.id, n.inputs || []);
      } catch {
        // The section renders its own error.
      }
    }
    return { parents, inputs, total };
  }, [recipe]);

  /** Everything that has to happen before `id` can happen. */
  const upstreamOf = useCallback(
    (id: string) => {
      const acc = new Set<string>();
      (function walk(cur: string) {
        if (acc.has(cur)) return;
        acc.add(cur);
        (inputs.get(cur) || []).forEach(walk);
      })(id);
      return acc;
    },
    [inputs]
  );

  // Hovering a later step shows the blast radius of clicking it.
  const preview = useMemo(() => {
    if (!hovered || done.has(hovered)) return new Set<string>();
    const up = upstreamOf(hovered);
    done.forEach((d) => up.delete(d));
    return up;
  }, [hovered, done, upstreamOf]);

  /**
   * Applies one edit, immediately.
   *
   * No Save button: the change is the save. What makes that safe rather than
   * reckless is that the candidate is validated before it is kept, the
   * previous tree is pushed onto the undo stack, and a server rejection rolls
   * back to the last version the server actually accepted (see the sync
   * failure effect below).
   *
   * `done` is reconciled through shared/progress.ts rather than through a
   * second answer invented here. None of these three operations changes an
   * id, so nothing is ever dropped today — but routing through it now is what
   * stops that being quietly untrue the first time an op deletes something.
   */
  const applyOp = useCallback(
    (op: EditOp) => {
      let next: Recipe;
      try {
        next = applyEdit(recipe, op);
      } catch (e) {
        setSyncError((e as Error).message);
        return;
      }
      const problems = validateRecipe(next);
      if (problems.length) {
        // The sheet checks before calling, and the drag only offers targets
        // that validate, so reaching here means something upstream is wrong
        // rather than that the user typed something odd. Refuse loudly.
        setSyncError(problems[0]);
        return;
      }
      const reconciled = reconcileDone(next, entry.done ?? []);
      setUndoStack((prev) =>
        [...prev, { recipe, done: entry.done ?? [] }].slice(-UNDO_LIMIT)
      );
      onUpdate({ ...entry, recipe: next, done: reconciled.done });
    },
    [recipe, entry, onUpdate]
  );

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      onUpdate({ ...entry, recipe: last.recipe, done: last.done });
      return prev.slice(0, -1);
    });
  }, [entry, onUpdate]);

  useEffect(() => {
    if (!canEdit && editing) setEditing(false);
  }, [canEdit, editing]);

  const drag = useIngredientDrag({
    recipe,
    enabled: editing && canEdit,
    onMove: (ingredientId, toStepId) =>
      applyOp({ type: "moveIngredient", ingredientId, toStepId }),
  });

  /**
   * A write the server refused or never received.
   *
   * Rolling back is not optional here. "Edits apply immediately" is a promise
   * that what is on screen is what is stored, and a failed write breaks it
   * silently — the user would keep editing a tree the server does not have.
   * So the entry goes back to the last accepted version and says so; a failed
   * edit that reverts without a word is nearly as bad as one that vanishes.
   */
  useEffect(
    () =>
      onSyncFailure((failure) => {
        if (failure.id !== entry.id) return;
        const accepted = failure.accepted ?? lastAcceptedEntry(entry.id);
        setSyncError(
          failure.details?.length
            ? `That change was rejected: ${failure.details[0]}`
            : `That change could not be saved (${failure.message}). It has been undone.`
        );
        if (accepted) onUpdate(accepted);
      }),
    [entry.id, onUpdate]
  );

  // Undo with the keyboard, for the mouse-and-keyboard case where the edit bar
  // is not where the hand already is.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undo]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(done);
      if (next.has(id)) {
        let cur: string | undefined = id;
        while (cur) {
          next.delete(cur);
          cur = parents.get(cur);
        }
      } else {
        upstreamOf(id).forEach((u) => next.add(u));
      }

      /**
       * "Cooked it" is observed, not reported: the moment done reaches the
       * full count is a completed cook-through, recorded as a timestamp
       * (ROADMAP #8 — the reliable half of a future rating). Deduped within
       * six hours so un-checking and re-checking the last step counts one
       * dinner, not two; the same window is what mergeCooked uses, so two
       * devices logging the same meal also collapse to one.
       */
      let cooked = entry.cooked ?? [];
      if (total > 0 && next.size === total && done.size < total) {
        const now = Date.now();
        const last = cooked.length ? cooked[cooked.length - 1] : 0;
        if (now - last > 6 * 60 * 60 * 1000) cooked = [...cooked, now];
      }

      onUpdate({ ...entry, done: [...next], cooked });
    },
    [done, parents, upstreamOf, entry, onUpdate, total]
  );

  const pct = total ? Math.round((done.size / total) * 100) : 0;

  const saveAsImage = useCallback(async () => {
    if (!captureRef.current || savingImage) return;
    setSavingImage(true);
    try {
      await saveRecipeAsImage(captureRef.current, slugForFile(recipe.title));
    } catch (e) {
      window.alert(
        `Couldn't save that image: ${(e as Error).message || "unknown error"}`
      );
    } finally {
      setSavingImage(false);
    }
  }, [recipe.title, savingImage]);

  const pickMode = useCallback(
    (m: "diagram" | "steps") => {
      onUpdate({ ...entry, mode: m });
      setPhase(m);
    },
    [entry, onUpdate]
  );

  // Close the overflow menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (phase === "choose") {
    return (
      <div className="rfx-choose-page">
        <div className="rd-crumb no-print">
          <button className="rd-back" onClick={onBack}>
            &larr; All recipes
          </button>
          <div className="rd-crumb-actions">
            <button
              className="rd-btn"
              onClick={() => onUpdate({ ...entry, done: [] })}
            >
              Clear progress
            </button>
            <button className="rd-btn rd-btn-danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>

        <div className="rfx-choose-main">
          <p className="rfx-choose-eyebrow">{recipe.title}</p>
          <h1 className="rfx-choose-title">How do you want to cook this?</h1>

          <div className="rfx-choose-cards">
            <button className="rfx-choose-card" onClick={() => pickMode("diagram")}>
              <span className="rfx-choose-glyph"><DiagramGlyph /></span>
              <span className="rfx-choose-card-title">Diagram</span>
              <span className="rfx-choose-card-desc">
                See the whole dependency tree at once — what mixes into what,
                and what's ready right now.
              </span>
            </button>
            <button className="rfx-choose-card" onClick={() => pickMode("steps")}>
              <span className="rfx-choose-glyph"><StepsGlyph /></span>
              <span className="rfx-choose-card-title">Step-by-step</span>
              <span className="rfx-choose-card-desc">
                One instruction at a time, in order — ingredients folded
                right into the step that needs them.
              </span>
            </button>
          </div>

          {done.size > 0 ? (
            <p className="rfx-choose-resume">
              {done.size} / {total} already done — picking up where you left off.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={captureRef} className="rfx-page rd-capture">
      <div className="rfx-bar">
        <button
          className="rfx-bar-back no-print"
          onClick={() => setPhase("choose")}
          title="Change view"
        >
          &larr;
        </button>
        <span className="rfx-bar-title">{recipe.title}</span>
        <span className="rfx-bar-mode">{phase === "diagram" ? "Diagram" : "Steps"}</span>

        <div className="rfx-bar-progress" title={`${done.size} of ${total} done`}>
          <span className="rfx-bar-track">
            <span className="rfx-bar-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="rfx-bar-count">
            {done.size}/{total}
          </span>
        </div>

        {phase === "diagram" && canEdit ? (
          <button
            className={`rd-btn rfx-edit-toggle no-print ${editing ? "is-on" : ""}`}
            aria-pressed={editing}
            onClick={() => {
              setEditing((v) => !v);
              setSheetFor(null);
              drag.cancel();
            }}
            title={editing ? "Stop editing and go back to cooking" : "Edit this recipe"}
          >
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}

        <div className="rfx-menu no-print" ref={menuRef}>
          <button
            className="rfx-menu-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="More actions"
          >
            &#8942;
          </button>
          {menuOpen ? (
            <div className="rfx-menu-panel" role="menu">
              <button
                className="rfx-menu-item"
                role="menuitem"
                disabled={savingImage}
                onClick={() => {
                  setMenuOpen(false);
                  saveAsImage();
                }}
              >
                {savingImage ? "Saving…" : "Save as Image"}
              </button>
              {/* Still gated on canEdit, which now means "this entry can be
                  written to" rather than "this is not the trial" — the trial
                  is patchable (PATCH /api/trial/recipe) and App no longer
                  passes canEdit={false} for it. Kept because a read-only
                  view is a thing this component should still be able to be. */}
              {canEdit ? (
                <button
                  className="rfx-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setMealSheetOpen(true);
                  }}
                >
                  Meal types
                </button>
              ) : null}
              <button
                className="rfx-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onUpdate({ ...entry, done: [] });
                }}
              >
                Clear progress
              </button>
              {/* Re-reading the source page, which replaces what is cached
                  for that URL for everyone, not only here. Offered only when
                  there is a URL to re-read and an account to be answerable
                  for it — the route refuses otherwise and caps it per day,
                  because every call is an extraction billed against a
                  subscription already paid for. Confirmed rather than
                  immediate: it discards every edit made to this recipe. */}
              {canEdit && recipe.sourceUrl ? (
                <button
                  className="rfx-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmReread(true);
                  }}
                >
                  Read the page again
                </button>
              ) : null}
              {/* The escape hatch for everything the visual editor cannot
                  express yet — adding, deleting, splitting or merging steps,
                  or a root that came out wrong. Those are the repairs that
                  make a recipe unusable rather than merely wrong, so this
                  stays until the editor covers them. */}
              <button
                className="rfx-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setEditing(false);
                  setPhase("json");
                }}
              >
                Advanced: edit raw data
              </button>
              <button
                className="rfx-menu-item rfx-menu-item-danger"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                Delete recipe
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`rfx-content ${phase === "steps" ? "rfx-content-center" : ""}`}>
        {phase === "json" ? (
          <RecipeJsonEditor
            recipe={recipe}
            done={entry.done ?? []}
            onCancel={() => setPhase(entry.mode === "steps" ? "steps" : "diagram")}
            onSave={(nextRecipe, nextDone) => {
              // done comes back already reconciled against the new tree, so
              // the diagram can never be handed an id the tree lost. The
              // server recomputes it too — see shared/progress.ts.
              onUpdate({ ...entry, recipe: nextRecipe, done: nextDone });
              setPhase(entry.mode === "steps" ? "steps" : "diagram");
            }}
          />
        ) : phase === "steps" ? (
          <div className="rfx-steps-wrap">
            <StepsMode
              key={entry.id}
              recipe={recipe}
              entry={entry}
              done={done}
              scale={scale}
              onToggle={toggle}
              onUpdate={onUpdate}
            />
          </div>
        ) : (
          <div className={`rfx-diagram-wrap ${editing ? "is-editing" : ""}`}>
            {/* The meal-type badge, tappable: the overflow menu entry works
                but nobody wanders an overflow menu to discover tagging. The
                badge is the same fact My Recipes' cards show, so tapping the
                thing itself is the obvious edit path. Hidden for the trial
                recipe along with every other write. */}
            {/* Tag and rating share a row: both are standing facts about the
                recipe rather than about this cooking session. The rating only
                appears once the recipe has actually been cooked — before
                that it would collect an opinion about a web page. */}
            {canEdit && (entry.cooked?.length ?? 0) > 0 ? (
              <RatingControl
                rating={entry.rating}
                onChange={(rating) => onUpdate({ ...entry, rating })}
              />
            ) : null}
            {canEdit ? (
              <button
                className="rfx-tag-badge no-print"
                onClick={() => setMealSheetOpen(true)}
                title="Edit meal types"
              >
                {(() => {
                  const types = sanitizeMealTypes(recipe.mealTypes);
                  if (!types.length) return <>Tag meal type</>;
                  return (
                    <>
                      {MEAL_TYPE_LABELS[types[0]]}
                      {types.length > 1 ? (
                        <span className="rfx-tag-more">+{types.length - 1}</span>
                      ) : null}
                    </>
                  );
                })()}
              </button>
            ) : null}
            {/* The mode has to announce itself. Someone who wanders into edit
                mode and taps around must not be left wondering why nothing
                checks off — so the bar is persistent, not a toast. */}
            {editing ? (
              <div className="rd-editbar" role="status">
                <span className="rd-editbar-dot" aria-hidden="true" />
                <span className="rd-editbar-text">
                  <strong>Editing.</strong> Tap to change a cell; press and hold an
                  ingredient to move it. Nothing is being checked off.
                </span>
                {/* The recipe's own fields have no cell to be tapped, and
                    the bar title cannot become one: it measures 29x16 on an
                    iPhone SE and is already truncated. This bar exists only
                    while editing and already had the room — appending this
                    button cost 0px of height at 320 and 390, because the bar
                    already wraps. */}
                <button
                  className="rd-btn"
                  onClick={() => setSheetFor({ kind: "recipe" })}
                  title="Title, servings, source and sections"
                >
                  Recipe&hellip;
                </button>
                <button
                  className="rd-btn"
                  onClick={undo}
                  disabled={undoStack.length === 0}
                  title={
                    undoStack.length ? `Undo (${undoStack.length})` : "Nothing to undo yet"
                  }
                >
                  Undo
                </button>
              </div>
            ) : null}

            {drag.blockedReason ? (
              <p className="rd-editbar-blocked" role="alert">
                {drag.blockedReason}
              </p>
            ) : null}

            {syncError ? (
              <div className="rd-alert" role="alert">
                <span>{syncError}</span>
                <button className="rd-btn" onClick={() => setSyncError(null)}>
                  Dismiss
                </button>
              </div>
            ) : null}

            {recipe.sections.map((s, i) => (
              <Diagram
                key={i}
                index={i}
                section={s}
                done={done}
                preview={preview}
                scale={scale}
                onToggle={toggle}
                onHover={setHovered}
                edit={
                  editing
                    ? {
                        active: true,
                        onTapCell: (id: string) => setSheetFor({ kind: "node", id }),
                        onTapSection: () => setSheetFor({ kind: "section", index: i }),
                        onPointerDown: drag.onPointerDown,
                        pressing: drag.pressing,
                        dragging: drag.dragging,
                        validTargets: drag.validTargets,
                        hoverTarget: drag.hoverTarget,
                      }
                    : undefined
                }
              />
            ))}
            <p className="rd-hint">
              {editing
                ? "Changes save as you make them. Undo reverses the last one."
                : "Amber means you can do it now. Click any step further right to jump ahead — everything it depends on gets marked done with it."}
            </p>
          </div>
        )}

        {/* The dragged cell is drawn here, fixed to the pointer, while the
            real one stays exactly where it is. Moving the actual <td> would
            relayout a rowspan table under a fingertip, which is the failure
            mode the handoff work just removed. pointer-events:none so
            elementFromPoint finds the drop target and not the ghost. */}
        {drag.ghost ? (
          <div
            className="rd-drag-ghost"
            aria-hidden="true"
            style={{
              transform: `translate3d(${drag.ghost.x}px, ${drag.ghost.y}px, 0)`,
              width: drag.ghost.width,
            }}
          >
            {drag.ghost.label}
          </div>
        ) : null}

        <div className="rd-sr-live" role="status" aria-live="polite">
          {drag.dragging
            ? drag.hoverTarget
              ? "Release to move here."
              : "Picked up. Drag to a highlighted step."
            : ""}
        </div>

        {mealSheetOpen ? (
          <MealTypeSheet
            mealTypes={recipe.mealTypes}
            onChange={(next) =>
              // Recipe-level metadata: a direct update, not an applyEdit op.
              // The server sanitises the same list on write.
              onUpdate({ ...entry, recipe: { ...recipe, mealTypes: next } })
            }
            onClose={() => setMealSheetOpen(false)}
          />
        ) : null}

        {confirmReread ? (
          <div
            className="rd-sheet-scrim"
            onPointerDown={(e) => e.target === e.currentTarget && setConfirmReread(false)}
          >
            <div className="rd-sheet" role="dialog" aria-modal="true" aria-label="Read the page again">
              <div className="rd-sheet-grab" aria-hidden="true" />
              <div className="rd-sheet-head">
                <h2 className="rd-sheet-title">Read the page again?</h2>
                <button className="rd-btn" onClick={() => setConfirmReread(false)}>
                  Cancel
                </button>
              </div>
              <div className="rd-field">
                <p className="rd-sheet-blocked">
                  This reads {recipe.source || "the source page"} from scratch and replaces
                  this diagram with what comes back. Any changes you have made here are
                  lost, and there is no undo for it.
                </p>
                <div className="rd-step-actions">
                  <button
                    className="rd-btn rd-step-danger"
                    disabled={rereading}
                    onClick={async () => {
                      setRereading(true);
                      setSyncError(null);
                      try {
                        const { recipe: fresh } = await reextract(recipe.sourceUrl!);
                        onUpdate({
                          ...entry,
                          recipe: fresh,
                          done: reconcileDone(fresh, entry.done ?? []).done,
                        });
                        setConfirmReread(false);
                      } catch (e) {
                        setSyncError((e as Error).message);
                        setConfirmReread(false);
                      } finally {
                        setRereading(false);
                      }
                    }}
                  >
                    {rereading ? "Reading\u2026" : "Read it again"}
                  </button>
                  <button className="rd-btn" onClick={() => setConfirmReread(false)}>
                    Keep this one
                  </button>
                </div>
                {/* The re-read is a full extraction and takes just as long as
                    the first one did, so it gets the same sequence rather
                    than a button that says "Reading…" and then nothing. */}
                <ExtractionProgress active={rereading} />
              </div>
            </div>
          </div>
        ) : null}

        {editing && sheetFor ? (
          <EditSheet
            recipe={recipe}
            target={sheetFor}
            onApply={applyOp}
            onClose={() => setSheetFor(null)}
          />
        ) : null}

        {recipe.sourceUrl ? (
          <p className="rd-source">
            From{" "}
            <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">
              {recipe.source || recipe.sourceUrl}
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
