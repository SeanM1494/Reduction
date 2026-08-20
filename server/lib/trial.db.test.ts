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

import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, recipes, trials, users } from "../../shared/schema";
import { claimTrialRecipe, spendTrial, storeTrialRecipe, trialOwnerKey } from "./trial";
import { needsDatabase as gate } from "./testdb";
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

/** Skips only when there is genuinely no database. A reachable database
 *  missing `trials` THROWS rather than skipping — that exact confusion is
 *  what reported these nine tests as "no reachable DATABASE_URL" while the
 *  library claim's tests passed against the same database in the same
 *  process. See server/lib/testdb.ts. */
const needsDatabase = (t: TestContext) =>
  gate(t, "trials", "recipes", "users", "account_access");

const newTrialId = () => `test-trial-${crypto.randomUUID()}`;

/**
 * A REAL account row, not just an id string.
 *
 * These used to be bare uuids that existed nowhere, which worked until the
 * claim started spending the account's recipe allowance — `account_access`
 * has a foreign key onto `users`, so a claim for a user who does not exist
 * now fails loudly. That is the right behaviour (the claim only ever runs
 * after sign-in, so the row is always there in production) and the fixture
 * was the thing being unrealistic.
 */
const mintedUsers = new Set<string>();

async function newUser(): Promise<string> {
  const id = `test-user-${crypto.randomUUID()}`;
  await getDb().insert(users).values({ id, displayName: "Trial Test" });
  mintedUsers.add(id);
  return id;
}

/**
 * Every account this suite minted, removed at the end.
 *
 * Tracked in a set rather than cleaned per test because a claim moves a
 * recipe INTO an account, so the teardown has to outlive the test that
 * created it. A suite that leaves rows behind is the thing CLAUDE.md records
 * happening once already.
 */
after(async () => {
  // Nothing minted means every test skipped, which on a machine with no
  // Postgres is the normal outcome — and getDb() THROWS there. An after hook
  // that ignores this turns "no database" from a clean skip into a suite
  // failure, which is exactly the confusion server/lib/testdb.ts exists to
  // prevent.
  if (!mintedUsers.size) return;
  const db = getDb();
  for (const id of mintedUsers) {
    await db.delete(accountAccess).where(eq(accountAccess.userId, id));
    await db.delete(recipes).where(eq(recipes.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  mintedUsers.clear();
});

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
  const userId = await newUser();
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
  const userId = await newUser();
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
  const first = await newUser();
  const second = await newUser();
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
  const userId = await newUser();
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
  const userId = await newUser();
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
  const result = await claimTrialRecipe(await newUser(), newTrialId());
  assert.equal(result.claimed, 0);
});

test("a failure partway through moves nothing", async (t) => {
  if (!(await needsDatabase(t))) return;
  const { trialId } = await spentTrial();
  const userId = await newUser();
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
  const userId = await newUser();
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
