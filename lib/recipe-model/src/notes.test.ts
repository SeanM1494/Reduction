import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_MAX,
  NOTE_STORED_MAX,
  cleanNotes,
  isValidNotes,
  mergeNotes,
  notesMatch,
  notesPreview,
} from "./notes";
import { mergeEntry, type SyncableEntry } from "./sync";
import type { Recipe } from "./layout";

test("typed text becomes a note; blank becomes no note", () => {
  assert.deepEqual(cleanNotes("Less salt.\n\nDouble the garlic.  \n"), { text: "Less salt.\n\nDouble the garlic." });
  assert.deepEqual(cleanNotes("\r\nUse thighs\r\n"), { text: "Use thighs" });
  for (const blank of ["", "   ", "\n\n", null, undefined, 3]) assert.equal(cleanNotes(blank), null, String(blank));
  assert.equal(cleanNotes("x".repeat(NOTE_STORED_MAX + 50))!.text.length, NOTE_STORED_MAX);
  assert.equal(NOTE_STORED_MAX, NOTE_MAX * 2);
});

test("the server's gate takes exactly { text } or null", () => {
  assert.equal(isValidNotes(null), true);
  assert.equal(isValidNotes({ text: "Less salt" }), true);
  assert.equal(isValidNotes({ text: "x".repeat(NOTE_STORED_MAX) }), true);
  assert.equal(isValidNotes({ text: "x".repeat(NOTE_STORED_MAX + 1) }), false);
  assert.equal(isValidNotes({ text: "   " }), false);
  assert.equal(isValidNotes({ text: 5 }), false);
  assert.equal(isValidNotes({ text: "a", steps: {} }), false);
  assert.equal(isValidNotes("Less salt"), false);
  assert.equal(isValidNotes([]), false);
  assert.equal(isValidNotes(undefined), false);
});

test("the preview joins lines, and search matches the note", () => {
  assert.equal(notesPreview({ text: "Less salt.\n\n  Double the garlic. " }), "Less salt. · Double the garlic.");
  assert.equal(notesPreview(null), "");
  assert.equal(notesMatch({ text: "Double the GARLIC" }, " garlic "), true);
  assert.equal(notesMatch({ text: "Double the garlic" }, "salt"), false);
  assert.equal(notesMatch({ text: "anything" }, "  "), false);
  assert.equal(notesMatch(null, "garlic"), false);
});

test("two devices' notes: nothing typed is lost", () => {
  // One added a line to what the other still has: the longer one.
  assert.deepEqual(mergeNotes({ text: "Less salt.\nUse thighs." }, { text: "Less salt." }), { text: "Less salt.\nUse thighs." });
  assert.deepEqual(mergeNotes({ text: "Less salt." }, { text: "Less salt.\nUse thighs." }), { text: "Less salt.\nUse thighs." });
  // Two different rewrites: both, mine first.
  assert.deepEqual(mergeNotes({ text: "Mine" }, { text: "Theirs" }), { text: "Mine\n\nTheirs" });
  // A clear against an edit: the edit.
  assert.deepEqual(mergeNotes(null, { text: "Theirs" }), { text: "Theirs" });
  assert.deepEqual(mergeNotes({ text: "Mine" }, null), { text: "Mine" });
  assert.equal(mergeNotes(null, null), null);
  // Two full boxes still merge into something the server will store.
  const full = mergeNotes({ text: "a".repeat(NOTE_MAX) }, { text: "b".repeat(NOTE_MAX) });
  assert.equal(isValidNotes(full), true);
});

const recipe: Recipe = {
  title: "Toast",
  servings: 1,
  sections: [
    {
      name: "Toast",
      ingredients: [{ id: "i1", name: "bread", qty: 1, unit: null }],
      nodes: [{ id: "s1", label: "toast", inputs: ["i1"] }],
      root: "s1",
    },
  ],
} as unknown as Recipe;

const entry = (notes: SyncableEntry["notes"], rating: number | null = null): SyncableEntry => ({
  recipe,
  done: [],
  servings: null,
  mode: "diagram",
  timer: null,
  rating,
  notes,
});

test("mergeEntry: one side's note wins, both sides' notes are kept", () => {
  const base = entry({ text: "Less salt." });
  // Only theirs changed.
  assert.deepEqual(mergeEntry(base, base, entry({ text: "Less salt. Use thighs." })).merged.notes, { text: "Less salt. Use thighs." });
  // Only mine changed (cleared).
  assert.equal(mergeEntry(base, entry(null), base).merged.notes, null);
  // Neither changed, while something else did: untouched.
  assert.deepEqual(mergeEntry(base, entry({ text: "Less salt." }, 1), base).merged.notes, { text: "Less salt." });
  // Both rewrote it.
  const { merged, treeConflict } = mergeEntry(base, entry({ text: "Mine" }), entry({ text: "Theirs" }));
  assert.deepEqual(merged.notes, { text: "Mine\n\nTheirs" });
  assert.equal(treeConflict, false);
  // A device that has never heard of notes (no key at all) never erases one.
  const old = { ...entry(null) };
  delete old.notes;
  assert.deepEqual(mergeEntry(old, old, entry({ text: "Theirs" })).merged.notes, { text: "Theirs" });
});
