/**
 * server/lib/push.db.test.ts — subscriptions and the dispatcher, against a
 * real Postgres.
 *
 * WHY THIS NEEDS A DATABASE RATHER THAN A FAKE. Every guarantee here is a
 * property of a SQL statement, and none of them is visible against a stub:
 *
 *  - the claim is atomic (`for update skip locked`), so two dispatchers
 *    racing cannot both take the same timer and buzz someone's phone twice;
 *  - the subscription upsert keys on `endpoint`, so a device that reopens the
 *    app fifty times leaves one row and not fifty;
 *  - deleting an account takes its subscriptions and its pending buzzes with
 *    it, via ON DELETE CASCADE — a permission to interrupt someone must not
 *    outlive the account it was granted to;
 *  - one timer fans out to every device on the account.
 *
 * The push service itself is never contacted: `sendPush` is not called here
 * at all. What is proven is the claim/fan-out/cleanup logic around it. Actual
 * delivery to an iPhone cannot be tested from CI and has to be checked by
 * hand on a real device — see CLAUDE.md.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { pushSubscriptions, timerNotifications, users } from "../../shared/schema";
import { needsDatabase } from "./testdb";
import {
  deleteSubscription,
  dropDeadSubscription,
  saveSubscription,
  subscriptionsFor,
} from "./push";
import { cancelTimer, claimDueTimers, scheduleTimer, sweepDispatchedTimers } from "./timerDispatch";

const TABLES = ["users", "push_subscriptions", "timer_notifications"];

/** Each test mints its own account, so nothing can collide with anything —
 *  including a real row, if this is ever pointed somewhere it should not be. */
async function makeUser(): Promise<string> {
  const id = `push-test-${randomUUID()}`;
  await getDb().insert(users).values({ id, displayName: "Push Test" });
  return id;
}

async function cleanup(userId: string): Promise<void> {
  // The cascade should do this, but the suite must not depend on the thing
  // one of its own tests is asserting.
  await getDb().delete(timerNotifications).where(eq(timerNotifications.userId, userId));
  await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await getDb().delete(users).where(eq(users.id, userId));
}

const sub = (userId: string, n: number) => ({
  userId,
  endpoint: `https://push-test.invalid/${userId}/${n}`,
  p256dh: `p256dh-${n}`,
  auth: `auth-${n}`,
});

test("a device re-subscribing updates its row instead of adding one", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await saveSubscription({ ...sub(userId, 1), userAgent: "first" });
    await saveSubscription({ ...sub(userId, 1), userAgent: "second" });
    await saveSubscription({ ...sub(userId, 1), userAgent: "third" });

    const rows = await subscriptionsFor(userId);
    assert.equal(rows.length, 1, "one endpoint is one row, however many times it subscribes");

    const [stored] = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, sub(userId, 1).endpoint));
    assert.equal(stored.userAgent, "third", "the latest subscribe wins");
  } finally {
    await cleanup(userId);
  }
});

test("a resubscribe revives a row an earlier failure had condemned", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await saveSubscription(sub(userId, 1));
    await getDb()
      .update(pushSubscriptions)
      .set({ failedAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, sub(userId, 1).endpoint));

    await saveSubscription(sub(userId, 1));
    const [stored] = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, sub(userId, 1).endpoint));
    assert.equal(stored.failedAt, null);
  } finally {
    await cleanup(userId);
  }
});

test("one account, many devices — a timer reaches all of them", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await saveSubscription(sub(userId, 1));
    await saveSubscription(sub(userId, 2));
    await saveSubscription(sub(userId, 3));
    const targets = await subscriptionsFor(userId);
    assert.equal(targets.length, 3, "the phone in the kitchen is the one you are not holding");
    // Every target carries what sendPush needs; a half-formed row would fail
    // silently at send time, months later.
    for (const t2 of targets) {
      assert.ok(t2.endpoint && t2.p256dh && t2.auth);
    }
  } finally {
    await cleanup(userId);
  }
});

