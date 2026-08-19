/**
 * server/lib/trial.ts — one free extraction per browser.
 *
 * A visitor gets a real extraction of a recipe they chose, and sees the full
 * diagram. Saving it, and extracting anything else, needs an account.
 *
 * THE RULE, AND WHY THIS DOES NOT BREAK IT. "No anonymous library" means many
 * recipes, indefinitely, for a browser that never signed in. It does not mean
 * no anonymous persistence: one recipe, pending signup, is the mechanism that
 * makes the funnel humane. Someone looking at a diagram of a recipe they
 * chose is at the best possible moment to be asked for an account and the
 * worst possible moment to lose their work, so that one recipe is stored
 * before there is an account to own it. If you are here to delete the trial
 * row because it looks like anonymous persistence: it is, deliberately, and
 * it is one row rather than a library.
 *
 * The recipe lives in `recipes` under owner_key `trial:<id>`, so claiming it
 * at signup is the same UPDATE the library claim performs rather than a
 * second way of owning a row.
 */

import crypto from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { recipes, trials } from "../../shared/schema";
import { readCookie, serializeCookie } from "./cookies";
import { planClaim } from "./claim";

export const TRIAL_COOKIE = "rd_trial";

/** Long enough that "one free extraction" is not quietly a monthly one. */
const TRIAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;

const isProd = process.env.NODE_ENV === "production";

/** The owner_key a trial's recipe is parked under until an account claims it. */
export const trialOwnerKey = (trialId: string) => `trial:${trialId}`;

export function readTrialId(req: Request): string | null {
  return readCookie(req, TRIAL_COOKIE);
}

/**
 * The browser's trial id, minting one if this is its first attempt.
 *
 * httpOnly, so the count cannot be edited from the page. That does not make it
 * unbypassable — clearing cookies or a private window resets it — but this is
 * a nudge for someone who would otherwise never sign up, not a paywall. What
 * matters is that the *check* is server-side, so a modified client still gets
 * a 402.
 */
export function ensureTrialId(req: Request, res: Response): string {
  const existing = readTrialId(req);
  if (existing) return existing;
  const id = crypto.randomBytes(24).toString("base64url");
  res.setHeader(
    "Set-Cookie",
    serializeCookie(TRIAL_COOKIE, id, {
      maxAgeSeconds: TRIAL_COOKIE_MAX_AGE_SECONDS,
      secure: isProd,
    })
  );
  return id;
}

export interface TrialState {
  id: string;
  spent: boolean;
  recipeId: string | null;
}

export async function getTrial(trialId: string): Promise<TrialState | null> {
  const db = getDb();
  const [row] = await db.select().from(trials).where(eq(trials.id, trialId));
  if (!row) return null;
  return { id: row.id, spent: row.usedAt !== null, recipeId: row.recipeId };
}

/**
 * Takes the free extraction, atomically, before the work is done.
 *
 * Returns false when it was already spent. The `used_at IS NULL` in the WHERE
 * is what makes two requests racing the same cookie resolve to one winner
 * rather than two free extractions. Spending first and refunding on failure
 * (see refundTrial) is deliberate: the alternative — extract, then mark —
 * hands out a second extraction to anyone who fires two requests at once.
 */
export async function spendTrial(trialId: string): Promise<boolean> {
  const db = getDb();
  await db.insert(trials).values({ id: trialId }).onConflictDoNothing();
  const claimed = await db
    .update(trials)
    .set({ usedAt: new Date() })
    .where(and(eq(trials.id, trialId), isNull(trials.usedAt)))
    .returning({ id: trials.id });
  return claimed.length > 0;
}

/** Gives the extraction back when the work failed, so a broken URL or a
 *  model timeout does not cost someone their one try. */
export async function refundTrial(trialId: string): Promise<void> {
  const db = getDb();
  await db
    .update(trials)
    .set({ usedAt: null, recipeId: null })
    .where(and(eq(trials.id, trialId), isNull(trials.claimedByUserId)));
}

/** Parks the extracted recipe against the trial, unowned, awaiting signup. */
export async function storeTrialRecipe(
  trialId: string,
  recipe: unknown,
  servings: number | null
): Promise<string> {
  const db = getDb();
  const recipeId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(recipes).values({
      id: recipeId,
      ownerKey: trialOwnerKey(trialId),
      userId: null,
      recipe: recipe as never,
      done: [],
      servings,
    });
    await tx.update(trials).set({ recipeId }).where(eq(trials.id, trialId));
  });
  return recipeId;
}

