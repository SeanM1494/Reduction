/**
 * server/routes/books.db.test.ts — an account's recipe books and where each
 * recipe sits, against a real Postgres.
 *
 * What is under test: the seven defaults are created ONCE however many
 * devices load at the same moment, and only then are the account's existing
 * recipes (removed ones included) placed by meal type — a recipe already
 * placed keeps its book; the list is a versioned document (a stale write is
 * a 409 carrying the current list, a bad one a 422, Other can never go);
 * a recipe's book rides the library's own save and versioned PATCH, so two
 * devices moving it are an ordinary 409; a removed recipe keeps its book;
 * deleting a recipe takes its placement with it; and nobody else's books or
 * placements are reachable.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, recipeBooks, recipePlacements, recipes, users } from "@workspace/db";
import { addBook, deleteBook, freshDefaultBooks, liveBooks, resolveBookId, type BookDef } from "@workspace/recipe-model";
import { needsDatabase } from "../lib/testdb";
import { libraryRouter } from "./library";
import { booksRouter } from "./books";

const TABLES = ["users", "recipes", "account_access", "recipe_books", "recipe_placements"];

let server: Server | null = null;
// One server however many requests start at once: the first test fires
// five together, and a helper that only remembered a finished start made
// five servers and closed one, which kept this file's process alive.
let starting: Promise<string> | null = null;
function listen(): Promise<string> {
  starting ??= (async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const u = req.header("x-test-user");
      req.session = u ? { userId: u } : null;
      next();
    });
    app.use("/api/library", libraryRouter);
    app.use("/api/books", booksRouter);
    server = createServer(app);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const addr = server.address();
    return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  })();
  return starting;
}

const minted = new Set<string>();
async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Books Test" });
  minted.add(id);
  return id;
}

after(async () => {
  if (minted.size) {
    const db = getDb();
    for (const id of minted) {
      await db.delete(recipePlacements).where(eq(recipePlacements.ownerKey, `owner-${id}`));
      await db.delete(recipes).where(eq(recipes.userId, id));
      await db.delete(recipeBooks).where(eq(recipeBooks.userId, id));
      await db.delete(accountAccess).where(eq(accountAccess.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  server?.close();
});

async function api(method: string, path: string, userId: string | null, body?: unknown) {
  const res = await fetch(`${await listen()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId, "X-Owner-Key": `owner-${userId}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const tree = (title: string, mealTypes: string[]) => ({
  title,
  servings: 1,
  mealTypes,
  sections: [
    {
      name: title,
      ingredients: [{ id: "a", qty: 1, unit: null, name: "bread" }],
      nodes: [{ id: "n1", label: "toast it", inputs: ["a"] }],
      root: "n1",
    },
  ],
});

/** A recipe row as an older client would have left it: no placement. */
async function oldRecipe(userId: string, id: string, mealTypes: string[], removed = false) {
  await getDb()
    .insert(recipes)
    .values({ id, ownerKey: `owner-${userId}`, userId, recipe: tree(id, mealTypes) as never, removedAt: removed ? new Date() : null });
}

const placementOf = async (userId: string, id: string) =>
  (
    await getDb()
      .select({ bookId: recipePlacements.bookId })
      .from(recipePlacements)
      .where(and(eq(recipePlacements.ownerKey, `owner-${userId}`), eq(recipePlacements.id, id)))
  )[0]?.bookId ?? null;

test("books: the seven defaults are made once, however many devices load at once, and existing recipes are placed by meal type", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  await oldRecipe(u, "pancakes", ["breakfast"]);
  await oldRecipe(u, "chili", ["dinner", "lunch"]);
  await oldRecipe(u, "punch", ["drink"]);
  await oldRecipe(u, "gone-soup", ["lunch"], true);
  // Already placed (by an earlier device, say): must keep its book.
  await getDb().insert(recipePlacements).values({ ownerKey: `owner-${u}`, id: "chili", bookId: "keeper" });

  // Five devices open the new version in the same moment.
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => api("GET", "/api/books", u)));
  for (const r of all) {
    assert.equal(r.status, 200);
    assert.equal(r.body.version, 1);
    assert.deepEqual(r.body.books.map((b: BookDef) => b.name), ["Breakfast", "Lunch", "Dinner", "Apps & Snacks", "Salads", "Desserts", "Other"]);
  }
  const rows = await getDb().select().from(recipeBooks).where(eq(recipeBooks.userId, u));
  assert.equal(rows.length, 1, "one books row, not five");
  assert.equal(await placementOf(u, "pancakes"), "breakfast");
  assert.equal(await placementOf(u, "chili"), "keeper", "an existing placement is kept");
  assert.equal(await placementOf(u, "punch"), "other");
  assert.equal(await placementOf(u, "gone-soup"), "lunch", "removed recipes are placed too, for when they come back");

  // A recipe the website saves later has no placement: its meal type decides.
  await oldRecipe(u, "later", ["dessert"]);
  await api("GET", "/api/books", u);
  assert.equal(await placementOf(u, "later"), null, "placing happens only when the books are first made");
  const list = await api("GET", "/api/library", u);
  const later = list.body.entries.find((e: any) => e.id === "later");
  assert.equal(later.book, null);
  assert.equal(resolveBookId(rows[0].books as BookDef[], later.book, later.recipe.mealTypes), "desserts");
});

