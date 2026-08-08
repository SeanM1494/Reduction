/**
 * server/routes/library.ts
 *
 * CRUD for the saved-recipe library, scoped by an X-Owner-Key header (see
 * the comment on requireOwnerKey below for what that is and isn't).
 *
 *   GET    /api/library          list, newest first
 *   POST   /api/library          create { id, recipe, done, servings }
 *   PATCH  /api/library/:id      update done and/or servings
 *   DELETE /api/library/:id
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db";
import { recipes } from "../../shared/schema";
import { validateRecipe } from "../../shared/layout";

export const libraryRouter = Router();

/**
 * Ownership without accounts: the client generates a random id on first
 * load and sends it as X-Owner-Key on every request. This is NOT auth or
 * security — anyone who guesses or steals the key can read that owner's
 * recipes. It exists so separate browsers don't see each other's library,
 * and so that adding real auth later is a column swap (owner_key -> user
 * id) rather than a data migration.
 */
function requireOwnerKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("X-Owner-Key");
  if (!key || typeof key !== "string" || key.length < 8 || key.length > 200) {
    return res.status(401).json({ error: "Missing or invalid X-Owner-Key header." });
  }
  (req as Request & { ownerKey: string }).ownerKey = key;
  next();
}

libraryRouter.use(requireOwnerKey);

const ownerKeyOf = (req: Request) => (req as Request & { ownerKey: string }).ownerKey;

libraryRouter.get("/", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(recipes)
      .where(eq(recipes.ownerKey, ownerKeyOf(req)))
      .orderBy(desc(recipes.updatedAt));
    return res.json({
      entries: rows.map((r) => ({
        id: r.id,
        recipe: r.recipe,
        done: r.done,
        servings: r.servings,
        savedAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now(),
      })),
    });
  } catch (e) {
    console.error("[library:list]", e);
    return res.status(500).json({ error: "Could not load your library." });
  }
});

libraryRouter.post("/", async (req: Request, res: Response) => {
  const { id, recipe, done, servings } = req.body ?? {};
  if (typeof id !== "string" || !id)
    return res.status(400).json({ error: "id must be a non-empty string." });

  const errors = validateRecipe(recipe);
  if (errors.length)
    return res.status(422).json({ error: "That recipe is not valid.", details: errors });

  if (done !== undefined && !Array.isArray(done))
    return res.status(400).json({ error: "done must be an array of ids." });
  if (servings !== undefined && servings !== null && typeof servings !== "number")
    return res.status(400).json({ error: "servings must be a number or null." });

  try {
    const db = getDb();
    const [row] = await db
      .insert(recipes)
      .values({
        id,
        ownerKey: ownerKeyOf(req),
        recipe,
        done: Array.isArray(done) ? done : [],
        servings: servings ?? null,
      })
      .onConflictDoNothing({ target: recipes.id })
      .returning();

    if (!row) return res.status(409).json({ error: "A recipe with that id already exists." });

    return res.status(201).json({
      entry: {
        id: row.id,
        recipe: row.recipe,
        done: row.done,
        servings: row.servings,
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
  const { done, servings } = req.body ?? {};
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

  try {
    const db = getDb();
    const [row] = await db
      .update(recipes)
      .set(patch)
      .where(and(eq(recipes.id, id), eq(recipes.ownerKey, ownerKeyOf(req))))
      .returning();

    if (!row) return res.status(404).json({ error: "No saved recipe with that id." });

    return res.json({
      entry: {
        id: row.id,
        recipe: row.recipe,
        done: row.done,
        servings: row.servings,
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
      .where(and(eq(recipes.id, id), eq(recipes.ownerKey, ownerKeyOf(req))))
      .returning({ id: recipes.id });

    if (!row) return res.status(404).json({ error: "No saved recipe with that id." });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[library:delete]", e);
    return res.status(500).json({ error: "Could not delete that recipe." });
  }
});