/**
 * Parks a recipe against the trial WITHOUT spending it, replacing whatever
 * was parked before.
 *
 * This exists for cached hits. A cache hit costs no API call, so it does not
 * take the free extraction (ROADMAP #3) — but the visitor is still looking at
 * a diagram they will want to keep, and if nothing is parked then signing up
 * hands them an empty library, which is the exact "lose your work" moment the
 * trial was built to prevent.
 *
 * REPLACE, NOT INSERT, and that is the difference from storeTrialRecipe.
 * That one inserts a fresh row and repoints `trials.recipeId`, which is
 * correct when it can only run once per trial. Cached views can happen any
 * number of times, and inserting each one would leave a pile of rows under
 * `trial:<id>` that no claim will ever collect — only the last is pointed at.
 * So the previous parked rows go in the same transaction.
 *
 * A CLAIMED trial parks nothing. The person already has an account, they are
 * simply browsing signed out, and a row parked now would never be claimed by
 * anything.
 */
export async function parkTrialRecipe(
  trialId: string,
  recipe: unknown,
  servings: number | null
): Promise<string | null> {
  const db = getDb();
  const ownerKey = trialOwnerKey(trialId);
  const recipeId = crypto.randomUUID();

  return db.transaction(async (tx) => {
    // A visitor whose first ever request is a cache hit has a cookie but no
    // row yet — spendTrial is what usually creates it, and it did not run.
    // Created UNUSED: parking is not spending.
    await tx.insert(trials).values({ id: trialId }).onConflictDoNothing();
    const [trial] = await tx.select().from(trials).where(eq(trials.id, trialId));
    if (!trial || trial.claimedByUserId) return null;

    await tx.delete(recipes).where(eq(recipes.ownerKey, ownerKey));
    await tx.insert(recipes).values({
      id: recipeId,
      ownerKey,
      userId: null,
      recipe: recipe as never,
      done: [],
      servings,
    });
    await tx.update(trials).set({ recipeId }).where(eq(trials.id, trialId));
    return recipeId;
  });
}

// ------------------------------------------------------------------ claim --

export interface TrialClaimResult {
  /** 1 when a recipe moved into the account, 0 otherwise. */
  claimed: number;
  /** The id the recipe ended up with — not necessarily the one it had, since
   *  a collision inside the account re-keys it. */
  recipeId: string | null;
}

export interface TrialClaimHooks {
  /** Test seam only, so the all-or-nothing guarantee can be asserted against
   *  a real database rather than assumed. */
  beforeAssign?(): void | Promise<void>;
}

/**
 * Hands a spent trial's recipe to the account that just signed up.
 *
 * One transaction: the recipe moves and the trial is marked claimed together,
 * or neither happens and the next load simply tries again. The collision case
 * goes through planClaim rather than a second implementation — a trial recipe
 * arriving with an id the account already holds is the same problem the
 * library claim solved, and it is already tested exhaustively.
 *
 * A trial claimed by another user is never taken. The cookie is not a
 * credential, so a copied or shared one must not transfer a recipe.
 */
export async function claimTrialRecipe(
  userId: string,
  trialId: string,
  hooks: TrialClaimHooks = {}
): Promise<TrialClaimResult> {
  const db = getDb();
  const ownerKey = trialOwnerKey(trialId);
  const nothing: TrialClaimResult = { claimed: 0, recipeId: null };

  return db.transaction(async (tx) => {
    const [trial] = await tx.select().from(trials).where(eq(trials.id, trialId));
    if (!trial) return nothing;
    if (trial.claimedByUserId && trial.claimedByUserId !== userId) return nothing;

    const markClaimed = (recipeId: string | null) =>
      tx
        .update(trials)
        .set({ claimedByUserId: userId, claimedAt: new Date(), ...(recipeId ? { recipeId } : {}) })
        .where(eq(trials.id, trialId));

    // Spent but nothing stored — an extraction that failed after taking the
    // slot. Mark it so the client stops retrying something that cannot arrive.
    if (!trial.recipeId) {
      await markClaimed(null);
      return nothing;
    }

    const [row] = await tx
      .select({ id: recipes.id, userId: recipes.userId })
      .from(recipes)
      .where(and(eq(recipes.ownerKey, ownerKey), eq(recipes.id, trial.recipeId)));

    if (!row) {
      await markClaimed(null);
      return nothing;
    }
    if (row.userId === userId) {
      await markClaimed(row.id);
      return { claimed: 0, recipeId: row.id };
    }
    if (row.userId) return nothing;

    const existing = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.userId, userId));

    const plan = planClaim({
      userId,
      candidates: [{ id: row.id, userId: row.userId }],
      existingIds: existing.map((r) => r.id),
    });
    const move = plan.moves[0];
    if (!move) return nothing;

    await hooks.beforeAssign?.();

    await tx
      .update(recipes)
      .set({ userId, id: move.toId, updatedAt: new Date() })
      .where(
        and(
          eq(recipes.ownerKey, ownerKey),
          eq(recipes.id, move.fromId),
          isNull(recipes.userId)
        )
      );
    await markClaimed(move.toId);
    return { claimed: 1, recipeId: move.toId };
  });
}
