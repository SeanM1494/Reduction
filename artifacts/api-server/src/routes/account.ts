/**
 * server/routes/account.ts — the account itself: today, its deletion.
 *
 * `DELETE /api/account` is the in-app account deletion Apple requires of
 * any app with account creation (guideline 5.1.1(v)) and the thing this
 * app owes anyone who wants out. Two steps, in this order, and the order
 * is the point:
 *
 *   1. Stop the billing (lib/billing/cancel.ts). If a provider this server
 *      CAN cancel refuses, nothing is deleted and the answer is 502 —
 *      deleting first would leave a subscription charging an account that
 *      no longer exists to cancel it from.
 *   2. Delete the account, in one transaction: the user row and everything
 *      that cascades from it (identities, sessions, push subscriptions,
 *      timer notifications, allowance, subscription rows, redemptions),
 *      plus the rows keyed on the id without a foreign key — recipes and
 *      their photos, access events — and the trial that remembers who
 *      claimed it.
 *      `admin_events` is deliberately kept: it is the audit trail of a
 *      privileged write, names the account only by id, and CLAUDE.md is
 *      explicit that nothing prunes it.
 *
 * The session cookie is cleared on the way out; a phone drops its token on
 * the client's side. Nothing here is undoable, and nothing here asks twice
 * — the confirm belongs to the screen that has the person's attention.
 */

import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accessEvents, recipePhotos, recipes, trials, users } from "@workspace/db";
import { userIdOf } from "../middleware/session";
import { clearSessionCookie } from "./auth";
import { cancelSubscriptionsFor } from "../lib/billing/cancel";

export const accountRouter = Router();

accountRouter.delete("/", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });

  let summary;
  try {
    summary = await cancelSubscriptionsFor(userId);
  } catch (e) {
    console.error(`[account:delete] ${userId}: cancel failed, nothing deleted:`, (e as Error).message);
    return res.status(502).json({
      error: "Your subscription could not be cancelled, so nothing was deleted. Try again in a moment.",
      code: "cancel_failed",
    });
  }

  try {
    await getDb().transaction(async (tx) => {
      // Photos first, by join: recipe_photos has no foreign key (see its
      // schema comment), so nothing cascades.
      await tx.execute(
        sql`delete from ${recipePhotos} p using ${recipes} r
             where p.owner_key = r.owner_key and p.id = r.id and r.user_id = ${userId}`
      );
      await tx.delete(recipes).where(eq(recipes.userId, userId));
      await tx.delete(accessEvents).where(eq(accessEvents.userId, userId));
      await tx.update(trials).set({ claimedByUserId: null }).where(eq(trials.claimedByUserId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
  } catch (e) {
    console.error(`[account:delete] ${userId}:`, (e as Error).message);
    return res.status(500).json({ error: "Could not delete your account. Try again in a moment." });
  }

  console.log(
    `[account:delete] ${userId} deleted; cancelled=[${summary.cancelled.join(",")}] manual=[${summary.manual.join(",")}]`
  );
  clearSessionCookie(res);
  return res.json({ ok: true, ...summary });
});
