/**
 * notes.ts — the person's own notes on a recipe ("less salt, double the
 * garlic") and on any one of its steps ("cast iron, 8 min a side"). User
 * feedback item 1, Oct 2; notes on a step the same evening.
 *
 * ENTRY-LEVEL, NOT IN THE TREE. `recipe` is what the recipe says, corrected
 * in the editor; a note is what THIS person does with it — the same split as
 * `entry.servings` vs `recipe.servings` and `entry.order` vs the step sheet's
 * input order. Kept out of the tree because the tree merges "mine wins" on
 * the whole value and rides the editor's undo stack: a note written on one
 * phone while the other phone fixed a step would lose one of them.
 *
 * A step's note is keyed by the step's id, which `validateRecipe` keeps
 * unique across the whole recipe. An edit can delete a step (or merge it
 * into another); its note is then NOT dropped — `pruneNotes` moves it into
 * the recipe's note under the step's old label, because a note is something
 * a person typed and nothing here throws one away.
 *
 * Not to be confused with `Ingredient.note` ("chopped"), which is part of
 * the recipe the extractor read.
 */

import type { Recipe } from "./layout";

export interface RecipeNotes {
  /** The note on the whole recipe. Absent, never "". */
  text?: string;
  /** Notes on single steps, by step id. Absent when there are none. */
  steps?: Record<string, string>;
}

/** What one person may type into the recipe's box. */
export const NOTE_MAX = 2000;
/** What one person may type into a step's box: a line or two on a card. */
export const STEP_NOTE_MAX = 280;
/**
 * What the server will store: twice the typing caps, because a merge of two
 * devices' notes keeps both (mergeNotes) and must never be refused for the
 * length it produced. The boxes still stop at the typing caps.
 */
export const NOTE_STORED_MAX = NOTE_MAX * 2;
export const STEP_NOTE_STORED_MAX = STEP_NOTE_MAX * 2;
/** More step notes than any recipe has steps; only a bound on the request. */
export const STEP_NOTES_MAX = 300;

/**
 * Typed text as it is stored: line endings unified, whitespace at either end
 * dropped (inner newlines and indentation stay), "" when
 * nothing is left, and cut at `max`.
 */
export function cleanNoteText(text: unknown, max = NOTE_STORED_MAX): string {
  if (typeof text !== "string") return "";
  const t = text.replace(/\r\n?/g, "\n").trim();
  return t.trim() ? t.slice(0, max) : "";
}

/** The one shape every writer produces: blanks dropped, null when empty. */
export function normalizeNotes(notes: RecipeNotes | null | undefined): RecipeNotes | null {
  if (!notes) return null;
  const out: RecipeNotes = {};
  const text = cleanNoteText(notes.text);
  if (text) out.text = text;
  const steps: Record<string, string> = {};
  for (const [id, raw] of Object.entries(notes.steps ?? {})) {
    const t = cleanNoteText(raw, STEP_NOTE_STORED_MAX);
    if (t) steps[id] = t;
  }
  if (Object.keys(steps).length) out.steps = steps;
  return out.text || out.steps ? out : null;
}

/** A note on the whole recipe from typed text, keeping the step notes. */
export const cleanNotes = (text: unknown, notes: RecipeNotes | null = null): RecipeNotes | null =>
  normalizeNotes({ ...(notes ?? {}), text: cleanNoteText(text) });

/** The notes with one step's note set (or cleared, for blank text). */
export function withStepNote(notes: RecipeNotes | null | undefined, stepId: string, text: unknown): RecipeNotes | null {
  const steps = { ...(notes?.steps ?? {}) };
  const t = cleanNoteText(text, STEP_NOTE_STORED_MAX);
  if (t) steps[stepId] = t;
  else delete steps[stepId];
  return normalizeNotes({ ...(notes ?? {}), steps });
}

/** The server's gate: null, or `{ text?, steps? }` with at least one, every
 *  string non-blank and within its stored cap. Refused, never repaired. */
export function isValidNotes(v: unknown): v is RecipeNotes | null {
  if (v === null) return true;
  if (typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "text" && k !== "steps")) return false;
  const okText = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  if (o.text !== undefined && !okText(o.text, NOTE_STORED_MAX)) return false;
  if (o.steps !== undefined) {
    if (typeof o.steps !== "object" || o.steps === null || Array.isArray(o.steps)) return false;
    const entries = Object.entries(o.steps as Record<string, unknown>);
    if (!entries.length || entries.length > STEP_NOTES_MAX) return false;
    if (!entries.every(([k, s]) => k.length > 0 && k.length <= 100 && okText(s, STEP_NOTE_STORED_MAX))) return false;
  }
  return o.text !== undefined || o.steps !== undefined;
}

