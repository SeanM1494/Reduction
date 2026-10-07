/**
 * server/routes/billingGoogle.ts — Google Play's two entry points.
 *
 * `POST /verify` is the Android app, signed in, reporting a purchase it
 * just made so the paywall lifts now. `POST /notifications` is Google's
 * Real-Time Developer Notifications, delivered by a Cloud Pub/Sub push
 * subscription, reporting everything after that. Neither trusts what it
 * is sent: both look the purchase token up with Google and write the row
 * from Google's answer (lib/billing/googlePlay.ts says why), so they
 * converge whichever arrives first.
 *
 * PUB/SUB RETRIES ANYTHING BUT 2xx, until the message's retention runs
 * out. So: 200 for processed and for deliberately ignored (a test, another
 * package, a token that names no account, a body that will never parse),
 * and 500 only when a retry could help — Google unreachable, a database
 * fault.
 *
 * Nothing here names a Play field. What comes back from the adapter is a
 * SubStatus, a date and a user id, as from the other two providers.
 */

import { Router, type Request, type Response } from "express";
import { userIdOf } from "../middleware/session";
import { entitlementFor } from "../lib/billing/entitlement";
import {
  acknowledgePlaySubscription,
  decodePlayNotification,
  fetchPlaySubscription,
  googlePlayConfig,
  namedOwnerOfPlaySubscription,
  rtdnTokenMatches,
  storedOwnerOfPlaySubscription,
  subscriptionFromGoogle,
  upsertGoogleSubscription,
  userIdForPlaySubscription,
} from "../lib/billing/googlePlay";

export const googleBillingRouter = Router();

/** Play's tokens are long runs of letters, digits and a little punctuation.
 *  Anything else is refused before Google is asked. */
const TOKEN_RE = /^[A-Za-z0-9._:-]{10,4096}$/;

/**
 * The app, after a purchase or a restore. Body: { purchaseToken }.
 *
 * Ownership is checked the way the Apple route checks it, and both checks
 * refuse rather than reassign: a purchase that names ANOTHER account is
 * 403, and a token this server already holds for another account is 409.
 */
googleBillingRouter.post("/verify", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });

  const cfg = googlePlayConfig();
  if (!cfg) return res.status(503).json({ error: "Google Play purchases are not available yet." });

  const purchaseToken = (req.body ?? {}).purchaseToken;
  if (typeof purchaseToken !== "string" || !TOKEN_RE.test(purchaseToken))
    return res.status(422).json({ error: "purchaseToken is required." });

  try {
    const looked = await fetchPlaySubscription(cfg, purchaseToken);
    if (!looked.ok) {
      if (looked.kind === "not_found") {
        console.error(`[billing:google:verify] token unknown to Google (${looked.status})`);
        return res.status(400).json({ error: "That purchase could not be verified.", code: "not_found" });
      }
      console.error(`[billing:google:verify] Google unavailable: ${looked.message}`);
      return res.status(502).json({ error: "Google Play could not be reached. Try again in a moment.", code: "unavailable" });
    }
    const sub = looked.sub;

    const named = await namedOwnerOfPlaySubscription(sub);
    const stored = await storedOwnerOfPlaySubscription(purchaseToken);
    if ((named && named !== userId) || (stored && stored !== userId)) {
      console.error(`[billing:google:verify] token belongs to another account (${stored && stored !== userId ? "stored" : "named"})`);
      return res.status(stored && stored !== userId ? 409 : 403).json({
        error: "That purchase belongs to a different account.",
        code: "wrong_account",
      });
    }

    const result = subscriptionFromGoogle(sub, purchaseToken);
    if (result.kind === "pending")
      return res.status(409).json({ error: "That payment has not cleared yet. Your recipes unlock when it does.", code: "pending" });
    if (result.kind === "unknown") {
      console.error(`[billing:google:verify] unknown state ${result.state}`);
      return res.status(422).json({ error: "That purchase could not be verified.", code: "unknown_state" });
    }

    await upsertGoogleSubscription({ userId, facts: result.facts, sub });
    // After the row: an acknowledged purchase the server never recorded is
    // money taken with nothing unlocked, the one order that must not happen.
    const acked = await acknowledgePlaySubscription(cfg, purchaseToken, sub);
    console.log(
      `[billing:google:verify] ${sub.testPurchase ? "test " : ""}purchase → ${result.facts.status}${acked ? " (acknowledged)" : ""}`
    );
    return res.json({ ok: true, entitlement: await entitlementFor(userId) });
  } catch (e) {
    console.error("[billing:google:verify]", (e as Error).message);
    return res.status(500).json({ error: "Could not record that purchase." });
  }
});

/**
 * Real-Time Developer Notifications, as a Pub/Sub push.
 * Body: { message: { data: base64(JSON), messageId }, subscription }.
 *
 * Registered as the push subscription's endpoint:
 *   PUBLIC_BASE_URL/api/billing/google/notifications?token=GOOGLE_PLAY_RTDN_TOKEN
 * Absent (404) unless the adapter AND the token are configured.
 */
googleBillingRouter.post("/notifications", async (req: Request, res: Response) => {
  const cfg = googlePlayConfig();
  if (!cfg || !cfg.rtdnToken) return res.status(404).json({ error: "Not found." });
  if (!rtdnTokenMatches(req.query.token, cfg.rtdnToken)) return res.status(404).json({ error: "Not found." });

  const note = decodePlayNotification(req.body);
  if (!note) {
    console.error("[billing:google:notifications] unreadable message, acknowledged");
    return res.json({ received: true });
  }
  if (note.packageName && note.packageName !== cfg.packageName) {
    console.error(`[billing:google:notifications] for another package (${note.packageName}), ignored`);
    return res.json({ received: true });
  }
  if (note.type === "test" || !note.purchaseToken) {
    console.log(`[billing:google:notifications] ${note.type} acknowledged`);
    return res.json({ received: true });
  }

  try {
    const looked = await fetchPlaySubscription(cfg, note.purchaseToken);
    if (!looked.ok) {
      if (looked.kind === "not_found") {
        console.error(`[billing:google:notifications] ${note.type}: token unknown to Google`);
        return res.json({ received: true });
      }
      console.error(`[billing:google:notifications] Google unavailable: ${looked.message}`);
      return res.status(500).json({ error: "Try again." });
    }
    const sub = looked.sub;
    const userId = await userIdForPlaySubscription(sub, note.purchaseToken);
    if (!userId) {
      // Not worth a retry: Pub/Sub would redeliver it for days. The verify
      // call writes the row when the phone reports the purchase.
      console.error(`[billing:google:notifications] ${note.type}: no account for this token yet`);
      return res.json({ received: true });
    }
    const result = subscriptionFromGoogle(sub, note.purchaseToken);
    if (result.kind === "facts") {
      await upsertGoogleSubscription({ userId, facts: result.facts, sub, notificationType: note.type });
      await acknowledgePlaySubscription(cfg, note.purchaseToken, sub);
      console.log(`[billing:google:notifications] ${note.type} → ${result.facts.status}`);
    } else {
      console.log(`[billing:google:notifications] ${note.type}: ${result.kind}, nothing written`);
    }
    return res.json({ received: true });
  } catch (e) {
    console.error("[billing:google:notifications]", (e as Error).message);
    return res.status(500).json({ error: "Processing failed." });
  }
});
