import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOK_COLORS,
  BOOK_NAME_MAX,
  BookEditError,
  DEFAULT_BOOKS,
  MAX_BOOKS,
  OTHER_BOOK_ID,
  addBook,
  bookLimitMessage,
  bookNameProblem,
  cleanBookName,
  defaultBookIdFor,
  deleteBook,
  freshDefaultBooks,
  isDefaultBook,
  liveBooks,
  mergeBooks,
  moveBook,
  nextBookColor,
  recolorBook,
  renameBook,
  repairBooks,
  resolveBookId,
  validateBooks,
  type BookDef,
} from "./books";
import { mergeEntry, type SyncableEntry } from "./sync";

const NOW = 1_700_000_000_000;
const names = (books: readonly BookDef[]) => liveBooks(books).map((b) => b.name);

// ----------------------------------------------------------- colours ----

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test("every book colour keeps the tab's white text readable and shows on both page backgrounds", () => {
  assert.equal(BOOK_COLORS.length, 12);
  assert.equal(new Set(BOOK_COLORS.map((c) => c.hex.toLowerCase())).size, 12, "no colour twice");
  for (const c of BOOK_COLORS) {
    assert.ok(contrast(c.hex, "#ffffff") >= 4.5, `${c.name} ${c.hex}: white text ${contrast(c.hex, "#ffffff").toFixed(2)}:1`);
    assert.ok(contrast(c.hex, "#e8d5b2") >= 3, `${c.name} on the light page ${contrast(c.hex, "#e8d5b2").toFixed(2)}:1`);
    assert.ok(contrast(c.hex, "#131110") >= 2.5, `${c.name} on the dark page ${contrast(c.hex, "#131110").toFixed(2)}:1`);
  }
});

test("the defaults are today's seven, in today's order and colours, all in the set", () => {
  assert.deepEqual(
    DEFAULT_BOOKS.map((b) => [b.id, b.name, b.color]),
    [
      ["breakfast", "Breakfast", "#986d29"],
      ["lunch", "Lunch", "#657c51"],
      ["dinner", "Dinner", "#a94f3a"],
      ["apps", "Apps & Snacks", "#477d7b"],
      ["salads", "Salads", "#5a7f43"],
      ["desserts", "Desserts", "#8e4f6f"],
      ["other", "Other", "#6a6575"],
    ]
  );
  assert.deepEqual(validateBooks(freshDefaultBooks()), []);
  assert.equal(isDefaultBook("dinner"), true);
  assert.equal(isDefaultBook("b-123"), false);
  assert.equal(defaultBookIdFor(["snack", "side"]), "apps");
  assert.equal(defaultBookIdFor(["baking"]), OTHER_BOOK_ID);
  assert.equal(defaultBookIdFor([]), OTHER_BOOK_ID);
});

test("a new book takes the next colour nobody is using", () => {
  const books = freshDefaultBooks();
  assert.equal(nextBookColor(books), "#7a4e36", "the first after the seven defaults");
  const recoloured = recolorBook(books, "dinner", "#7a4e36");
  assert.equal(nextBookColor(recoloured), "#a94f3a", "Dinner's old colour is free again");
});

// ------------------------------------------------------------- names ----

test("names: trimmed, 1 to 30 characters, unique ignoring case", () => {
  const books = freshDefaultBooks();
  assert.equal(cleanBookName("  Weeknight   dinners "), "Weeknight dinners");
  assert.equal(cleanBookName("x".repeat(40)).length, BOOK_NAME_MAX);
  assert.equal(bookNameProblem(books, "   "), "Give the book a name.");
  assert.equal(bookNameProblem(books, "dinner"), "You already have a book called Dinner.");
  assert.equal(bookNameProblem(books, "DINNER", "dinner"), null, "renaming a book to its own name in new case");
  assert.equal(bookNameProblem(books, "Soups"), null);
  const renamed = renameBook(books, "dinner", "  Mains ");
  assert.deepEqual(names(renamed).slice(0, 3), ["Breakfast", "Lunch", "Mains"]);
  assert.equal(bookNameProblem(renamed, "Dinner"), null, "a name is free once its book is renamed");
});

// ------------------------------------------------------------- edits ----

test("add, reorder, recolour; the cap of 12 blocks adding and says why", () => {
  let books = freshDefaultBooks();
  books = addBook(books, { id: "soups", name: "Soups", now: NOW });
  assert.deepEqual(names(books).at(-1), "Soups");
  books = moveBook(books, "soups", -1);
  assert.deepEqual(names(books).slice(-2), ["Soups", "Other"]);
  books = moveBook(books, "breakfast", -1);
  assert.equal(names(books)[0], "Breakfast", "already first: nothing moves");
  for (let i = 0; liveBooks(books).length < MAX_BOOKS; i++) books = addBook(books, { id: `b${i}`, name: `Book ${i}`, now: NOW + i });
  assert.equal(liveBooks(books).length, 12);
  assert.throws(() => addBook(books, { id: "b99", name: "One too many", now: NOW }), (e: Error) => e instanceof BookEditError && e.message === bookLimitMessage);
  assert.throws(() => recolorBook(books, "soups", "#123456"), BookEditError, "only colours from the set");
});

