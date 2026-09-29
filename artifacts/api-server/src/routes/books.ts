/**
 * server/routes/books.ts — the account's recipe books, as one document.
 *
 *   GET /api/books              → { books, version }, the seven defaults
 *                                 created on first read (lib/books.ts
 *                                 ensureBooks — idempotent under a race)
 *   PUT /api/books { books, ifVersion }
 *                               → 200 { books, version }
 *                               → 409 { code: "version_conflict", books, version }
 *                               → 422 { error, details } (validateBooks)
 *
 * Signed in only: the phone app is, and a trial has no box to organise.
 * Deleting and merging are ordinary PUTs — a deleted book stays in the list
 * as a tombstone saying where its recipes went, and no recipe row is
 * touched (recipe-model books.ts) — so nothing here can lose a recipe.
 *
 * Without the tables (hand-run DDL not yet run) both answer 503 with
 * `code: "books_unavailable"`, and the phone keeps today's seven books.
 */

import { Router, type Request, type Response } from "express";
import { userIdOf } from "../middleware/session";
import { ensureBooks, putBooks } from "../lib/books";

export const booksRouter = Router();

const unavailable = (res: Response, e: unknown) => {
  console.error("[books] unavailable:", (e as Error).message);
  return res.status(503).json({ error: "Recipe books are not available yet.", code: "books_unavailable" });
};

booksRouter.get("/", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  try {
    return res.json(await ensureBooks(userId));
  } catch (e) {
    return unavailable(res, e);
  }
});

booksRouter.put("/", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const { books, ifVersion } = req.body ?? {};
  if (typeof ifVersion !== "number") return res.status(400).json({ error: "ifVersion must be a number." });
  try {
    const result = await putBooks(userId, books, ifVersion);
    if (result.kind === "invalid") return res.status(422).json({ error: "Those books are not valid.", details: result.errors });
    if (result.kind === "stale")
      return res.status(409).json({ error: "Your books were changed elsewhere.", code: "version_conflict", ...result.doc });
    return res.json(result.doc);
  } catch (e) {
    return unavailable(res, e);
  }
});