test("unsubscribing is scoped to the account", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const mine = await makeUser();
  const theirs = await makeUser();
  try {
    await saveSubscription(sub(theirs, 1));
    // Same endpoint string, wrong account: a leaked endpoint must not let
    // anyone silence someone else's phone.
    await deleteSubscription(mine, sub(theirs, 1).endpoint);
    assert.equal((await subscriptionsFor(theirs)).length, 1);

    await deleteSubscription(theirs, sub(theirs, 1).endpoint);
    assert.equal((await subscriptionsFor(theirs)).length, 0);
  } finally {
    await cleanup(mine);
    await cleanup(theirs);
  }
});

test("a dead endpoint is dropped for whoever holds it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await saveSubscription(sub(userId, 1));
    // 404/410 from the push service is not about one account — the endpoint
    // is gone.
    await dropDeadSubscription(sub(userId, 1).endpoint);
    assert.equal((await subscriptionsFor(userId)).length, 0);
  } finally {
    await cleanup(userId);
  }
});

test("deleting an account takes its subscriptions and pending timers with it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  await saveSubscription(sub(userId, 1));
  await scheduleTimer({
    userId,
    recipeId: "r1",
    stepId: "s1",
    stepLabel: "simmer",
    recipeTitle: "Stock",
    endsAt: new Date(Date.now() + 60_000),
  });

  await getDb().delete(users).where(eq(users.id, userId));

  const subs = await getDb()
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  const timers = await getDb()
    .select()
    .from(timerNotifications)
    .where(eq(timerNotifications.userId, userId));
  assert.equal(subs.length, 0, "a permission to interrupt must not outlive the account");
  assert.equal(timers.length, 0);
});

test("starting a second timer on one recipe replaces the first", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    const first = new Date(Date.now() + 60_000);
    const second = new Date(Date.now() + 900_000);
    await scheduleTimer({ userId, recipeId: "r1", stepId: "s1", stepLabel: "a", recipeTitle: "T", endsAt: first });
    await scheduleTimer({ userId, recipeId: "r1", stepId: "s2", stepLabel: "b", recipeTitle: "T", endsAt: second });

    const rows = await getDb()
      .select()
      .from(timerNotifications)
      .where(eq(timerNotifications.userId, userId));
    assert.equal(rows.length, 1, "one live timer per recipe, mirroring recipes.timer");
    assert.equal(rows[0].stepId, "s2");
    assert.equal(rows[0].endsAt?.getTime(), second.getTime());
  } finally {
    await cleanup(userId);
  }
});

test("re-arming clears a previous claim, so the new timer still fires", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await scheduleTimer({ userId, recipeId: "r1", stepId: "s1", stepLabel: "a", recipeTitle: "T",
      endsAt: new Date(Date.now() - 1000) });
    const claimed = await claimDueTimers();
    assert.equal(claimed.filter((c) => c.userId === userId).length, 1);

    // Same recipe, timer started again. The old row is claimed; if the upsert
    // did not reset notified_at the new timer would never fire.
    await scheduleTimer({ userId, recipeId: "r1", stepId: "s1", stepLabel: "a", recipeTitle: "T",
      endsAt: new Date(Date.now() - 1000) });
    const again = await claimDueTimers();
    assert.equal(again.filter((c) => c.userId === userId).length, 1, "a restarted timer is unclaimed again");
  } finally {
    await cleanup(userId);
  }
});

test("a timer in the future is not claimed", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await scheduleTimer({ userId, recipeId: "r1", stepId: "s1", stepLabel: "a", recipeTitle: "T",
      endsAt: new Date(Date.now() + 3_600_000) });
    const claimed = await claimDueTimers();
    assert.equal(claimed.filter((c) => c.userId === userId).length, 0);
  } finally {
    await cleanup(userId);
  }
});