test("books: signed out is 401; a stale write is a 409 with the current list; a bad one 422; Other never goes", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  assert.equal((await api("GET", "/api/books", null)).status, 401);
  const u = await makeUser();
  const first = await api("GET", "/api/books", u);
  const mine = addBook(first.body.books, { id: "soups", name: "Soups", now: Date.now() });
  const ok = await api("PUT", "/api/books", u, { books: mine, ifVersion: 1 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.version, 2);
  assert.ok(liveBooks(ok.body.books).some((b) => b.name === "Soups"));

  // A second device still on version 1.
  const stale = await api("PUT", "/api/books", u, { books: addBook(first.body.books, { id: "bread", name: "Bread", now: Date.now() }), ifVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "version_conflict");
  assert.equal(stale.body.version, 2);
  assert.ok(liveBooks(stale.body.books).some((b) => b.name === "Soups"), "the 409 carries what is there now");

  const withoutOther = (ok.body.books as BookDef[]).filter((b) => b.id !== "other");
  assert.equal((await api("PUT", "/api/books", u, { books: withoutOther, ifVersion: 2 })).status, 422);
  const dupName = (ok.body.books as BookDef[]).map((b) => (b.id === "soups" ? { ...b, name: "dinner" } : b));
  assert.equal((await api("PUT", "/api/books", u, { books: dupName, ifVersion: 2 })).status, 422);
  assert.equal((await api("PUT", "/api/books", u, { books: ok.body.books, ifVersion: "2" })).status, 400);

  // Someone else's books are not these.
  const other = await makeUser();
  const theirs = await api("GET", "/api/books", other);
  assert.ok(!liveBooks(theirs.body.books).some((b) => b.name === "Soups"));
});

test("books: a recipe's book rides the save and the versioned PATCH; two devices moving it is a 409; removed keeps it; delete clears it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  await api("GET", "/api/books", u);

  const saved = await api("POST", "/api/library", u, { id: "soup", recipe: tree("Soup", ["dinner"]), book: "soups-id" });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.entry.book, "soups-id");
  assert.equal((await api("POST", "/api/library", u, { id: "bad", recipe: tree("Bad", []), book: "not a valid id!" })).status, 400);

  // Device A moves it; device B, still on the old version, moves it too.
  const v = saved.body.entry.version;
  const a = await api("PATCH", "/api/library/soup", u, { book: "mains", ifVersion: v });
  assert.equal(a.status, 200);
  assert.equal(a.body.entry.book, "mains");
  assert.equal(a.body.entry.version, v + 1, "a move is a versioned write");
  const b = await api("PATCH", "/api/library/soup", u, { book: "lunch", ifVersion: v });
  assert.equal(b.status, 409, "the second device merges (last change wins) and retries");
  assert.equal(b.body.entry.book, "mains", "the 409 carries the book as it is now");
  const retried = await api("PATCH", "/api/library/soup", u, { book: "lunch", ifVersion: b.body.entry.version });
  assert.equal(retried.body.entry.book, "lunch");

  // Removed keeps its book; restoring brings it back with it.
  await api("PATCH", "/api/library/soup", u, { removedAt: Date.now() });
  const removed = await api("GET", "/api/library/removed", u);
  assert.equal(removed.body.entries.find((e: any) => e.id === "soup").book, "lunch");
  const restored = await api("PATCH", "/api/library/soup", u, { removedAt: null });
  assert.equal(restored.body.entry.book, "lunch");

  // null takes the placement away: the meal type decides again.
  const cleared = await api("PATCH", "/api/library/soup", u, { book: null });
  assert.equal(cleared.body.entry.book, null);

  await api("PATCH", "/api/library/soup", u, { book: "mains" });
  assert.equal((await api("DELETE", "/api/library/soup", u)).status, 200);
  assert.equal(await placementOf(u, "soup"), null, "no placement outlives its recipe");
});

test("books: deleting a book touches no recipe, and every recipe still resolves to a live book", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const first = await api("GET", "/api/books", u);
  let books = addBook(first.body.books, { id: "soups", name: "Soups", now: Date.now() });
  books = addBook(books, { id: "mains", name: "Mains", now: Date.now() });
  const v2 = await api("PUT", "/api/books", u, { books, ifVersion: 1 });
  await api("POST", "/api/library", u, { id: "broth", recipe: tree("Broth", ["dinner"]), book: "soups" });

  // Merge Soups into Mains.
  const merged = deleteBook(v2.body.books, "soups", { into: "mains", now: Date.now() });
  const v3 = await api("PUT", "/api/books", u, { books: merged, ifVersion: v2.body.version });
  assert.equal(v3.status, 200);
  assert.equal(await placementOf(u, "broth"), "soups", "the recipe row is not rewritten");
  assert.equal(resolveBookId(v3.body.books, "soups"), "mains");
  // Other stays whatever the client asks.
  const otherGone = (v3.body.books as BookDef[]).map((b) => (b.id === "other" ? { ...b, deletedAt: Date.now(), mergedInto: "mains" } : b));
  assert.equal((await api("PUT", "/api/books", u, { books: otherGone, ifVersion: v3.body.version })).status, 422);
  assert.deepEqual(freshDefaultBooks().length, 7);
});
