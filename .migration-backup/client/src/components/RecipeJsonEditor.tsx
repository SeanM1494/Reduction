/**
 * client/src/components/RecipeJsonEditor.tsx — the stopgap repair tool.
 *
 * Every extraction is a model's interpretation, and some fraction is wrong.
 * Without any way to fix one, a bad parse means the recipe is useless and the
 * user starts over; with one, it is an annoyance. This is the cheap version
 * of that (ROADMAP #6) — the raw tree in a textarea — standing in until the
 * real structured editor exists. It is not meant to be pretty. It is meant to
 * mean nobody has to abandon a recipe.
 *
 * Deliberately plain: no editor library, no syntax highlighting, no new
 * dependency. A textarea and validateRecipe do the job.
 *
 * Validation runs against the same validateRecipe the server gates on, and
 * its messages are shown exactly as written — they were composed to be read
 * by a person ("section \"Sauce\": step \"reduce\" has no inputs."), and
 * rewrapping them would only make them worse.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { validateRecipe, type Recipe } from "../../../shared/layout";
import { reconcileDone } from "../../../shared/progress";

interface Props {
  recipe: Recipe;
  done: string[];
  onCancel: () => void;
  onSave: (recipe: Recipe, done: string[]) => void;
}

/** Long enough not to fight someone mid-keystroke, short enough that the
 *  errors feel attached to what they just typed. */
const DEBOUNCE_MS = 300;

interface Checked {
  parsed: Recipe | null;
  /** JSON syntax failure — reported separately, because "unexpected token"
   *  and "this step has no inputs" are different kinds of problem. */
  syntaxError: string | null;
  errors: string[];
}

function check(text: string): Checked {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { parsed: null, syntaxError: (e as Error).message, errors: [] };
  }
  const errors = validateRecipe(parsed);
  return {
    parsed: errors.length ? null : (parsed as Recipe),
    syntaxError: null,
    errors,
  };
}

export default function RecipeJsonEditor({ recipe, done, onCancel, onSave }: Props) {
  const initial = useMemo(() => JSON.stringify(recipe, null, 2), [recipe]);
  const [text, setText] = useState(initial);
  const [checked, setChecked] = useState<Checked>(() => check(initial));
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Debounced so validation follows typing rather than interrupting it.
  useEffect(() => {
    const t = window.setTimeout(() => setChecked(check(text)), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [text]);

  const dirty = text !== initial;
  const valid = !checked.syntaxError && checked.errors.length === 0 && !!checked.parsed;

  /**
   * What this edit would cost in progress. Editing can delete the very ids
   * `done` is a list of, and being told that before saving is the difference
   * between a considered change and a nasty surprise. The server recomputes
   * this itself — see shared/progress.ts — so this is a warning, not the
   * mechanism.
   */
  const dropped = useMemo(
    () => (checked.parsed ? reconcileDone(checked.parsed, done).dropped : []),
    [checked.parsed, done]
  );

  return (
    <div className="rd-json">
      <div className="rd-json-head">
        <div>
          <h2 className="rd-json-title">Edit recipe data</h2>
          <p className="rd-json-sub">
            The raw tree. Fix what the extraction got wrong &mdash; a label, an
            amount, which step an ingredient feeds &mdash; and save.
          </p>
        </div>
        <div className="rd-json-actions">
          <button className="rd-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rd-go"
            disabled={!valid || !dirty}
            title={
              !dirty
                ? "Nothing has changed yet"
                : valid
                  ? "Save this recipe"
                  : "Fix the problems below first"
            }
            onClick={() => {
              if (!valid || !checked.parsed) return;
              onSave(checked.parsed, reconcileDone(checked.parsed, done).done);
            }}
          >
            Save
          </button>
        </div>
      </div>

      <textarea
        ref={areaRef}
        className={`rd-json-area ${valid ? "" : "is-invalid"}`}
        value={text}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Recipe JSON"
        aria-invalid={!valid}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="rd-json-status" role="status" aria-live="polite">
        {checked.syntaxError ? (
          <div className="rd-error">
            <strong>That isn&rsquo;t valid JSON.</strong>
            <br />
            {checked.syntaxError}
          </div>
        ) : checked.errors.length ? (
          <div className="rd-error">
            <strong>
              {checked.errors.length === 1
                ? "One problem to fix:"
                : `${checked.errors.length} problems to fix:`}
            </strong>
            <ul className="rd-json-errors">
              {checked.errors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rd-json-ok">
            Valid.
            {dropped.length > 0 ? (
              <>
                {" "}
                Saving clears {dropped.length} completed{" "}
                {dropped.length === 1 ? "item" : "items"} that no longer
                {dropped.length === 1 ? " exists" : " exist"} in the recipe.
              </>
            ) : dirty ? (
              " Your progress is unaffected."
            ) : (
              " Nothing changed yet."
            )}
          </p>
        )}
      </div>
    </div>
  );
}