test("Other can be renamed and recoloured, never deleted", () => {
  let books = freshDefaultBooks();
  books = renameBook(books, OTHER_BOOK_ID, "Everything else");
  books = recolorBook(books, OTHER_BOOK_ID, "#6f4a6e");
  assert.equal(liveBooks(books).at(-1)!.name, "Everything else");
  assert.throws(() => deleteBook(books, OTHER_BOOK_ID, { into: "dinner", now: NOW }), BookEditError);
});

test("delete = merge: the book goes, its recipes follow, and the survivor can take any name — even the gone one's", () => {
  let books = addBook(freshDefaultBooks(), { id: "mains", name: "Mains", now: NOW });
  books = deleteBook(books, "dinner", { into: "mains", rename: "Dinner", now: NOW });
  assert.ok(!names(books).includes("Mains"));
  assert.equal(liveBooks(books).find((b) => b.id === "mains")!.name, "Dinner");
  assert.equal(resolveBookId(books, "dinner"), "mains", "a recipe placed in the old Dinner is in the survivor");
  assert.equal(resolveBookId(books, null, ["dinner"]), "mains", "so is one that never had a placement");
  assert.throws(() => deleteBook(books, "lunch", { into: "lunch", now: NOW }), BookEditError);
  assert.throws(() => deleteBook(books, "lunch", { into: "dinner", now: NOW }), BookEditError, "not into a deleted book");
  assert.deepEqual(validateBooks(books), []);
});

// -------------------------------------------------------- resolution ----

test("every recipe resolves to a live book: through merges, to Other when the chain ends nowhere, loops or is unknown", () => {
  let books = addBook(freshDefaultBooks(), { id: "a", name: "A", now: NOW });
  books = addBook(books, { id: "b", name: "B", now: NOW });
  books = deleteBook(books, "a", { into: "b", now: NOW });
  books = deleteBook(books, "b", { into: "lunch", now: NOW });
  assert.equal(resolveBookId(books, "a"), "lunch", "a → b → lunch");
  // Deleted while empty: nowhere to go. A removed recipe restored later lands in Other.
  books = deleteBook(books, "salads", { into: null, now: NOW });
  assert.equal(resolveBookId(books, "salads"), OTHER_BOOK_ID);
  assert.equal(resolveBookId(books, null, ["salad"]), OTHER_BOOK_ID);
  assert.equal(resolveBookId(books, "no-such-book"), OTHER_BOOK_ID);
  // A loop can only come from two devices at once (tested below); resolution survives it anyway.
  const loop: BookDef[] = [...books, { id: "x", name: "X", color: "#7a4e36", position: 9, deletedAt: NOW, mergedInto: "y" }, { id: "y", name: "Y", color: "#9b3d52", position: 10, deletedAt: NOW, mergedInto: "x" }];
  assert.equal(resolveBookId(loop, "x"), OTHER_BOOK_ID);
});

// ------------------------------------------------ two devices at once ---

const base = () => addBook(addBook(freshDefaultBooks(), { id: "soups", name: "Soups", now: NOW }), { id: "mains", name: "Mains", now: NOW });

test("merge: one side's edits and additions both survive; both edited the same field → mine (the later write)", () => {
  const o = base();
  const mine = addBook(renameBook(o, "soups", "Soups & stews"), { id: "m1", name: "Bread", now: NOW + 1 });
  const theirs = addBook(recolorBook(renameBook(o, "soups", "Broths"), "soups", "#6f4a6e"), { id: "t1", name: "Drinks", now: NOW + 2 });
  const merged = mergeBooks(o, mine, theirs);
  const soups = merged.find((b) => b.id === "soups")!;
  assert.equal(soups.name, "Soups & stews", "both renamed: mine");
  assert.equal(soups.color, "#6f4a6e", "only theirs recoloured: theirs");
  assert.ok(names(merged).includes("Bread") && names(merged).includes("Drinks"), "both additions kept");
  assert.deepEqual(validateBooks(merged), []);
});

test("merge: a deletion beats an edit, and the recipes still follow", () => {
  const o = base();
  const mine = renameBook(o, "soups", "Soups & stews");
  const theirs = deleteBook(o, "soups", { into: "mains", now: NOW });
  for (const merged of [mergeBooks(o, mine, theirs), mergeBooks(o, theirs, mine)]) {
    assert.ok(!names(merged).includes("Soups & stews"));
    assert.equal(resolveBookId(merged, "soups"), "mains");
  }
});

test("merge: a recipe added to a book the other device deleted lands where that book's recipes went", () => {
  const o = base();
  // Device A deletes Soups into Mains; device B, not knowing, saves a recipe
  // into Soups. The placement names Soups; the merged list sends it on.
  const books = mergeBooks(o, deleteBook(o, "soups", { into: "mains", now: NOW }), o);
  assert.equal(resolveBookId(books, "soups"), "mains");
});

