/**
 * server/routes/library.ts
 *
 * CRUD for the saved-recipe library, scoped either by the signed-in user or
 * by an anonymous X-Owner-Key header (see the comment above requireOwnerKey
 * below for what that key is and isn't).
 *
 *   GET    /api/library          list, newest first
 *   POST   /api/library          create { id, recipe, done, servings }
 *   PATCH  /api/library/:id      update done, servings, mode and/or timer
 *   DELETE /api/library/:id
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc, isNull, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { recipes } from "../../shared/schema";
import { validateRecipe } from "../../shared/layout";
import { userIdOf } from "../middleware/session";

export const libraryRouter = Router();

/**
 * Ownership comes in two kinds, and a request is always exactly one of them.
 *
 * Signed in: rows are scoped by user_id. Anonymous: the client generates a
 * random id on first load and sends it as X-Owner-Key, and rows are scoped by
 * owner_key AND user_id IS NULL — the second half matters, or a browser whose
 * recipes have already been merged into an account would still see them
 * unauthenticated.
 *
 * The anonymous key is NOT auth: anyone who guesses or steals it can read that
 * owner's recipes. It exists so separate browsers don't see each other's
 * library, and it stays supported on purpose — saving without an account is
 * what makes the landing demo's sign-up funnel work.
 */
type TimerValue = { stepId: string; endsAt: number } | null;

/** `{stepId, endsAt}` or null — the shape stored in the `timer` jsonb column. */
function isValidTimer(v: unknown): v is TimerValue {
  if (v === null) return true;
  if (typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.stepId === "string" && typeof t.endsAt === "number";
}

function requireOwnerKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("X-Owner-Key");
  if (key && typeof key === "string" && key.length >= 8 && key.length <= 200) {
    (req as Request & { ownerKey: string }).ownerKey = key;
    return next();
  }
  // A signed-in client normally still sends its anonymous key, but it must not
  // be required to: a fresh browser that signs in before ever saving anything
  // has no key to send. owner_key is NOT NULL and part of the primary key, so
  // rows created in that state are stamped with the account instead.
  const userId = userIdOf(req);
  if (userId) {
    (req as Request & { ownerKey: string }).ownerKey = `user:${userId}`;
    return next();
  }
  return res.status(401).json({ error: "Missing or invalid X-Owner-Key header." });
}

libraryRouter.use(requireOwnerKey);

const ownerKeyOf = (req: Request) => (req as Request & { ownerKey: string }).ownerKey;

/**
 * The one ownership predicate every query in this file goes through. Keeping
 * it in a single place is what stops the two ownership kinds from drifting
 * apart route by route.
 */
function scopeOf(req: Request): SQL {
  const userId = userIdOf(req);
  if (userId) return eq(recipes.userId, userId);
  return and(eq(recipes.ownerKey, ownerKeyOf(req)), isNull(recipes.userId)) as SQL;
}

libraryRouter.get("/", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(recipes)
      .where(scopeOf(req))
      .orderBy(desc(recipes.updatedAt));
    return res.json({
      entries: rows.map((r) => ({
        id: r.id,
        recipe: r.recipe,
        done: r.done,
        servings: r.servings,
        mode: r.mode,
        timer: r.timer,
        savedAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now(),
      })),
    });
  } catch (e) {
    console.error("[library:list]", e);
    return res.status(500).json({ error: "Could not load your library." });
  }
});

libraryRouter.post("/", async (req: Request, res: Response) => {
  const { id, recipe, done, servings, mode, timer } = req.body ?? {};
  if (typeof id !== "string" || !id)
    return res.status(400).json({ error: "id must be a non-empty string." });

  const errors = validateRecipe(recipe);
  if (errors.length)
    return res.status(422).json({ error: "That recipe is not valid.", details: errors });

  if (done !== undefined && !Array.isArray(done))
    return res.status(400).json({ error: "done must be an array of ids." });
  if (servings !== undefined && servings !== null && typeof servings !== "number")
    return res.status(400).json({ error: "servings must be a number or null." });
  if (mode !== undefined && mode !== "diagram" && mode !== "steps")
    return res.status(400).json({ error: 'mode must be "diagram" or "steps".' });
  if (timer !== undefined && !isValidTimer(timer))
    return res.status(400).json({ error: "timer must be {stepId, endsAt} or null." });

  try {
    const db = getDb();
    const [row] = await db
      .insert(recipes)
      .values({
        id,
        ownerKey: ownerKeyOf(req),
        // Created while signed in? Then it belongs to the account from the
        // start and never needs merging.
        userId: userIdOf(req),
        recipe,
        done: Array.isArray(done) ? done : [],
        servings: servings ?? null,
        mode: mode ?? "diagram",
        timer: timer ?? null,
      })
      .onConflictDoNothing({ target: [recipes.ownerKey, recipes.id] })
      .returning();

    if (!row) return res.status(409).json({ error: "A recipe with that id already exists." });

    return res.status(201).json({
      entry: {
        id: row.id,
        recipe: row.recipe,
        done: row.done,
        servings: row.servings,
        mode: row.mode,
        timer: row.timer,
        savedAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
      },
    });
  } catch (e) {
    console.error("[library:create]", e);
    return res.status(500).json({ error: "Could not save that recipe." });
  }
});

libraryRouter.patch("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { done, servings, mode, timer } = req.body ?? {};
  const patch: Partial<typeof recipes.$inferInsert> = { updatedAt: new Date() };

  if (done !== undefined) {
    if (!Array.isArray(done)) return res.status(400).json({ error: "done must be an array of ids." });
    patch.done = done;
  }
  if (servings !== undefined) {
    if (servings !== null && typeof servings !== "number")
      return res.status(400).json({ error: "servings must be a number or null." });
    patch.servings = servings;
  }
  if (mode !== undefined) {
    if (mode !== "diagram" && mode !== "steps")
      return res.status(400).json({ error: 'mode must be "diagram" or "steps".' });
    patch.mode = mode;
  }
  if (timer !== undefined) {
    if (!isValidTimer(timer))
      return res.status(400).json({ error: "timer must be {stepId, endsAt} or null." });
    patch.timer = timer;
  }

  try {
    const db = getDb();
    const [row] = await db
      .update(recipes)
      .set(patch)
      .where(and(eq(recipes.id, id), scopeOf(req)))
      .returning();

    if (!row) return res.status(404).json({ error: "No saved recipe with that id." });

    return res.json({
      entry: {
        id: row.id,
        recipe: row.recipe,
        done: row.done,
        servings: row.servings,
        mode: row.mode,
        timer: row.timer,
        savedAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
      },
    });
  } catch (e) {
    console.error("[library:update]", e);
    return res.status(500).json({ error: "Could not update that recipe." });
  }
});

libraryRouter.delete("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const db = getDb();
    const [row] = await db
      .delete(recipes)
      .where(and(eq(recipes.id, id), scopeOf(req)))
      .returning({ id: recipes.id });

    if (!row) return res.status(404).json({ error: "No saved recipe with that id." });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[library:delete]", e);
    return res.status(500).json({ error: "Could not delete that recipe." });
  }
});