/** The recipe's note, or "". */
export function notesText(notes: RecipeNotes | null | undefined): string {
  return notes?.text ?? "";
}

/** One step's note, or "". */
export function stepNote(notes: RecipeNotes | null | undefined, stepId: string): string {
  return notes?.steps?.[stepId] ?? "";
}

/** Whether there is any note at all, on the recipe or a step. */
export const hasNotes = (notes: RecipeNotes | null | undefined): boolean => !!normalizeNotes(notes ?? null);

/** Every step's note in cooking-page order (section by section, as the
 *  tree lists them), with its label — for a list under the diagram. */
export function stepNotesInOrder(
  notes: RecipeNotes | null | undefined,
  recipe: Recipe
): Array<{ stepId: string; label: string; text: string }> {
  const out: Array<{ stepId: string; label: string; text: string }> = [];
  if (!notes?.steps) return out;
  for (const section of recipe.sections) {
    for (const step of section.nodes) {
      const text = notes.steps[step.id];
      if (text) out.push({ stepId: step.id, label: step.label, text });
    }
  }
  return out;
}

/** One line for a strip or a page margin: the recipe's note, or, without
 *  one, the step notes, lines joined. */
export function notesPreview(notes: RecipeNotes | null | undefined): string {
  const source = notesText(notes) || Object.values(notes?.steps ?? {}).join("\n");
  return source
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" · ");
}

/** Whether a search query appears in any note (case-insensitive). */
export function notesMatch(notes: RecipeNotes | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q || !notes) return false;
  return [notesText(notes), ...Object.values(notes.steps ?? {})].some((t) => t.toLowerCase().includes(q));
}

/**
 * Two typed texts that both changed: if one already contains the other (one
 * device added a line to what the other still had), the longer; otherwise
 * both, mine first. One side cleared and the other edited: the edit, since
 * the clear was of a note that has since been rewritten.
 */
function mergeText(m: string, t: string): string {
  if (!m) return t;
  if (!t) return m;
  if (m.includes(t)) return m;
  if (t.includes(m)) return t;
  return `${m}\n\n${t}`;
}

/** Three-way on one text: changed by one side → that side; by both → both. */
function merge3(b: string, m: string, t: string): string {
  if (m === t) return m;
  if (m === b) return t;
  if (t === b) return m;
  return mergeText(m, t);
}

/**
 * Both devices changed the notes (sync.ts calls this only then). Each text
 * — the recipe's and each step's — merges on its own, against the base
 * when there is one: a step note added on the phone and the recipe note
 * edited on the laptop both survive, and a note both rewrote keeps both.
 * Nothing typed is lost.
 */
export function mergeNotes(
  base: RecipeNotes | null | undefined,
  mine: RecipeNotes | null | undefined,
  theirs: RecipeNotes | null | undefined
): RecipeNotes | null {
  // Without a base every text counts as changed on both sides.
  const b = (get: (n: RecipeNotes | null | undefined) => string, m: string, t: string) =>
    base === undefined ? mergeText(m, t) : merge3(get(base), m, t);
  const text = b(notesText, notesText(mine), notesText(theirs));
  const ids = new Set([...Object.keys(mine?.steps ?? {}), ...Object.keys(theirs?.steps ?? {}), ...Object.keys(base?.steps ?? {})]);
  const steps: Record<string, string> = {};
  for (const id of ids) {
    const t = b((n) => stepNote(n, id), stepNote(mine, id), stepNote(theirs, id));
    if (t) steps[id] = t;
  }
  return normalizeNotes({ text, steps });
}

/**
 * Step notes whose step no longer exists in `tree` (an edit deleted or
 * merged it) move into the recipe's note as "Old label: the note", so the
 * words survive the edit. `before` is the tree the notes were written
 * against, for the old label; without it, or without the step in it, the
 * line reads "A removed step: …". Returns the same object when nothing moved.
 */
export function pruneNotes(
  notes: RecipeNotes | null | undefined,
  tree: Recipe,
  before: Recipe | null = null
): RecipeNotes | null {
  if (!notes?.steps) return notes ?? null;
  const live = new Set(tree.sections.flatMap((s) => s.nodes.map((n) => n.id)));
  const orphans = Object.keys(notes.steps).filter((id) => !live.has(id));
  if (!orphans.length) return notes;
  const labels = new Map((before?.sections ?? []).flatMap((s) => s.nodes.map((n) => [n.id, n.label] as const)));
  const steps = { ...notes.steps };
  const moved: string[] = [];
  for (const id of orphans) {
    const label = labels.get(id);
    moved.push(`${label ? label.charAt(0).toUpperCase() + label.slice(1) : "A removed step"}: ${steps[id]}`);
    delete steps[id];
  }
  const text = [notesText(notes), ...moved].filter(Boolean).join("\n");
  return normalizeNotes({ text, steps });
}
