/**
 * server/lib/billing/access.db.test.ts — the paywall's arithmetic, against a
 * real Postgres.
 *
 * WHAT THESE EXIST TO CATCH. Every guarantee here is a property of a SQL
 * statement or of how two mechanisms meet, and none is visible against a stub:
 *
 *  - FREE_RECIPES "EVER", not "at a time": deleting must not hand a slot
 *    back, which means the counter is monotonic and not a row count;
 *  - the same count across the whole free experience: a visitor who spends
 *    the pre-signup trial and then signs up has used one of the account's
 *    free recipes, not been given one on top of them;
 *  - the sign-out loophole stays closed: a second trial claimed into an
 *    account that is already full must be refused, not absorbed;
 *  - the kill switch composes in both directions;
 *  - shadow mode records the decision it did not act on, because that log is
 *    the entire basis for deciding it is safe to switch on.
 *
 * No provider is contacted. Subscription rows are written directly, because
 * what is under test is entitlement — not Stripe.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  accessEvents,
  accountAccess,
  coupons,
  couponRedemptions,
  recipes,
  subscriptions,
  trials,
  users,
} from "@workspace/db";
import { needsDatabase } from "../testdb";
import {
  entitlementFor,
  FREE_RECIPES,
  grantRecipes,
  recordRecipeUsed,
  setEnforceOverride,
  spendRecipeAllowance,
} from "./entitlement";
import { logAccess } from "./access";
import { createCoupon, normaliseCode, redeemCoupon } from "./coupons";
import { claimTrialRecipe, trialOwnerKey } from "../trial";

const TABLES = [
  "users",
  "account_access",
  "subscriptions",
  "coupons",
  "coupon_redemptions",
  "access_events",
  "recipes",
  "trials",
];

async function makeUser(): Promise<string> {
  const id = `pay-test-${randomUUID()}`;
  await getDb().insert(users).values({ id, displayName: "Paywall Test" });
  return id;
}

/** Use up every free recipe, the way FREE_RECIPES saves would. */
async function spendAll(userId: string, n = FREE_RECIPES) {
  for (let i = 0; i < n; i++) assert.equal(await spendRecipeAllowance(userId), true);
}

async function cleanup(userId: string) {
  const db = getDb();
  await db.delete(accessEvents).where(eq(accessEvents.userId, userId));
  await db.delete(couponRedemptions).where(eq(couponRedemptions.userId, userId));
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  await db.delete(accountAccess).where(eq(accountAccess.userId, userId));
  await db.delete(recipes).where(eq(recipes.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

test("a fresh account gets exactly three recipes", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    const ent = await entitlementFor(userId);
    // Pinned as a literal: the number is a product decision (Oct 1 2026),
    // not something a refactor may move.
    assert.equal(FREE_RECIPES, 3);
    assert.equal(ent.allowance, FREE_RECIPES);
    assert.equal(ent.used, 0);
    assert.equal(ent.allowed, true);
    assert.equal(ent.reason, "within_allowance");
    assert.equal(ent.subscribed, false);
    // Default OFF. A paywall that ships enforcing is a paywall that ships
    // turning people away before anyone has watched it work.
    assert.equal(ent.enforced, false);
  } finally {
    await cleanup(userId);
  }
});

test("three recipes EVER — deleting does not hand a slot back", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId, FREE_RECIPES - 1);
    assert.equal((await entitlementFor(userId)).reason, "within_allowance", "one still to spend");
    assert.equal(await spendRecipeAllowance(userId), true);
    assert.equal((await entitlementFor(userId)).reason, "exhausted");
    assert.equal(await spendRecipeAllowance(userId), false, "nothing left to spend");

    // The recipe is deleted. A row COUNT would now say zero and let them
    // start again; the monotonic counter is what makes this "ever".
    await getDb().delete(recipes).where(eq(recipes.userId, userId));

    const ent = await entitlementFor(userId);
    assert.equal(ent.used, FREE_RECIPES, "used never decreases");
    assert.equal(ent.allowed, false);
  } finally {
    await cleanup(userId);
  }
});

test("the allowance cannot be spent twice by two concurrent saves", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId, FREE_RECIPES - 1); // the last one is what is raced for
    const [a, b, c] = await Promise.all([
      spendRecipeAllowance(userId),
      spendRecipeAllowance(userId),
      spendRecipeAllowance(userId),
    ]);
    assert.equal([a, b, c].filter(Boolean).length, 1, "exactly one of three wins");
    assert.equal((await entitlementFor(userId)).used, FREE_RECIPES);
  } finally {
    await cleanup(userId);
  }
});

