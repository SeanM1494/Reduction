import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_MAX,
  NOTE_STORED_MAX,
  STEP_NOTE_MAX,
  STEP_NOTE_STORED_MAX,
  STEP_NOTES_MAX,
  cleanNotes,
  hasNotes,
  isValidNotes,
  mergeNotes,
  notesMatch,
  notesPreview,
  pruneNotes,
  stepNote,
  stepNotesInOrder,
  withStepNote,
} from "./notes";
import { mergeEntry, type SyncableEntry } from "./sync";
import type { Recipe } from "./layout";

test("typed text becomes a note; blank becomes no note", () => {
  assert.deepEqual(cleanNotes("Less salt.\n\nDouble the garlic.  \n"), { text: "Less salt.\n\nDouble the garlic." });
  assert.deepEqual(cleanNotes("\r\nUse thighs\r\n"), { text: "Use thighs" });
  for (const blank of ["", "   ", "\n\n", null, undefined, 3]) assert.equal(cleanNotes(blank), null, String(blank));
  assert.equal(cleanNotes("x".repeat(NOTE_STORED_MAX + 50))!.text!.length, NOTE_STORED_MAX);
  assert.equal(NOTE_STORED_MAX, NOTE_MAX * 2);
  assert.equal(STEP_NOTE_STORED_MAX, STEP_NOTE_MAX * 2);
});

test("editing the recipe's note keeps the step notes, and the other way round", () => {
  const notes = { text: "Less salt.", steps: { s1: "Cast iron." } };
  assert.deepEqual(cleanNotes("More salt.", notes), { text: "More salt.", steps: { s1: "Cast iron." } });
  assert.deepEqual(cleanNotes("", notes), { steps: { s1: "Cast iron." } });
  assert.deepEqual(withStepNote(notes, "s2", " 8 min a side \n"), { text: "Less salt.", steps: { s1: "Cast iron.", s2: "8 min a side" } });
  assert.deepEqual(withStepNote(notes, "s1", "  "), { text: "Less salt." });
  assert.equal(withStepNote({ steps: { s1: "x" } }, "s1", ""), null);
  assert.equal(withStepNote(null, "s1", "x".repeat(STEP_NOTE_STORED_MAX + 9))!.steps!.s1.length, STEP_NOTE_STORED_MAX);
  assert.equal(stepNote(notes, "s1"), "Cast iron.");
  assert.equal(stepNote(notes, "nope"), "");
  assert.equal(hasNotes({ steps: { s1: "x" } }), true);
  assert.equal(hasNotes({ text: "  " }), false);
});

test("the server's gate takes { text?, steps? } or null, never repaired", () => {
  assert.equal(isValidNotes(null), true);
  assert.equal(isValidNotes({ text: "Less salt" }), true);
  assert.equal(isValidNotes({ text: "x".repeat(NOTE_STORED_MAX) }), true);
  assert.equal(isValidNotes({ text: "x".repeat(NOTE_STORED_MAX + 1) }), false);
  assert.equal(isValidNotes({ text: "   " }), false);
  assert.equal(isValidNotes({ text: 5 }), false);
  assert.equal(isValidNotes({ text: "a", steps: {} }), false);
  assert.equal(isValidNotes({}), false);
  assert.equal(isValidNotes({ text: "a", other: 1 }), false);
  assert.equal(isValidNotes({ steps: { s1: "Cast iron." } }), true);
  assert.equal(isValidNotes({ text: "a", steps: { s1: "b" } }), true);
  assert.equal(isValidNotes({ steps: { s1: "" } }), false);
  assert.equal(isValidNotes({ steps: { s1: 4 } }), false);
  assert.equal(isValidNotes({ steps: ["a"] }), false);
  assert.equal(isValidNotes({ steps: { s1: "x".repeat(STEP_NOTE_STORED_MAX) } }), true);
  assert.equal(isValidNotes({ steps: { s1: "x".repeat(STEP_NOTE_STORED_MAX + 1) } }), false);
  assert.equal(isValidNotes({ steps: { ["k".repeat(101)]: "x" } }), false);
  const many = Object.fromEntries(Array.from({ length: STEP_NOTES_MAX + 1 }, (_, i) => [`s${i}`, "x"]));
  assert.equal(isValidNotes({ steps: many }), false);
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
  // Step notes: in the preview when there is no recipe note, and in search.
  assert.equal(notesPreview({ steps: { s1: "Cast iron.", s2: "8 min" } }), "Cast iron. · 8 min");
  assert.equal(notesPreview({ text: "Less salt.", steps: { s1: "Cast iron." } }), "Less salt.");
  assert.equal(notesMatch({ text: "Less salt.", steps: { s1: "Cast IRON" } }, "iron"), true);
});

