/**
 * server/routes/push.ts — subscribe, unsubscribe, and the dispatch trigger.
 *
 * SIGNED IN ONLY, on purpose. A push subscription is a standing permission to
 * interrupt someone's evening; owner_key identifies a browser rather than a
 * person, survives no sign-out, and gives nobody a way to revoke it. So there
 * is deliberately no anonymous path here, and a trial recipe's timer notifies
 * nobody — the trial is a funnel, and this is a reason to finish it.
 */

import { Router, type Request, type Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  deleteSubscription,
  isExpoPushToken,
  pushConfig,
  saveSubscription,
} from "../lib/push";
import { dispatchDueTimers, sweepDispatchedTimers } from "../lib/timerDispatch";

export const pushRouter = Router();

/**
 * What the client needs to call pushManager.subscribe(), or null.
 *
 * Null rather than a 503: the same posture GET /api/auth/providers takes for
 * the Google button. An unconfigured server should make the client HIDE the
 * notifications toggle, not render a control that fails when tapped.
 */
pushRouter.get("/config", (_req: Request, res: Response) => {
  const cfg = pushConfig();
  res.json({ vapidPublicKey: cfg?.publicKey ?? null });
});

/**
 * Two body shapes, one row.
 *
 *   web:    { endpoint: "https://…", keys: { p256dh, auth }, userAgent? }
 *           — PushSubscription.toJSON(), needs the VAPID keys to be set.
 *   native: { expoPushToken: "ExponentPushToken[…]", userAgent? }
 *           — from expo-notifications' getExpoPushTokenAsync(), which needs
 *           the EAS projectId in app.json and a physical device (the iOS
 *           simulator cannot produce one). Needs NO server configuration.
 *
 * The token goes in the `endpoint` column and the key columns are stored
 * empty; push.ts's `subscriptionKind` tells the two apart at send time. The
 * VAPID gate applies to the web shape only — an Expo-only deployment must not
 * 503 the phone because nobody generated web keys.
 */
pushRouter.post("/subscribe", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Sign in first." });

  const { endpoint, keys, userAgent, expoPushToken } = req.body ?? {};
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 256) : null;

  if (expoPushToken !== undefined) {
    // Strict shape check: Expo's service rejects anything else, and it would
    // do so much later, on a timer nobody is watching fail.
    if (typeof expoPushToken !== "string" || !isExpoPushToken(expoPushToken)) {
      return res.status(422).json({ error: "Malformed Expo push token." });
    }
    try {
      await saveSubscription({ userId, endpoint: expoPushToken, p256dh: "", auth: "", userAgent: ua });
      return res.json({ ok: true });
    } catch (e) {
      console.error("[push] expo subscribe failed:", (e as Error).message);
      return res.status(500).json({ error: "Could not save the subscription." });
    }
  }

  if (!pushConfig())
    return res.status(503).json({ error: "Push is not configured." });

  const p256dh = keys?.p256dh;
  const auth = keys?.auth;

  // The shape PushSubscription.toJSON() produces. Anything else is a bug in
  // the caller, and storing a half-formed subscription means a send that
  // fails silently much later.
  if (
    typeof endpoint !== "string" ||
    !/^https:\/\//.test(endpoint) ||
    endpoint.length > 2048 ||
    typeof p256dh !== "string" ||
    typeof auth !== "string"
  ) {
    return res.status(422).json({ error: "Malformed push subscription." });
  }

  try {
    await saveSubscription({ userId, endpoint, p256dh, auth, userAgent: ua });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[push] subscribe failed:", (e as Error).message);
    return res.status(500).json({ error: "Could not save the subscription." });
  }
});

pushRouter.delete("/subscribe", async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== "string")
    return res.status(422).json({ error: "endpoint is required." });
  try {
    // Scoped to the account, so a leaked endpoint string cannot be used to
    // silence someone else's device.
    await deleteSubscription(userId, endpoint);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[push] unsubscribe failed:", (e as Error).message);
    return res.status(500).json({ error: "Could not remove the subscription." });
  }
});

/**
 * The HTTP half of the trigger. See server/lib/timerDispatch.ts for why the
 * work itself is a plain function: an external cron calls this, and a
 * scheduled job that runs a command imports the function instead and pays no
 * cold start.
 *
 * NOT a session route. It is machine-to-machine, so it takes a shared secret
 * in a header — and when that secret is unset the route 404s rather than
 * running unauthenticated, because an open dispatch endpoint lets anyone on
 * the internet drain the retry budget on every pending timer.
 */
export const timersRouter = Router();

/**
 * Constant-time secret compare.
 *
 * timingSafeEqual throws on unequal lengths, so both sides are hashed to a
 * fixed 32 bytes first — that keeps the comparison itself constant-time AND
 * stops the length check from leaking the secret's length, which a bare
 * `a.length !== b.length` guard would.
 */
function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

timersRouter.post("/dispatch", async (req: Request, res: Response) => {
  const expected = process.env.TIMER_DISPATCH_SECRET?.trim();
  if (!expected) return res.status(404).json({ error: "Not found." });

  if (!secretMatches(req.get("x-dispatch-secret"), expected)) {
    return res.status(401).json({ error: "Bad dispatch secret." });
  }

  try {
    const result = await dispatchDueTimers();
    // Cheap, and only when something actually fired — it keeps the table from
    // growing without bound without needing a second trigger.
    if (result.claimed) await sweepDispatchedTimers();
    return res.json(result);
  } catch (e) {
    console.error("[timers] dispatch failed:", (e as Error).message);
    return res.status(500).json({ error: "Dispatch failed." });
  }
});