test("a subscription entitles regardless of the counter", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId);
    assert.equal((await entitlementFor(userId)).allowed, false);

    await getDb().insert(subscriptions).values({
      id: randomUUID(),
      userId,
      provider: "stripe",
      provider_ref: `sub_${randomUUID()}`,
      status: "active",
    });

    const ent = await entitlementFor(userId);
    assert.equal(ent.allowed, true);
    assert.equal(ent.reason, "subscribed");
    assert.equal(ent.subscribed, true);
  } finally {
    await cleanup(userId);
  }
});

test("grace entitles; expired does not", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId);
    const ref = `sub_${randomUUID()}`;
    const db = getDb();
    await db.insert(subscriptions).values({
      id: randomUUID(), userId, provider: "stripe", provider_ref: ref, status: "grace",
    });
    // A failed card is usually an expired card, not a decision to leave.
    assert.equal((await entitlementFor(userId)).allowed, true);

    await db.update(subscriptions).set({ status: "expired" })
      .where(eq(subscriptions.provider_ref, ref));
    assert.equal((await entitlementFor(userId)).allowed, false);
  } finally {
    await cleanup(userId);
  }
});

test("entitlement is provider-agnostic — a third provider needs no schema change", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId);
    // 'google_play' is not referenced anywhere in entitlement.ts. If this
    // passes, adding Play later is an adapter and a string — no migration.
    await getDb().insert(subscriptions).values({
      id: randomUUID(),
      userId,
      provider: "google_play",
      provider_ref: `purchase-token-${randomUUID()}`,
      status: "active",
    });
    const ent = await entitlementFor(userId);
    assert.equal(ent.allowed, true);
    assert.equal(ent.provider, "google_play");
  } finally {
    await cleanup(userId);
  }
});

test("two providers on one account: the better one wins", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId);
    const db = getDb();
    // Someone who subscribed on the web before the App Store build, then
    // bought again through IAP. Double-charging is a refund conversation —
    // never a reason to serve them less than they are paying for.
    await db.insert(subscriptions).values({
      id: randomUUID(), userId, provider: "stripe",
      provider_ref: `sub_${randomUUID()}`, status: "expired",
    });
    await db.insert(subscriptions).values({
      id: randomUUID(), userId, provider: "apple",
      provider_ref: `orig-${randomUUID()}`, status: "active",
    });
    const ent = await entitlementFor(userId);
    assert.equal(ent.allowed, true);
    assert.equal(ent.provider, "apple");
  } finally {
    await cleanup(userId);
  }
});

test("the kill switch composes in both directions", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId);
    assert.equal((await entitlementFor(userId)).enforced, false, "global default off");

    // Force it on for one account while the world is still free — the whole
    // point of the per-account override.
    await setEnforceOverride(userId, true);
    assert.equal((await entitlementFor(userId)).enforced, true);

    // And off, for a comp, even once the global flag is on.
    process.env.PAYWALL_ENFORCED = "1";
    try {
      await setEnforceOverride(userId, false);
      assert.equal((await entitlementFor(userId)).enforced, false);
      await setEnforceOverride(userId, null);
      assert.equal((await entitlementFor(userId)).enforced, true, "null follows global");
    } finally {
      delete process.env.PAYWALL_ENFORCED;
    }
  } finally {
    await cleanup(userId);
  }
});

