/**
 * server/lib/timerDispatch.ts — "this timer is done, tell every device."
 *
 * THE WAKE-UP IS NOT DECIDED HERE, AND THAT IS THE POINT. Replit's published
 * deployment is Autoscale, which scales to zero — so nothing in this process
 * is awake at 19:42 to notice that a 19:42 timer has come due. The fix is a
 * trigger, and the candidates differ by an order of magnitude in cost and in
 * accuracy (an always-on Reserved VM can arm an exact setTimeout; any cron
 * floors at its interval). So `dispatchDueTimers` is a plain async function
 * with no scheduler in it, reachable three ways:
 *
 *   - `startTimerDispatch()` below, an in-process interval.
 *   - `POST /api/timers/dispatch`, for an external cron.
 *   - imported and called directly by a scheduled job that runs a command
 *     rather than making a request, which needs no shared secret and pays no
 *     cold start.
 *
 * Changing the trigger must never mean rewriting this file.
 *
 * WHAT IS ACTUALLY WIRED TODAY IS THE FIRST ONE, AND IT IS A BANDAID.
 * The interval only runs while the process happens to be alive — which on
 * Autoscale means while the app is being used, plus whatever keep-warm window
 * follows. A timer that comes due while the deployment is asleep fires when
 * someone next opens the app, which is exactly what happens today anyway. So
 * this buys something real (a timer completing while you are cooking now
 * reaches every device on the account, and reaches a phone whose screen is
 * off) without buying the thing the feature is ultimately for, and without
 * paying to keep anything awake on purpose.
 *
 * It is deliberately NOT dressed up as the real fix. The honest limitation is
 * stated to the user in client/src/components/NotificationSetting.tsx, and
 * ROADMAP still carries this as open with the two paid options costed.
 *
 * CLAIM BEFORE SEND, NOT AFTER. `claimDueTimers` stamps `notified_at` inside
 * the same statement that selects the rows, with SKIP LOCKED, so two
 * dispatchers racing — an interval and a cron hitting the endpoint in the
 * same second — cannot both take the same timer. The cost is that a crash
 * between the claim and the send drops that notification. That is the right
 * way round: this table's rows are individually worth little, the failure is
 * rare and bounded, and the alternative (send, then mark) turns every
 * mid-batch crash into a device buzzing about the same pan on every
 * subsequent pass. A bounded retry covers the transient case; see below.
 */

import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { timerNotifications } from "../../shared/schema";
import {
  dropDeadSubscription,
  pushConfig,
  sendPush,
  subscriptionsFor,
  type TimerPayload,
} from "./push";

/** How many timers one pass will take. A kitchen-sized app will never reach
 *  this; it exists so a backlog after downtime drains in passes rather than
 *  in one unbounded query. */
const BATCH = 100;

/** A send that fails transiently is retried on later passes, but not
 *  forever: a timer nobody could be told about half an hour ago is not worth
 *  telling anyone about now. */
const MAX_ATTEMPTS = 3;

export interface DispatchResult {
  claimed: number;
  sent: number;
  /** Subscriptions the push service reported as permanently gone. */
  pruned: number;
  /** Timers released back for a later attempt. */
  retried: number;
  /** Timers given up on after MAX_ATTEMPTS. */
  abandoned: number;
}

const EMPTY: DispatchResult = {
  claimed: 0,
  sent: 0,
  pruned: 0,
  retried: 0,
  abandoned: 0,
};

interface ClaimedTimer {
  id: string;
  userId: string;
  recipeId: string;
  stepId: string;
  stepLabel: string | null;
  recipeTitle: string | null;
  attempts: number;
}

/**
 * Take up to BATCH due timers atomically.
 *
 * WHAT ACTUALLY PREVENTS A DOUBLE BUZZ is that this is ONE statement. The
 * claim and the selection happen together, so `notified_at is null` is
 * evaluated against rows this statement is already locking. The obvious
 * alternative — SELECT the due rows, then UPDATE them — loses: measured on
 * this schema with three concurrent callers and 12 due timers, it claimed
 * each one three times, which is three devices buzzing three times for one
 * pan.
 *
 * SKIP LOCKED is NOT what provides that guarantee, and it is worth being
 * precise because the natural assumption is that it is. Under READ COMMITTED
 * a plain FOR UPDATE is equally correct here: the second dispatcher blocks,
 * then re-evaluates the predicate and finds the rows claimed. What SKIP
 * LOCKED buys is throughput — the second dispatcher moves on to other rows
 * instead of waiting on the first — which matters precisely because the
 * trigger is pluggable and an interval may overlap a cron hitting the
 * endpoint in the same second.
 */
export async function claimDueTimers(limit = BATCH): Promise<ClaimedTimer[]> {
  const rows = await getDb().execute(sql`
    update timer_notifications
       set notified_at = now(), attempts = attempts + 1
     where id in (
       select id from timer_notifications
        where ends_at <= now() and notified_at is null
        order by ends_at
        limit ${limit}
        for update skip locked
     )
    returning id, user_id, recipe_id, step_id, step_label, recipe_title, attempts
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    recipeId: String(r.recipe_id),
    stepId: String(r.step_id),
    stepLabel: r.step_label == null ? null : String(r.step_label),
    recipeTitle: r.recipe_title == null ? null : String(r.recipe_title),
    attempts: Number(r.attempts),
  }));
}

/** Put a claimed timer back, so a later pass retries it. */
async function releaseTimer(id: string): Promise<void> {
  await getDb()
    .update(timerNotifications)
    .set({ notifiedAt: null })
    .where(eq(timerNotifications.id, id));
}

function payloadFor(t: ClaimedTimer): TimerPayload {
  return {
    kind: "timer",
    // The recipe is the title because that is what identifies it on a lock
    // screen showing three notifications; the step is the body because that
    // is what the cook has to go and do.
    title: t.recipeTitle ?? "Timer done",
    body: t.stepLabel ? `Time's up — ${t.stepLabel}` : "Your timer is done.",
    recipeId: t.recipeId,
    stepId: t.stepId,
  };
}

