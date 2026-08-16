/**
 * server/lib/claim.db.test.ts — the half of the claim contract that needs a
 * real Postgres.
 *
 * planClaim's collision rules are covered in claim.test.ts without a database.
 * What cannot be covered there is the guarantee that actually protects
 * someone's recipes: all rows move or none do. A rollback is a property of the
 * transaction, not of the plan, so it has to be asserted against a database
 * that can actually roll one back — including the live partial unique index on
 * (user_id, id), which is what the re-keying exists to satisfy.
 *
 * These skip when DATABASE_URL is unset or unreachable, so `npm test` stays
 * green on a machine with no database. They are not optional in CI or before
 * a release: a skipped rollback test proves nothing.
 *
 * Every test works inside its own random owner key and user id and deletes
 * what it made, so this is safe to point at a development database.
 */

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { recipes } from "../../shared/schema";
import { claimAnonymousLibrary } from "./claim";
import type { Recipe } from "../../shared/layout";

/** Shape is irrelevant here — nothing in the claim path reads the recipe. */
const STUB_RECIPE = {
  title: "Test",
  servings: 1,
  sections: [
    {
      name: "Test",
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
    await getDb().select({ id: recipes.id }).from(recipes).limit(1);
    return (reachable = true);
  } catch {
    return (reachable = false);
  }
}

/** Returns false and marks the test skipped when there is nothing to talk to. */
async function needsDatabase(t: TestContext): Promise<boolean> {
  if (await hasDatabase()) return true;
  t.skip("no reachable DATABASE_URL");
  return false;
}

async function seed(ownerKey: string, rows: Array<{ id: string; userId?: string }>) {
  const db = getDb();
  for (const row of rows) {
    await db.insert(recipes).values({
      id: row.id,
      ownerKey,
      userId: row.userId ?? null,
      recipe: STUB_RECIPE,
      done: [],
    });
  }
}

async function rowsFor(ownerKey: string) {
  const db = getDb();
  return db
    .select({ id: recipes.id, userId: recipes.userId })
    .from(recipes)
    .where(eq(recipes.ownerKey, ownerKey));
}

async function cleanup(ownerKey: string) {
  const db = getDb();
  await db.delete(recipes).where(eq(recipes.ownerKey, ownerKey));
}

const newKey = () => `test-owner-${crypto.randomUUID()}`;
const newUser = () => `test-user-${crypto.randomUUID()}`;

test("a claim moves every anonymous row and leaves nothing behind", async (t) => {
  if (!(await needsDatabase(t))) return;
  const ownerKey = newKey();
  const userId = newUser();
  try {
    await seed(ownerKey, [{ id: "a" }, { id: "b" }, { id: "c" }]);

    const result = await claimAnonymousLibrary(userId, ownerKey);
    assert.equal(result.moved, 3);
    assert.equal(result.remaining, 0, "remaining must be 0 or the client will not mark the key claimed");
    assert.equal(result.rekeyed, 0);

    const after = await rowsFor(ownerKey);
    assert.equal(after.length, 3);
    assert.ok(after.every((r) => r.userId === userId));
  } finally {
    await cleanup(ownerKey);
  }
});

test("claiming twice is idempotent", async (t) => {
  if (!(await needsDatabase(t))) return;
  const ownerKey = newKey();
  const userId = newUser();
  try {
    await seed(ownerKey, [{ id: "a" }, { id: "b" }]);
    await claimAnonymousLibrary(userId, ownerKey);

    const second = await claimAnonymousLibrary(userId, ownerKey);
    assert.equal(second.moved, 0, "a repeat claim has nothing left to move");
    assert.equal(second.remaining, 0);

    const after = await rowsFor(ownerKey);
    assert.equal(after.length, 2, "and must not duplicate what it already moved");
  } finally {
    await cleanup(ownerKey);
  }
});

test("rows belonging to another user are never taken", async (t) => {
  if (!(await needsDatabase(t))) return;
  const ownerKey = newKey();
  const mine = newUser();
  const theirs = newUser();
  try {
    await seed(ownerKey, [{ id: "mine" }, { id: "theirs", userId: theirs }]);

    const result = await claimAnonymousLibrary(mine, ownerKey);
    assert.equal(result.moved, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.remaining, 0, "someone else's row is not work left outstanding");

    const after = await rowsFor(ownerKey);
    const stolen = after.find((r) => r.id === "theirs");
    assert.equal(stolen?.userId, theirs, "a shared or guessed owner key must not transfer ownership");
  } finally {
    await cleanup(ownerKey);
  }
});

test("a colliding id is re-keyed rather than violating the unique index", async (t) => {
  if (!(await needsDatabase(t))) return;
  // Two owner keys, as two devices: the account already holds "dup" from the
  // first, and the second arrives carrying its own "dup".
  const firstKey = newKey();
  const secondKey = newKey();
  const userId = newUser();
  try {
    await seed(firstKey, [{ id: "dup", userId }]);
    await seed(secondKey, [{ id: "dup" }, { id: "fine" }]);

    const result = await claimAnonymousLibrary(userId, secondKey);
    assert.equal(result.moved, 2);
    assert.equal(result.rekeyed, 1);
    assert.equal(result.remaining, 0);

    const after = await rowsFor(secondKey);
    const ids = after.map((r) => r.id).sort();
    assert.ok(ids.includes("fine"), "the non-colliding row keeps its id");
    assert.ok(!ids.includes("dup"), "the colliding row was given a new id");
    assert.ok(after.every((r) => r.userId === userId), "both rows still arrived");
  } finally {
    await cleanup(firstKey);
    await cleanup(secondKey);
  }
});

test("a failure partway through moves nothing at all", async (t) => {
  if (!(await needsDatabase(t))) return;
  // The whole reason the claim is one transaction. Without it, the rows that
  // moved before the failure would be in the account and the rest outside it,
  // with the retry unable to tell the difference.
  const ownerKey = newKey();
  const userId = newUser();
  try {
    await seed(ownerKey, [{ id: "a" }, { id: "b" }, { id: "c" }]);

    await assert.rejects(
      claimAnonymousLibrary(userId, ownerKey, {
        beforeMove: (_move, index) => {
          if (index === 1) throw new Error("boom, partway through");
        },
      }),
      /boom, partway through/
    );

    const after = await rowsFor(ownerKey);
    assert.equal(after.length, 3, "no row may be lost by the rollback");
    assert.ok(
      after.every((r) => r.userId === null),
      "every row must still be anonymous — including the one that had already been updated"
    );
    assert.deepEqual(
      after.map((r) => r.id).sort(),
      ["a", "b", "c"],
      "and must still carry its original id"
    );
  } finally {
    await cleanup(ownerKey);
  }
});

test("a failed claim can simply be retried", async (t) => {
  if (!(await needsDatabase(t))) return;
  const ownerKey = newKey();
  const userId = newUser();
  try {
    await seed(ownerKey, [{ id: "a" }, { id: "b" }]);

    await assert.rejects(
      claimAnonymousLibrary(userId, ownerKey, {
        beforeMove: () => {
          throw new Error("first attempt fails");
        },
      })
    );

    const retry = await claimAnonymousLibrary(userId, ownerKey);
    assert.equal(retry.moved, 2, "the retry finds exactly what the failed attempt left");
    assert.equal(retry.remaining, 0);

    const after = await rowsFor(ownerKey);
    assert.ok(after.every((r) => r.userId === userId));
  } finally {
    await cleanup(ownerKey);
  }
});

test("a claim only touches its own owner key", async (t) => {
  if (!(await needsDatabase(t))) return;
  const claimed = newKey();
  const bystander = newKey();
  const userId = newUser();
  try {
    await seed(claimed, [{ id: "a" }]);
    await seed(bystander, [{ id: "a" }]);

    await claimAnonymousLibrary(userId, claimed);

    const untouched = await rowsFor(bystander);
    assert.equal(untouched.length, 1);
    assert.equal(untouched[0].userId, null, "another browser's library is not part of this claim");
    assert.equal(untouched[0].id, "a");
  } finally {
    await cleanup(claimed);
    await cleanup(bystander);
  }
});
