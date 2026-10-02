import { useState } from "react";
import { NOTE_MAX, cleanNotes, notesText, type RecipeNotes as Notes } from "../shared/notes";

/**
 * The person's own notes on a saved recipe — "less salt, double the garlic"
 * (user feedback item 1, Oct 2). The phone's NotesSheet in a web shape: the
 * note in a card under the recipe, Edit opens a box in place, Save writes
 * it. Entry-level, never the tree (recipe-model notes.ts says why); a box
 * emptied out clears the note rather than storing "".
 *
 * In flow below the recipe, never above it: nothing here moves a cell under
 * a fingertip, and the recipe screen's headroom stays the diagram's.
 */
export default function RecipeNotes({
  notes,
  onSave,
}: {
  notes: Notes | null;
  onSave: (next: Notes | null) => void;
}) {
  const text = notesText(notes);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    const save = () => {
      const next = cleanNotes(draft);
      if (notesText(next) !== text) onSave(next);
      setDraft(null);
    };
    return (
      <section className="rd-notes no-print" aria-label="Your notes">
        <label className="rd-notes-head" htmlFor="rd-notes-input">
          Notes
        </label>
        <textarea
          id="rd-notes-input"
          className="rd-field-input rd-notes-input"
          value={draft}
          maxLength={NOTE_MAX}
          rows={5}
          autoFocus
          placeholder="Your changes and reminders: less salt, a swap, how long it really took…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="rd-notes-actions">
          <span className="rd-notes-meta">
            Only you see your notes.
            {draft.length > NOTE_MAX * 0.8 ? ` ${draft.length} / ${NOTE_MAX}` : ""}
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

  return (
    <section className="rd-notes" aria-label="Your notes">
      <div className="rd-notes-row">
        <span className="rd-notes-head">{text ? "Your notes" : "Add a note"}</span>
        <button className="rd-btn rd-notes-btn no-print" onClick={() => setDraft(text)}>
          {text ? "Edit" : "Add"}
        </button>
      </div>
      {text ? (
        <p className="rd-notes-text">{text}</p>
      ) : (
        <p className="rd-notes-empty">Your own changes and reminders. Only you see them.</p>
      )}
    </section>
  );
}
