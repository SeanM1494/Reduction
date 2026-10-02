import { useId, useState } from "react";
import type { Recipe } from "../shared/layout";
import {
  NOTE_MAX,
  STEP_NOTE_MAX,
  cleanNoteText,
  cleanNotes,
  notesText,
  stepNotesInOrder,
  withStepNote,
  type RecipeNotes as Notes,
} from "../shared/notes";

/**
 * The person's own notes on a saved recipe — "less salt, double the garlic"
 * (user feedback item 1, Oct 2) — and on its steps ("cast iron, 4 min a
 * side", the same evening). The phone's NotesSheet in a web shape: a note
 * in a card, Edit opens a box in place, Save writes it. Entry-level, never
 * the tree (recipe-model notes.ts says why); a box emptied out clears the
 * note rather than storing "", and saving one note keeps all the others.
 *
 * In flow below the recipe, never above it: nothing here moves a cell under
 * a fingertip, and the recipe screen's headroom stays the diagram's.
 */
export default function RecipeNotes({
  recipe,
  notes,
  onSave,
}: {
  recipe: Recipe;
  notes: Notes | null;
  onSave: (next: Notes | null) => void;
}) {
  return (
    <>
      <NoteBox
        head="Your notes"
        emptyHead="Add a note"
        emptyText="Your own changes and reminders. Only you see them."
        label="Notes"
        value={notesText(notes)}
        maxLength={NOTE_MAX}
        placeholder="Your changes and reminders: less salt, a swap, how long it really took…"
        onSave={(text) => onSave(cleanNotes(text, notes))}
      />
      {stepNotesInOrder(notes, recipe).map(({ stepId, label, text }) => (
        <NoteBox
          key={stepId}
          head={`On the step “${label}”`}
          label={`Note on “${label}”`}
          value={text}
          maxLength={STEP_NOTE_MAX}
          placeholder="For this step: which pan, how long it really took, what you'd change…"
          onSave={(t) => onSave(withStepNote(notes, stepId, t))}
        />
      ))}
    </>
  );
}

/**
 * One note: shown with Edit, or, empty, an invitation (or, with no
 * `emptyHead`, a single "Add a note" button — a step card's quiet form).
 */
export function NoteBox({
  head,
  emptyHead,
  emptyText,
  label,
  value,
  maxLength,
  placeholder,
  onSave,
  className = "",
}: {
  head: string;
  emptyHead?: string;
  emptyText?: string;
  /** The box's label while editing. */
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  /** Called on Save, only when the cleaned text differs from `value`. */
  onSave: (text: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();

  if (draft !== null) {
    const save = () => {
      if (cleanNoteText(draft) !== cleanNoteText(value)) onSave(draft);
      setDraft(null);
    };
    return (
      <section className={`rd-notes no-print ${className}`} aria-label={label}>
        <label className="rd-notes-head" htmlFor={inputId}>
          {label}
        </label>
        <textarea
          id={inputId}
          className="rd-field-input rd-notes-input"
          value={draft}
          maxLength={maxLength}
          rows={maxLength > STEP_NOTE_MAX ? 5 : 3}
          autoFocus
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="rd-notes-actions">
          <span className="rd-notes-meta">
            Only you see your notes.
            {draft.length > maxLength * 0.8 ? ` ${draft.length} / ${maxLength}` : ""}
          </span>
          <button className="rd-btn rd-notes-btn" onClick={() => setDraft(null)}>
            Cancel
          </button>
          <button className="rd-go" onClick={save}>
            Save
          </button>
        </div>
      </section>
    );
  }

  if (!value && !emptyHead) {
    return (
      <button className={`rd-notes-add no-print ${className}`} onClick={() => setDraft("")}>
        + Add a note to this step
      </button>
    );
  }

  return (
    <section className={`rd-notes ${value ? "has-note" : ""} ${className}`} aria-label={head}>
      <div className="rd-notes-row">
        <span className="rd-notes-head">{value ? head : emptyHead}</span>
        <button className="rd-btn rd-notes-btn no-print" onClick={() => setDraft(value)}>
          {value ? "Edit" : "Add"}
        </button>
      </div>
      {value ? <p className="rd-notes-text">{value}</p> : <p className="rd-notes-empty">{emptyText}</p>}
    </section>
  );
}