test("shadow mode records the decision it did not act on", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await spendAll(userId);
    const ent = await entitlementFor(userId);
    assert.equal(ent.allowed, false);
    assert.equal(ent.enforced, false);

    await logAccess({
      userId, action: "search", decision: "would_block",
      reason: ent.reason, allowance: ent.allowance, used: ent.used, enforced: false,
    });

    const rows = await getDb().select().from(accessEvents)
      .where(and(eq(accessEvents.userId, userId), eq(accessEvents.decision, "would_block")));
    assert.equal(rows.length, 1, "the wall firing in shadow is a row, not a silence");
    assert.equal(rows[0].reason, "exhausted");
    assert.equal(rows[0].enforced, false);
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// Where the two gates meet: the pre-signup trial and the account allowance.
// ---------------------------------------------------------------------------

async function parkTrialRecipe(trialId: string, recipeId: string) {
  const db = getDb();
  await db.insert(trials).values({ id: trialId, usedAt: new Date(), recipeId });
  await db.insert(recipes).values({
    id: recipeId,
    ownerKey: trialOwnerKey(trialId),
    userId: null,
    recipe: { title: "Trial Recipe", servings: 4, sections: [] },
    done: [],
  });
}

test("one count in total: a trial recipe carried in is one of the account's free recipes", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const trialId = `trial-${randomUUID()}`;
  const recipeId = `r-${randomUUID()}`;
  try {
    await parkTrialRecipe(trialId, recipeId);
    const out = await claimTrialRecipe(userId, trialId);
    assert.equal(out.claimed, 1, "the recipe they already made is theirs");

    const ent = await entitlementFor(userId);
    assert.equal(ent.used, 1);
    assert.equal(ent.allowed, true, "two still to come");
    // The whole point: the trial is one of the three, not a fourth.
    await spendAll(userId, FREE_RECIPES - 1);
    assert.equal(await spendRecipeAllowance(userId), false, "FREE_RECIPES across the WHOLE free experience");
    assert.equal((await entitlementFor(userId)).allowed, false);
  } finally {
    await getDb().delete(trials).where(eq(trials.id, trialId));
    await cleanup(userId);
  }
});

test("the sign-out loophole is closed: a second trial is refused, not absorbed", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const first = `trial-${randomUUID()}`;
  const second = `trial-${randomUUID()}`;
  const r1 = `r-${randomUUID()}`;
  const r2 = `r-${randomUUID()}`;
  try {
    await setEnforceOverride(userId, true); // the wall has teeth for this account
    await parkTrialRecipe(first, r1);
    await parkTrialRecipe(second, r2);

    assert.equal((await claimTrialRecipe(userId, first)).claimed, 1);
    await spendAll(userId, FREE_RECIPES - 1); // the account is now full

    // Sign out, fresh cookie, extract again, sign back in. Without the spend
    // inside the claim transaction this is an unlimited free tier for anyone
    // willing to click "sign out".
    const out = await claimTrialRecipe(userId, second);
    assert.equal(out.claimed, 0);
    assert.equal(out.blocked, true);

    // Refused, NOT deleted — the row stays parked and reclaimable the moment
    // they subscribe.
    const [parked] = await getDb().select().from(recipes)
      .where(and(eq(recipes.ownerKey, trialOwnerKey(second)), eq(recipes.id, r2)));
    assert.ok(parked, "the second recipe is still there");
    assert.equal(parked.userId, null, "and still unowned");

    assert.equal((await entitlementFor(userId)).used, FREE_RECIPES, "and was not charged for");
  } finally {
    const db = getDb();
    await db.delete(recipes).where(eq(recipes.ownerKey, trialOwnerKey(second)));
    await db.delete(trials).where(eq(trials.id, first));
    await db.delete(trials).where(eq(trials.id, second));
    await cleanup(userId);
  }
});

test("with the wall off, an over-allowance claim still counts", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const first = `trial-${randomUUID()}`;
  const second = `trial-${randomUUID()}`;
  const r1 = `r-${randomUUID()}`;
  const r2 = `r-${randomUUID()}`;
  try {
    await parkTrialRecipe(first, r1);
    await parkTrialRecipe(second, r2);
    await claimTrialRecipe(userId, first);
    await spendAll(userId, FREE_RECIPES - 1); // full
    // Flag off: the recipe IS handed over...
    const out = await claimTrialRecipe(userId, second);
    assert.equal(out.claimed, 1);
    // ...and still counted, or flipping the flag later would hand everybody a
    // bonus recipe on top of what they already collected.
    assert.equal((await entitlementFor(userId)).used, FREE_RECIPES + 1);
  } finally {
    const db = getDb();
    await db.delete(trials).where(eq(trials.id, first));
    await db.delete(trials).where(eq(trials.id, second));
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// Coupons: the usage-grant mechanic only.
// ---------------------------------------------------------------------------

test("a recipes coupon raises the allowance and lifts the wall", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const code = normaliseCode(`test-${randomUUID().slice(0, 8)}`);
  try {
    await createCoupon({ code, recipes: 10 });
    await spendAll(userId);
    assert.equal((await entitlementFor(userId)).allowed, false);

    const out = await redeemCoupon(userId, code);
    assert.deepEqual(out, { ok: true, recipes: 10 });

    const ent = await entitlementFor(userId);
    assert.equal(ent.allowance, FREE_RECIPES + 10, "added to the ONE allowance system, not a second one");
    assert.equal(ent.allowed, true);
  } finally {
    const db = getDb();
    await db.delete(couponRedemptions).where(eq(couponRedemptions.code, code));
    await db.delete(coupons).where(eq(coupons.code, code));
    await cleanup(userId);
  }
});

test("codes are typed off stickers, so spacing and case do not matter", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const code = "MEG10TEST";
  try {
    await createCoupon({ code, recipes: 3 });
    const out = await redeemCoupon(userId, "  meg 10 test  ");
    assert.equal(out.ok, true);
  } finally {
    const db = getDb();
    await db.delete(couponRedemptions).where(eq(couponRedemptions.code, code));
    await db.delete(coupons).where(eq(coupons.code, code));
    await cleanup(userId);
  }
});