test("merge: both deleted the same book into different books — the later write decides, nothing lost", () => {
  const o = base();
  const mine = deleteBook(o, "soups", { into: "mains", now: NOW + 2 });
  const theirs = deleteBook(o, "soups", { into: "lunch", now: NOW + 1 });
  const merged = mergeBooks(o, mine, theirs);
  assert.equal(resolveBookId(merged, "soups"), "mains");
  assert.ok(liveBooks(merged).some((b) => b.id === "mains"));
});

test("merge: X into Y on one device, Y into X on the other — a loop, and everything lands in Other", () => {
  const o = base();
  const mine = deleteBook(o, "soups", { into: "mains", now: NOW });
  const theirs = deleteBook(o, "mains", { into: "soups", now: NOW });
  const merged = mergeBooks(o, mine, theirs);
  assert.equal(resolveBookId(merged, "soups"), OTHER_BOOK_ID);
  assert.equal(resolveBookId(merged, "mains"), OTHER_BOOK_ID);
  assert.deepEqual(validateBooks(merged), [], "a loop is storable; resolution handles it");
});

test("merge: a deletion that made a new book on the spot keeps both halves", () => {
  const o = base();
  const mine = deleteBook(addBook(o, { id: "new", name: "Weeknight", now: NOW }), "soups", { into: "new", now: NOW });
  const merged = mergeBooks(o, mine, renameBook(o, "mains", "Big plates"));
  assert.equal(resolveBookId(merged, "soups"), "new");
  assert.ok(names(merged).includes("Weeknight") && names(merged).includes("Big plates"));
});

test("merge repairs: two devices naming books alike get distinct names; Other always comes back; the cap drops nothing", () => {
  const o = base();
  const mine = addBook(o, { id: "m", name: "Bread", now: NOW + 1 });
  const theirs = addBook(o, { id: "t", name: "bread", now: NOW + 2 });
  const merged = mergeBooks(o, mine, theirs);
  assert.deepEqual(names(merged).filter((n) => /bread/i.test(n)).sort(), ["Bread", "bread 2"].sort());
  // A list that somehow lost Other gets it back.
  const repaired = repairBooks(o.filter((b) => b.id !== OTHER_BOOK_ID));
  assert.ok(liveBooks(repaired).some((b) => b.id === OTHER_BOOK_ID));
  // Eleven each side, five new on each: twelve plus, and every book kept.
  let a = o;
  let b = o;
  for (let i = 0; i < 3; i++) {
    a = addBook(a, { id: `a${i}`, name: `A${i}`, now: NOW });
    b = addBook(b, { id: `b${i}`, name: `B${i}`, now: NOW });
  }
  const big = mergeBooks(o, a, b);
  assert.equal(liveBooks(big).length, 15);
  assert.deepEqual(validateBooks(big), []);
});

// ------------------------------------------------------- validation -----

test("the server refuses a list without Other, with clashing names, stray colours or dangling destinations", () => {
  const ok = base();
  assert.deepEqual(validateBooks(ok), []);
  assert.ok(validateBooks(ok.filter((b) => b.id !== OTHER_BOOK_ID)).length);
  assert.ok(validateBooks(ok.map((b) => (b.id === "soups" ? { ...b, name: "dinner" } : b))).length);
  assert.ok(validateBooks(ok.map((b) => (b.id === "soups" ? { ...b, color: "#000000" } : b))).length);
  assert.ok(validateBooks(ok.map((b) => (b.id === "soups" ? { ...b, deletedAt: NOW, mergedInto: "gone" } : b))).length);
  assert.ok(validateBooks(ok.map((b) => (b.id === "soups" ? { ...b, name: "  padded " } : b))).length);
  assert.ok(validateBooks("nope").length);
  assert.ok(validateBooks([...ok, ok[0]]).length, "an id twice");
});

// ------------------------------------------- the recipe's own book field --

const entry = (book: string | null): SyncableEntry => ({
  recipe: { title: "Soup", servings: 2, sections: [{ name: "Soup", ingredients: [{ id: "a", qty: 1, unit: null, name: "water" }], nodes: [{ id: "n", label: "boil", inputs: ["a"] }], root: "n" }] },
  done: [],
  servings: null,
  mode: "diagram",
  timer: null,
  book,
});

test("a recipe's book: one device moved it → that move; both did → the later write", () => {
  assert.equal(mergeEntry(entry("dinner"), entry("soups"), entry("dinner")).merged.book, "soups", "only mine moved it");
  assert.equal(mergeEntry(entry("dinner"), entry("dinner"), entry("mains")).merged.book, "mains", "only theirs moved it");
  assert.equal(mergeEntry(entry("dinner"), entry("soups"), entry("mains")).merged.book, "soups", "both: mine, the later write");
  assert.equal(mergeEntry(entry(null), entry(null), entry(null)).merged.book, null, "no placement stays none");
});