test("cancelling removes the pending buzz", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await scheduleTimer({ userId, recipeId: "r1", stepId: "s1", stepLabel: "a", recipeTitle: "T",
      endsAt: new Date(Date.now() - 1000) });
    await cancelTimer(userId, "r1");
    const claimed = await claimDueTimers();
    assert.equal(claimed.filter((c) => c.userId === userId).length, 0);
  } finally {
    await cleanup(userId);
  }
});

/**
 * THE ONE THAT MATTERS MOST.
 *
 * Two dispatchers running at once is not hypothetical: an in-process interval
 * and a cron hitting /api/timers/dispatch can land in the same second, and
 * that is precisely the configuration the pluggable trigger invites.
 *
 * This test has teeth, and it was checked rather than assumed: the naive
 * implementation — SELECT the due rows, then UPDATE them — claims each of
 * these 12 timers THREE times under the same three concurrent callers.
 * Measured, not reasoned about. What it does NOT distinguish is `for update`
 * from `for update skip locked`, because both are correct here; see the note
 * on claimDueTimers for which clause earns its place and why.
 */
test("two dispatchers racing claim each timer exactly once", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    const past = new Date(Date.now() - 1000);
    for (let i = 0; i < 12; i++) {
      await scheduleTimer({ userId, recipeId: `r${i}`, stepId: `s${i}`, stepLabel: `step ${i}`,
        recipeTitle: "T", endsAt: past });
    }

    // Genuinely concurrent, not sequential — the point is the interleave.
    const [a, b, c] = await Promise.all([
      claimDueTimers(),
      claimDueTimers(),
      claimDueTimers(),
    ]);

    const mine = [...a, ...b, ...c].filter((x) => x.userId === userId);
    const ids = mine.map((x) => x.id);
    assert.equal(ids.length, 12, "every timer is claimed");
    assert.equal(new Set(ids).size, 12, "and none of them twice");

    // A fourth pass finds nothing: they are all claimed now.
    const after = await claimDueTimers();
    assert.equal(after.filter((x) => x.userId === userId).length, 0);
  } finally {
    await cleanup(userId);
  }
});

test("the claim records an attempt, so a retry can be bounded", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await scheduleTimer({ userId, recipeId: "r1", stepId: "s1", stepLabel: "a", recipeTitle: "T",
      endsAt: new Date(Date.now() - 1000) });
    const [claimed] = (await claimDueTimers()).filter((x) => x.userId === userId);
    assert.equal(claimed.attempts, 1);

    // Released back the way dispatchDueTimers does on a transient failure.
    await getDb()
      .update(timerNotifications)
      .set({ notifiedAt: null })
      .where(eq(timerNotifications.id, claimed.id));
    const [again] = (await claimDueTimers()).filter((x) => x.userId === userId);
    assert.equal(again.attempts, 2, "attempts accumulate across retries rather than resetting");
  } finally {
    await cleanup(userId);
  }
});

test("the sweep removes dispatched rows and leaves pending ones", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  try {
    await scheduleTimer({ userId, recipeId: "old", stepId: "s1", stepLabel: "a", recipeTitle: "T",
      endsAt: new Date(Date.now() - 1000) });
    await scheduleTimer({ userId, recipeId: "pending", stepId: "s2", stepLabel: "b", recipeTitle: "T",
      endsAt: new Date(Date.now() + 3_600_000) });
    await claimDueTimers();
    // Backdate the claim past the retention window.
    await getDb()
      .update(timerNotifications)
      .set({ notifiedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) })
      .where(eq(timerNotifications.recipeId, "old"));

    await sweepDispatchedTimers();

    const left = await getDb()
      .select()
      .from(timerNotifications)
      .where(eq(timerNotifications.userId, userId));
    assert.equal(left.length, 1, "a pending timer is never swept");
    assert.equal(left[0].recipeId, "pending");
  } finally {
    await cleanup(userId);
  }
});
