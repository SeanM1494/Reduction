/**
 * server/routes/trial.ts — the one row a signed-out browser may edit.
 *
 * WHY THIS IS ITS OWN ROUTE RATHER THAN A THIRD CASE IN library.ts's scopeOf.
 *
 * The obvious implementation is to teach the library's ownership predicate
 * about trials, since it already knows two kinds of ownership. That would be
 * wrong, and not by a little: scopeOf gates the WHOLE library surface — list,
 * create, delete — so widening it would hand a signed-out browser the ability
 * to create rows, which is exactly the anonymous library ROADMAP #7 retired.
 *
 * A single-row PATCH can express "you may edit the one recipe your trial
 * owns" without also expressing "you may own a library". That distinction is
 * the whole of #7, so it gets its own route and scopeOf stays single.
 *
 * WHY THE EDITS SURVIVE SIGNUP FOR FREE. claimTrialRecipe moves THIS row — it
 * sets user_id and only re-keys the id on a collision. So an edit applied
 * here is on the row the account will receive; there is no second copy to
 * reconcile, and nothing to merge at claim time.
 *
 * The trial id comes from the httpOnly cookie and nowhere else. A request
 * body cannot name a trial, so a modified client cannot address a stranger's
 * row. `user_id IS NULL` in the WHERE means a row already claimed can never
 * be patched through this path, even by the browser that created it.
 */

import { Router, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { recipes, trials } from "../../shared/schema";
import { validateRecipe, type Recipe } from "../../shared/layout";
import { pruneOrderPreference } from "../../shared/sequence";
import { isValidOrder } from "./library";
import { sanitizeMealTypes } from "../../shared/mealTypes";
import { reconcileDone } from "../../shared/progress";
import { readTrialId, trialOwnerKey } from "../lib/trial";

export const trialRouter = Router();

const isValidTimer = (v: unknown): boolean => {
  if (v === null) return true;
  if (typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.stepId === "string" && typeof t.endsAt === "number";
};
const isValidCooked = (v: unknown): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));
const isValidRating = (v: unknown): boolean =>
  v === null || v === -1 || v === 0 || v === 1;

/**
 * Updates the browser's own trial recipe.
 *
 * No `ifVersion` here, deliberately: the trial cookie is per-browser, so
 * there is no two-device scenario — only two tabs of one browser, where
 * last-write-wins on a deliberate edit is proportionate. The column exists if
 * that ever stops being true.
 */
trialRouter.patch("/recipe", async (req: Request, res: Response) => {
  const trialId = readTrialId(req);
  if (!trialId) return res.status(401).json({ error: "No trial on this browser." });

  const { recipe, done, servings, mode, timer, cooked, rating, order } = req.body ?? {};

  if (recipe !== undefined) {
    const errors = validateRecipe(recipe);
    if (errors.length)
      return res.status(422).json({ error: "That recipe is not valid.", details: errors });
    (recipe as { mealTypes?: string[] }).mealTypes = sanitizeMealTypes(
      (recipe as { mealTypes?: unknown }).mealTypes
    );
  }
  if (done !== undefined && !Array.isArray(done))
    return res.status(400).json({ error: "done must be an array of ids." });
  if (servings !== undefined && servings !== null && typeof servings !== "number")
    return res.status(400).json({ error: "servings must be a number or null." });
  if (mode !== undefined && mode !== "diagram" && mode !== "steps")
    return res.status(400).json({ error: 'mode must be "diagram" or "steps".' });
  if (timer !== undefined && !isValidTimer(timer))
    return res.status(400).json({ error: "timer must be {stepId, endsAt} or null." });
  if (cooked !== undefined && !isValidCooked(cooked))
    return res.status(400).json({ error: "cooked must be an array of timestamps." });
  if (rating !== undefined && !isValidRating(rating))
    return res.status(400).json({ error: "rating must be -1, 0, 1, or null." });
  if (order !== undefined && !isValidOrder(order))
    return res.status(400).json({ error: "order must be {sections?, branches?} or null." });

  try {
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [trial] = await tx.select().from(trials).where(eq(trials.id, trialId));
      if (!trial || !trial.recipeId) return { kind: "missing" as const };
      // Once an account owns it, this path is closed: the library routes are
      // the only way in, and they check a session.
      if (trial.claimedByUserId) return { kind: "claimed" as const };

      const where = and(
        eq(recipes.ownerKey, trialOwnerKey(trialId)),
        eq(recipes.id, trial.recipeId),
        isNull(recipes.userId)
      );
      const [current] = await tx.select().from(recipes).where(where);
      if (!current) return { kind: "missing" as const };

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (recipe !== undefined) {
        patch.recipe = recipe;
        // Same guarantee the library PATCH gives: whatever tree ends up
        // stored, `done` cannot reference an id it does not contain.
        patch.done = reconcileDone(recipe, done !== undefined ? done : current.done).done;
      } else if (done !== undefined) {
        patch.done = done;
      }
      if (servings !== undefined) patch.servings = servings;
      if (mode !== undefined) patch.mode = mode;
      if (timer !== undefined) patch.timer = timer;
      if (cooked !== undefined) patch.cooked = cooked;
      if (rating !== undefined) patch.rating = rating;
      if (order !== undefined || recipe !== undefined) {
        // Pruned against whatever tree the row ends up with — the same
        // guarantee, in the same place, as the done reconciliation above.
        const tree = (recipe !== undefined ? recipe : current.recipe) as Recipe;
        const raw = order !== undefined ? order : current.cardOrder;
        patch.cardOrder = pruneOrderPreference(tree, raw ?? null);
      }

      const [updated] = await tx.update(recipes).set(patch).where(where).returning();
      return updated ? { kind: "ok" as const, row: updated } : { kind: "missing" as const };
    });

    if (result.kind === "missing")
      return res.status(404).json({ error: "No trial recipe to update." });
    if (result.kind === "claimed")
      return res
        .status(409)
        .json({ error: "That recipe now belongs to an account.", code: "trial_claimed" });

    const row = result.row;
    return res.json({
      entry: {
        id: row.id,
        recipe: row.recipe,
        done: row.done,
        servings: row.servings,
        mode: row.mode,
        timer: row.timer,
        cooked: row.cooked ?? [],
        rating: row.rating ?? null,
        order: row.cardOrder ?? null,
        savedAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
      },
    });
  } catch (e) {
    console.error("[trial:update]", e);
    return res.status(500).json({ error: "Could not save that change." });
  }
});