/**
 * One pass. Safe to call concurrently with itself.
 *
 * A user with no subscriptions is not a failure — they never turned
 * notifications on, or removed the web app. The claim stands and the row is
 * consumed rather than retried, because there is nobody to tell.
 */
export async function dispatchDueTimers(): Promise<DispatchResult> {
  if (!pushConfig()) return { ...EMPTY };

  const claimed = await claimDueTimers();
  if (!claimed.length) return { ...EMPTY };

  const result: DispatchResult = { ...EMPTY, claimed: claimed.length };

  for (const timer of claimed) {
    const targets = await subscriptionsFor(timer.userId);
    if (!targets.length) continue;

    const payload = payloadFor(timer);
    let delivered = 0;
    let transient = 0;

    for (const target of targets) {
      const outcome = await sendPush(target, payload);
      if (outcome === "sent") delivered++;
      else if (outcome === "gone") {
        await dropDeadSubscription(target.endpoint);
        result.pruned++;
      } else if (outcome === "failed") transient++;
    }

    result.sent += delivered;

    // Only retry when NOTHING got through and the failure looked transient.
    // One device out of three failing is not a reason to buzz the other two
    // again on the next pass.
    if (delivered === 0 && transient > 0) {
      if (timer.attempts < MAX_ATTEMPTS) {
        await releaseTimer(timer.id);
        result.retried++;
      } else {
        result.abandoned++;
      }
    }
  }

  return result;
}

/**
 * Delete claimed rows that have been sitting around. Keeps the table from
 * growing without bound; the partial index means they cost nothing to query
 * past, but they are still storage and still user data.
 */
export async function sweepDispatchedTimers(olderThanMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await getDb()
    .delete(timerNotifications)
    .where(
      and(
        sql`${timerNotifications.notifiedAt} is not null`,
        lt(timerNotifications.notifiedAt, cutoff)
      )
    )
    .returning({ id: timerNotifications.id });
  return rows.length;
}

/** Schedule (or replace) the pending notification for one recipe's timer. */
export async function scheduleTimer(params: {
  userId: string;
  recipeId: string;
  stepId: string;
  stepLabel: string | null;
  recipeTitle: string | null;
  endsAt: Date;
}): Promise<void> {
  await getDb()
    .insert(timerNotifications)
    .values({
      id: randomUUID(),
      userId: params.userId,
      recipeId: params.recipeId,
      stepId: params.stepId,
      stepLabel: params.stepLabel,
      recipeTitle: params.recipeTitle,
      endsAt: params.endsAt,
    })
    .onConflictDoUpdate({
      target: [timerNotifications.userId, timerNotifications.recipeId],
      set: {
        stepId: params.stepId,
        stepLabel: params.stepLabel,
        recipeTitle: params.recipeTitle,
        endsAt: params.endsAt,
        // Restarting a timer un-claims the row: this is a new timer, and the
        // previous one's delivery has nothing to say about it.
        notifiedAt: null,
        attempts: 0,
      },
    });
}

/** Cancel — a timer cleared, or the recipe holding it deleted. */
export async function cancelTimer(
  userId: string,
  recipeId: string
): Promise<void> {
  await getDb()
    .delete(timerNotifications)
    .where(
      and(
        eq(timerNotifications.userId, userId),
        eq(timerNotifications.recipeId, recipeId)
      )
    );
}

/**
 * How often the in-process trigger looks for due timers.
 *
 * 30s, not 1s: this only ever runs while the process is already up serving
 * something else, so the cost is one indexed query against a partial index
 * that is empty almost every time. Half a minute late on a braise is
 * invisible, and the case where a second would matter — a 90-second sauté —
 * is a case nobody walks away from, so the app is open and StepsMode's own
 * countdown has already said so.
 */
const DISPATCH_EVERY_MS = 30_000;

/**
 * Start the in-process trigger. Returns a stop function.
 *
 * Deliberately the same shape as startSessionSweep in server/lib/sessions.ts,
 * including the unref: a background interval must never be the reason the
 * process stays alive, which matters for tests and for a clean shutdown — and
 * matters more here, because on Autoscale holding the process open is
 * literally the thing that costs money.
 *
 * Does nothing when push is unconfigured, and says so once rather than
 * waking up every 30 seconds to discover it again.
 */
export function startTimerDispatch(): () => void {
  if (!pushConfig()) {
    console.log("[timers] push is not configured — dispatch not started.");
    return () => {};
  }

  const pass = async () => {
    try {
      const r = await dispatchDueTimers();
      if (r.claimed) {
        console.log(
          `[timers] ${r.claimed} due, ${r.sent} sent` +
            (r.pruned ? `, ${r.pruned} dead subscription(s) dropped` : "") +
            (r.retried ? `, ${r.retried} retried` : "") +
            (r.abandoned ? `, ${r.abandoned} abandoned` : "")
        );
        await sweepDispatchedTimers();
      }
    } catch (e) {
      // A database blip must not kill the interval — the next pass retries,
      // and the claim is idempotent by construction.
      console.error("[timers] dispatch skipped:", (e as Error).message);
    }
  };

  // One immediately: a cold start is exactly when a backlog is waiting, since
  // by definition nothing was awake to send it.
  void pass();
  const timer = setInterval(pass, DISPATCH_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
