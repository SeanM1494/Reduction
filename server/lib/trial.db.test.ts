/**
 * server/lib/trial.db.test.ts — the contract for handing a trial's recipe to
 * the account that just signed up.
 *
 * Written before the implementation, like the library claim in
 * claim.db.test.ts and for the same reason: this is the second place in the
 * codebase where a bug loses someone's data rather than rendering something
 * wrong. Someone who extracted a recipe, looked at its diagram, and then
 * created an account to keep it must find it in their library. Losing it is
 * worse than never having offered the trial.
 *
 * These need Postgres, so they skip when DATABASE_URL is unset or
 * unreachable. A skipped rollback test proves nothing — run them with a
 * database before releasing.
 */

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { recipes, trials } from "../../shared/schema";
import { claimTrialRecipe, spendTrial, storeTrialRecipe, trialOwnerKey } from "./trial";
import type { Recipe } from "../../shared/layout";

const STUB_RECIPE = {
  title: "Trial Recipe",
  servings: 2,
  sections: [
    {
      name: "S",
      ingredients: [{ id: "i1", qty: 1, unit: null, name: "thing" }],
      nodes: [{ id: "n1", label: "do it", inputs: ["i1"] }],
      root: "n1",
    },
  ],
} as unknown as Recipe;

let reachable: boolean | null = null;

async function hasDatabase(): Promise<boolean> {
  if (reachable !== null) return reachable;
  if (!process.env.DATABASE_URL) return (reachable = false);
  try {
    await getDb().select({ id: trials.id }).from(trials).limit(1);
    return (reachable = true);
  } catch {
    return (reachable = false);
  }
}

async function needsDatabase(t: TestContext): Promise<boolean> {
  if (await hasDatabase()) return true;
  t.skip("no reachable DATABASE_URL");
  return false;
}

const newTrialId = () => `test-trial-${crypto.randomUUID()}`;
const newUser = () => `test-user-${crypto.randomUUID()}`;

/** A trial that has been spent and has its recipe parked, ready to claim. */
async function spentTrial(): Promise<{ trialId: string; recipeId: string }> {
  const trialId = newTrialId();
  assert.equal(await spendTrial(trialId), true, "a fresh trial must be spendable");
  const recipeId = await storeTrialRecipe(trialId, STUB_RECIPE, 2);
  return { trialId, recipeId };
}

async function rowsFor(trialId: string) {
  return getDb()
    .select({ id: recipes.id, userId: recipes.userId })
    .from(recipes)
    .where(eq(recipes.ownerKey, trialOwnerKey(trialId)));
}

async function cleanup(trialId: string) {
  const db = getDb();
  await db.delete(recipes).where(eq(recipes.ownerKey, trialOwnerKey(trialId)));
  await db.delete(trials).where(eq(trials.id, trialId));
}

test("a spent trial can only be spent once", async (t) => {
  if (!(await needsDatabase(t))) return;
  const trialId = newTrialId();
  try {
    assert.equal(await spendTrial(trialId), true, "first extraction is free");
    assert.equal(await spendTrial(trialId), false, "second is not");
  } finally {
    await cleanup(trialId);
  }
});

test("the trial recipe lands in the account that claims it", async (t) => {
  if (!(await needsDatabase(t))) return;
  const { trialId, recipeId } = await spentTrial();
  const userId = newUser();
  try {
    const result = await claimTrialRecipe(userId, trialId);
    assert.equal(result.claimed, 1);
    assert.equal(result.recipeId, recipeId, "no collision, so it keeps its id");

    const after = await rowsFor(trialId);
    assert.equal(after.length, 1);
    assert.equal(after[0].userId, userId, "the recipe is now theirs");
  } finally {
    await cleanup(trialId);
  }
});

