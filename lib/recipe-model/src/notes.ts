/**
 * notes.ts — the person's own notes on a recipe ("less salt, double the
 * garlic"). User feedback item 1, Oct 2.
 *
 * ENTRY-LEVEL, NOT IN THE TREE. `recipe` is what the recipe says, corrected
 * in the editor; a note is what THIS person does with it — the same split as
 * `entry.servings` vs `recipe.servings` and `entry.order` vs the step sheet's
 * input order. Kept out of the tree because the tree merges "mine wins" on
 * the whole value and rides the editor's undo stack: a note written on one
 * phone while the other phone fixed a step would lose one of them.
 *
 * STORED AS AN OBJECT (`{ text }`), not a bare string, so a later note per
 * step is a new key in the same column rather than a migration.
 *
 * Not to be confused with `Ingredient.note` ("chopped"), which is part of
 * the recipe the extractor read.
 */

export interface RecipeNotes {
  /** Free text, newlines kept. Never empty: no note is `null`, not `""`. */
  text: string;
}

/** What one person may type into the box. */
export const NOTE_MAX = 2000;
/**
 * What the server will store: twice the typing cap, because a merge of two
 * devices' notes keeps both (mergeNotes) and must never be refused for the
 * length it produced. The box still stops at NOTE_MAX.
 */
export const NOTE_STORED_MAX = NOTE_MAX * 2;

/**
 * The one way text becomes a stored note: trailing whitespace trimmed (a
 * note is free text, so inner newlines and leading indentation stay), blank
 * means no note at all, and over the stored cap is cut there.
 */
export function cleanNotes(text: unknown): RecipeNotes | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "").replace(/^\s*\n/, "");
  if (!t.trim()) return null;
  return { text: t.slice(0, NOTE_STORED_MAX) };
}

/** The server's gate: `null`, or exactly `{ text }` with a non-blank string
 *  within the stored cap. Anything else is refused, not repaired. */
export function isValidNotes(v: unknown): v is RecipeNotes | null {
  if (v === null) return true;
  if (typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (keys.length !== 1 || keys[0] !== "text") return false;
  const text = (v as { text: unknown }).text;
  return typeof text === "string" && text.trim().length > 0 && text.length <= NOTE_STORED_MAX;
}

/** The note's text, or "" — what every reader renders. */
export function notesText(notes: RecipeNotes | null | undefined): string {
  return notes?.text ?? "";
}

/** One line of the note for a strip or a page margin: its lines joined. */
export function notesPreview(notes: RecipeNotes | null | undefined): string {
  return notesText(notes)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" · ");
}

/** Whether a search query appears in the note (case-insensitive). */
export function notesMatch(notes: RecipeNotes | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length > 0 && notesText(notes).toLowerCase().includes(q);
}

/**
 * Both devices changed the note (sync.ts calls this only then). A note is
 * something a person typed, so the merge never throws one away: if one
 * side's text already contains the other's (one device added a line to what
 * the other still had), the longer one is the merge; otherwise both are
 * kept, mine first, and the person tidies the result. One side cleared it
 * and the other edited it: the edit survives, since the clear was of a note
 * that has since been rewritten.
 */
export function mergeNotes(
  mine: RecipeNotes | null | undefined,
  theirs: RecipeNotes | null | undefined
): RecipeNotes | null {
  const m = notesText(mine);
  const t = notesText(theirs);
  if (!m) return cleanNotes(t);
  if (!t) return cleanNotes(m);
  if (m.includes(t)) return cleanNotes(m);
  if (t.includes(m)) return cleanNotes(t);
  return cleanNotes(`${m}\n\n${t}`);
}
