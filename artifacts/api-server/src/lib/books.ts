/**
 * server/lib/books.ts — an account's recipe books and where each recipe
 * sits (recipe-model books.ts has the rules; this is storage).
 *
 * Two hand-run tables (README "Recipe books"): `recipe_books`, one row per
 * account holding the list as a versioned document, and `recipe_placements`,
 * one row per recipe naming its book by id. Both are DECORATION in the sense
 * CLAUDE.md means for photos: the library is the app, and a missing table
 * must never take it down. So every read here is wrapped by its caller to
 * degrade — no placement means the meal type decides, no books row means
 * the phone shows today's seven — and every write of a placement is its own
 * savepoint, so it can fail without failing the save or edit around it.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { recipeBooks, recipePlacements, recipes } from "@workspace/db";
import { defaultBookIdFor, freshDefaultBooks, validateBooks, type BookDef } from "@workspace/recipe-model";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A placement's book id: what validateBooks accepts as an id. */
export const isValidBookId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

export interface BooksDoc {
  books: BookDef[];
  version: number;
}

/**
 * The account's books, created on first read. Idempotent under a race: the
 * INSERT … ON CONFLICT (user_id) DO NOTHING means two devices loading at the
 * same moment produce ONE row (the second waits on the first's commit, then
 * does nothing), and only the request whose insert returned a row — the one
 * that really created it — places the account's existing recipes, removed
 * ones included, in their meal type's book. Those placements are inserted
 * ON CONFLICT DO NOTHING too, so a recipe already placed keeps its book.
 */
export async function ensureBooks(userId: string): Promise<BooksDoc> {
  return getDb().transaction(async (tx) => {
    const created = await tx
      .insert(recipeBooks)
      .values({ userId, books: freshDefaultBooks(), version: 1 })
      .onConflictDoNothing({ target: recipeBooks.userId })
      .returning({ userId: recipeBooks.userId });
    if (created.length) {
      const rows = await tx
        .select({ ownerKey: recipes.ownerKey, id: recipes.id, recipe: recipes.recipe })
        .from(recipes)
        .where(eq(recipes.userId, userId));
      if (rows.length) {
        await tx
          .insert(recipePlacements)
          .values(
            rows.map((r) => ({
              ownerKey: r.ownerKey,
              id: r.id,
              bookId: defaultBookIdFor((r.recipe as { mealTypes?: string[] }).mealTypes),
            }))
          )
          .onConflictDoNothing();
      }
    }
    const [row] = await tx.select().from(recipeBooks).where(eq(recipeBooks.userId, userId));
    return { books: row.books as BookDef[], version: row.version };
  });
}

export type PutBooksResult =
  | { kind: "ok"; doc: BooksDoc }
  | { kind: "stale"; doc: BooksDoc }
  | { kind: "invalid"; errors: string[] };

/**
 * Replace the list, if `ifVersion` still matches. A stale write gets the
 * current list back (the 409 body), and the phone merges (mergeBooks) and
 * retries — the server never merges. Validated here whatever the client
 * did: shape, a live Other, clean unique names, colors from the set.
 */
export async function putBooks(userId: string, books: unknown, ifVersion: number): Promise<PutBooksResult> {
  const errors = validateBooks(books);
  if (errors.length) return { kind: "invalid", errors };
  await ensureBooks(userId);
  return getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(recipeBooks).where(eq(recipeBooks.userId, userId)).for("update");
    const doc = { books: current.books as BookDef[], version: current.version };
    if (current.version !== ifVersion) return { kind: "stale" as const, doc };
    const [row] = await tx
      .update(recipeBooks)
      .set({ books: books as BookDef[], version: current.version + 1, updatedAt: new Date() })
      .where(eq(recipeBooks.userId, userId))
      .returning();
    return { kind: "ok" as const, doc: { books: row.books as BookDef[], version: row.version } };
  });
}

const keyOf = (ownerKey: string, id: string) => `${ownerKey}\u0000${id}`;

/** The placements of a set of recipes, keyed (owner_key, id). Throws when
 *  the table is missing; callers degrade. */
export async function placementsFor(keys: Array<{ ownerKey: string; id: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  const rows = await getDb()
    .select({ ownerKey: recipePlacements.ownerKey, id: recipePlacements.id, bookId: recipePlacements.bookId })
    .from(recipePlacements)
    .where(
      inArray(
        sql`(${recipePlacements.ownerKey}, ${recipePlacements.id})`,
        keys.map((k) => sql`(${k.ownerKey}, ${k.id})`)
      )
    );
  for (const r of rows) out.set(keyOf(r.ownerKey, r.id), r.bookId);
  return out;
}

export const placementKey = keyOf;

/**
 * Put a recipe in a book (or take its placement away, `null`: its meal
 * type decides again), inside the caller's transaction but in a SAVEPOINT
 * of its own: without the table it fails alone, logged, and the save or
 * edit around it still commits. Returns whether it was written.
 */
export async function setPlacement(tx: Tx, ownerKey: string, id: string, bookId: string | null): Promise<boolean> {
  try {
    await tx.transaction(async (sp) => {
      if (bookId === null) {
        await sp.delete(recipePlacements).where(and(eq(recipePlacements.ownerKey, ownerKey), eq(recipePlacements.id, id)));
      } else {
        await sp
          .insert(recipePlacements)
          .values({ ownerKey, id, bookId })
          .onConflictDoUpdate({ target: [recipePlacements.ownerKey, recipePlacements.id], set: { bookId, updatedAt: new Date() } });
      }
    });
    return true;
  } catch (e) {
    console.warn("[books:placement] not written:", (e as Error).message);
    return false;
  }
}

/** A deleted recipe's placement goes with it (no foreign key). */
export async function deletePlacement(ownerKey: string, id: string): Promise<void> {
  await getDb()
    .delete(recipePlacements)
    .where(and(eq(recipePlacements.ownerKey, ownerKey), eq(recipePlacements.id, id)));
}