test("two devices' notes with no base: nothing typed is lost", () => {
  const m = (a: Parameters<typeof mergeNotes>[1], b: Parameters<typeof mergeNotes>[2]) => mergeNotes(undefined, a, b);
  // One added a line to what the other still has: the longer one.
  assert.deepEqual(m({ text: "Less salt.\nUse thighs." }, { text: "Less salt." }), { text: "Less salt.\nUse thighs." });
  assert.deepEqual(m({ text: "Less salt." }, { text: "Less salt.\nUse thighs." }), { text: "Less salt.\nUse thighs." });
  // Two different rewrites: both, mine first.
  assert.deepEqual(m({ text: "Mine" }, { text: "Theirs" }), { text: "Mine\n\nTheirs" });
  // A clear against an edit: the edit.
  assert.deepEqual(m(null, { text: "Theirs" }), { text: "Theirs" });
  assert.deepEqual(m({ text: "Mine" }, null), { text: "Mine" });
  assert.equal(m(null, null), null);
  // Two full boxes still merge into something the server will store.
  assert.equal(isValidNotes(m({ text: "a".repeat(NOTE_MAX) }, { text: "b".repeat(NOTE_MAX) })), true);
  assert.equal(isValidNotes(m({ steps: { s1: "a".repeat(STEP_NOTE_MAX) } }, { steps: { s1: "b".repeat(STEP_NOTE_MAX) } })), true);
});

test("two devices' notes against a base: each text on its own", () => {
  const base = { text: "Less salt.", steps: { s1: "Cast iron." } };
  // A step note added here, the recipe note edited there: both stand.
  assert.deepEqual(
    mergeNotes(base, { text: "Less salt.", steps: { s1: "Cast iron.", s2: "8 min" } }, { text: "No salt.", steps: { s1: "Cast iron." } }),
    { text: "No salt.", steps: { s1: "Cast iron.", s2: "8 min" } }
  );
  // One side cleared a step note the other left alone: cleared.
  assert.deepEqual(mergeNotes(base, { text: "Less salt." }, base), { text: "Less salt." });
  // Both rewrote the same step note: both kept.
  assert.deepEqual(
    mergeNotes(base, { steps: { s1: "Mine" }, text: "Less salt." }, { steps: { s1: "Theirs" }, text: "Less salt." }),
    { text: "Less salt.", steps: { s1: "Mine\n\nTheirs" } }
  );
  // A null base is a base of nothing: an addition on one side is just that.
  assert.deepEqual(mergeNotes(null, { steps: { s1: "a" } }, { text: "b" }), { text: "b", steps: { s1: "a" } });
});

const recipe: Recipe = {
  title: "Toast",
  servings: 1,
  sections: [
    {
      name: "Toast",
      ingredients: [{ id: "i1", name: "bread", qty: 1, unit: null }],
      nodes: [
        { id: "s1", label: "toast", inputs: ["i1"] },
        { id: "s2", label: "butter", inputs: ["s1"] },
      ],
      root: "s2",
    },
  ],
} as unknown as Recipe;

test("a step note whose step is gone moves into the recipe's note", () => {
  const notes = { text: "Less salt.", steps: { s1: "Dark.", s2: "Salted." } };
  // Nothing gone: the same object back.
  assert.equal(pruneNotes(notes, recipe, recipe), notes);
  const without = {
    ...recipe,
    sections: [{ ...recipe.sections[0], nodes: [{ id: "s1", label: "toast", inputs: ["i1"] }], root: "s1" }],
  } as unknown as Recipe;
  assert.deepEqual(pruneNotes(notes, without, recipe), { text: "Less salt.\nButter: Salted.", steps: { s1: "Dark." } });
  // No old tree to name it from.
  assert.deepEqual(pruneNotes({ steps: { s2: "Salted." } }, without), { text: "A removed step: Salted." });
  assert.equal(pruneNotes(null, without), null);
  assert.deepEqual(stepNotesInOrder({ steps: { s2: "Salted.", s1: "Dark.", gone: "x" } }, recipe), [
    { stepId: "s1", label: "toast", text: "Dark." },
    { stepId: "s2", label: "butter", text: "Salted." },
  ]);
});

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
  // A step note on one phone, the recipe note rewritten on the other.
  assert.deepEqual(
    mergeEntry(base, entry({ text: "Less salt.", steps: { s1: "Dark." } }), entry({ text: "No salt." })).merged.notes,
    { text: "No salt.", steps: { s1: "Dark." } }
  );
});