test("a code is redeemable once per account, even under a double tap", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const code = normaliseCode(`once-${randomUUID().slice(0, 8)}`);
  try {
    await createCoupon({ code, recipes: 5 });
    const results = await Promise.allSettled([
      redeemCoupon(userId, code),
      redeemCoupon(userId, code),
    ]);

    // EVERY attempt must RESOLVE. An earlier version of this assertion only
    // counted the successes, so a second attempt that THREW looked identical
    // to one correctly refused — and it was throwing, because the duplicate
    // key hides on the error's `cause` and the check was matching `.message`.
    // The user saw "Could not redeem that code" instead of "You've already
    // used that code", which is the same defect as the trial_spent prose
    // match this codebase already fixed once.
    for (const r of results) {
      assert.equal(r.status, "fulfilled", "a duplicate redeem must not throw");
    }
    const values = results.map((r) => (r as PromiseFulfilledResult<unknown>).value);
    const ok = values.filter((v) => (v as { ok: boolean }).ok);
    const refused = values.filter((v) => !(v as { ok: boolean }).ok);
    assert.equal(ok.length, 1, "the unique index is the guard, not a read-then-write");
    assert.equal(
      (refused[0] as { code: string }).code,
      "already_redeemed",
      "and the refusal names the actual reason"
    );
    assert.equal((await entitlementFor(userId)).allowance, FREE_RECIPES + 5);
  } finally {
    const db = getDb();
    await db.delete(couponRedemptions).where(eq(couponRedemptions.code, code));
    await db.delete(coupons).where(eq(coupons.code, code));
    await cleanup(userId);
  }
});

test("max redemptions is enforced", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const a = await makeUser();
  const b = await makeUser();
  const code = normaliseCode(`cap-${randomUUID().slice(0, 8)}`);
  try {
    await createCoupon({ code, recipes: 2, maxRedemptions: 1 });
    assert.equal((await redeemCoupon(a, code)).ok, true);
    const second = await redeemCoupon(b, code);
    assert.equal(second.ok, false);
    assert.equal((second as { code: string }).code, "exhausted");
  } finally {
    const db = getDb();
    await db.delete(couponRedemptions).where(eq(couponRedemptions.code, code));
    await db.delete(coupons).where(eq(coupons.code, code));
    await cleanup(a);
    await cleanup(b);
  }
});

test("an expired code is refused", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const code = normaliseCode(`old-${randomUUID().slice(0, 8)}`);
  try {
    await createCoupon({ code, recipes: 2, expiresAt: new Date(Date.now() - 1000) });
    const out = await redeemCoupon(userId, code);
    assert.equal(out.ok, false);
    assert.equal((out as { code: string }).code, "expired");
  } finally {
    const db = getDb();
    await db.delete(couponRedemptions).where(eq(couponRedemptions.code, code));
    await db.delete(coupons).where(eq(coupons.code, code));
    await cleanup(userId);
  }
});

test("deleting an account takes its billing state with it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  await recordRecipeUsed(userId);
  await grantRecipes(userId, 5);
  await getDb().insert(subscriptions).values({
    id: randomUUID(), userId, provider: "stripe",
    provider_ref: `sub_${randomUUID()}`, status: "active",
  });

  await getDb().delete(users).where(eq(users.id, userId));

  const db = getDb();
  assert.equal(
    (await db.select().from(accountAccess).where(eq(accountAccess.userId, userId))).length,
    0
  );
  assert.equal(
    (await db.select().from(subscriptions).where(eq(subscriptions.userId, userId))).length,
    0
  );
});
