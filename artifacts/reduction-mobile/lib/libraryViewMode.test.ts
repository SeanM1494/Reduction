import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBoxStyle } from "./libraryViewMode";

test("the recipe box style: books by default, grid only when chosen", () => {
  assert.equal(parseBoxStyle("books"), "books");
  assert.equal(parseBoxStyle("grid"), "grid");
  assert.equal(parseBoxStyle(null), "books", "books is the default");
  assert.equal(parseBoxStyle("shelves"), "books", "a style that does not exist falls back to the default");
  // Carried over from the old in-library toggle, which stored only a tap.
  assert.equal(parseBoxStyle(null, "grid"), "grid", "a grid chosen with the old toggle is kept");
  assert.equal(parseBoxStyle(null, "stack"), "books", "the books replaced the stack");
  assert.equal(parseBoxStyle("books", "grid"), "books", "the Settings key wins over the old one");
});