test("claiming twice is idempotent", async (t) => {
  if (!(await needsDatabase(t))) return;
  const { trialId } = await spentTrial();
  const userId = newUser();
  try {
    await claimTrialRecipe(userId, trialId);
    const second = await claimTrialRecipe(userId, trialId);
    assert.equal(second.claimed, 0, "nothing left to move");

    const after = await rowsFor(trialId);
    assert.equal(after.length, 1, "and nothing duplicated");
    assert.equal(after[0].userId, userId);
  } finally {
    await cleanup(trialId);
  }
});

test("a trial already claimed by someone else is never taken", async (t) => {
  if (!(await needsDatabase(t))) return;
  const { trialId } = await spentTrial();
  const first = newUser();
  const second = newUser();
  try {
    await claimTrialRecipe(first, trialId);
    const result = await claimTrialRecipe(second, trialId);
    assert.equal(result.claimed, 0, "a shared or copied cookie must not transfer a recipe");

    const after = await rowsFor(trialId);
    assert.equal(after[0].userId, first, "it still belongs to whoever claimed it");
  } finally {
    await cleanup(trialId);
  }
});

test("an id collision inside the account re-keys rather than failing", async (t) => {
  if (!(await needsDatabase(t))) return;
  const { trialId, recipeId } = await spentTrial();
  const userId = newUser();
  const db = getDb();
  const otherKey = `test-owner-${crypto.randomUUID()}`;
  try {
    // The account already holds a recipe with exactly the trial recipe's id.
    await db.insert(recipes).values({
      id: recipeId,
      ownerKey: otherKey,
      userId,
      recipe: STUB_RECIPE,
      done: [],
    });

    const result = await claimTrialRecipe(userId, trialId);
    assert.equal(result.claimed, 1, "the recipe still arrives");
    assert.notEqual(result.recipeId, recipeId, "under a new id");

    const after = await rowsFor(trialId);
    assert.equal(after[0].userId, userId);
    assert.notEqual(after[0].id, recipeId);
  } finally {
    await db.delete(recipes).where(and(eq(recipes.ownerKey, otherKey), eq(recipes.id, recipeId)));
    await cleanup(trialId);
  }
});

test("a trial with no recipe is a no-op, not an error", async (t) => {
  if (!(await needsDatabase(t))) return;
  // Spent but never stored — an extraction that failed after taking the slot.
  const trialId = newTrialId();
  const userId = newUser();
  try {
    await spendTrial(trialId);
    const result = await claimTrialRecipe(userId, trialId);
    assert.equal(result.claimed, 0);
    assert.equal(result.recipeId, null);
  } finally {
    await cleanup(trialId);
  }
});

test("an unknown trial id is a no-op", async (t) => {
  if (!(await needsDatabase(t))) return;
  const result = await claimTrialRecipe(newUser(), newTrialId());
  assert.equal(result.claimed, 0);
});

test("a failure partway through moves nothing", async (t) => {
  if (!(await needsDatabase(t))) return;
  const { trialId } = await spentTrial();
  const userId = newUser();
  try {
    await assert.rejects(
      claimTrialRecipe(userId, trialId, {
        beforeAssign: () => {
          throw new Error("boom, partway through");
        },
      }),
      /boom, partway through/
    );

    const after = await rowsFor(trialId);
    assert.equal(after.length, 1, "the recipe is still there");
    assert.equal(after[0].userId, null, "and still unowned, so the retry can find it");

    const retry = await claimTrialRecipe(userId, trialId);
    assert.equal(retry.claimed, 1, "a failed claim is simply retried");
  } finally {
    await cleanup(trialId);
  }
});

test("a claim touches only its own trial", async (t) => {
  if (!(await needsDatabase(t))) return;
  const mine = await spentTrial();
  const bystander = await spentTrial();
  const userId = newUser();
  try {
    await claimTrialRecipe(userId, mine.trialId);
    const other = await rowsFor(bystander.trialId);
    assert.equal(other.length, 1);
    assert.equal(other[0].userId, null, "another browser's trial is not part of this claim");
  } finally {
    await cleanup(mine.trialId);
    await cleanup(bystander.trialId);
  }
});
