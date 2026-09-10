/**
 * server/routes/billingApple.ts — the App Store's two entry points.
 *
 * `POST /verify` is the app, signed in, reporting a purchase it just made so
 * the paywall lifts now rather than when Apple's notification lands.
 * `POST /notifications` is Apple, reporting everything after that. Both are
 * signature-verified against Apple's roots (no shared secret exists for
 * either — the JWS is the proof) and both end in the same upsert, so they
 * converge whichever arrives first.
 *
 * NOT GATED BY SESSION, in the notifications case, and gated by NOTHING BUT
 * THE SIGNATURE — which is why the route 404s when the adapter is not
 * configured. An unconfigured verifier cannot tell Apple from anyone, and an
 * open endpoint that writes subscriptions is a way to grant yourself one.
 *
 * APPLE RETRIES ON ANYTHING BUT 200. So: 200 for processed, 200 for
 * deliberately ignored (a TEST, a type this app does not act on, an account
 * it cannot name), 400 for a payload that will never verify however often it
 * is resent, and 500 only for a fault that a retry could fix.
 *
 * Nothing here names an Apple field. Every Apple-shaped value is consumed in
 * lib/billing/apple.ts and what comes back is a SubStatus, a date and a user
 * id — the same vocabulary the Stripe webhook ends in.
 */

import { Router, type Request, type Response } from "express";
import { userIdOf } from "../middleware/session";
import { entitlementFor } from "../lib/billing/entitlement";
import {
  appleIapConfig,
  appleVerifier,
  describeVerificationFailure,
  fetchAppleSubscriptionStatus,
  storedOwnerOfAppleSubscription,
  subscriptionFromApple,
  upsertAppleSubscription,
  userIdForAppleTransaction,
} from "../lib/billing/apple";

export const appleBillingRouter = Router();

/** A JWS is three base64url segments. Anything else is refused before it
 *  reaches the verifier, whose own error for garbage is less helpful. */
const JWS_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_JWS = 64 * 1024;
const looksLikeJws = (s: unknown): s is string =>
  typeof s === "string" && s.length <= MAX_JWS && JWS_RE.test(s);

/**
 * The app, after a purchase or a restore.
 *
 * Body: { signedTransactionInfo, signedRenewalInfo? } — StoreKit 2's
 * `Transaction.jwsRepresentation` and `RenewalInfo.jwsRepresentation`.
 *
 * Ownership is checked two ways, and both refuse rather than reassign. The
 * transaction's own account token, when the app set one, must be THIS
 * account: a token for someone else means a transaction that was lifted
 * from another device's session, and 403 is the answer. And a transaction
 * this server has already bound to another account stays bound — 409 —
 * because an Apple subscription can belong to one account, and "whoever
 * submits it last" is how a shared receipt becomes a shared subscription.
 */
appleBillingRouter.post("/verify", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });

  const cfg = appleIapConfig();
  const verifier = appleVerifier();
  if (!cfg || !verifier)
    return res.status(503).json({ error: "App Store purchases are not available yet." });

  const { signedTransactionInfo, signedRenewalInfo } = req.body ?? {};
  if (!looksLikeJws(signedTransactionInfo))
    return res.status(422).json({ error: "signedTransactionInfo is required." });
  if (signedRenewalInfo !== undefined && !looksLikeJws(signedRenewalInfo))
    return res.status(422).json({ error: "signedRenewalInfo is malformed." });

  try {
    let transaction;
    let renewalInfo = null;
    try {
      transaction = await verifier.transaction(signedTransactionInfo);
      if (signedRenewalInfo) renewalInfo = await verifier.renewalInfo(signedRenewalInfo);
    } catch (e) {
      const why = describeVerificationFailure(e);
      if (!why) throw e;
      console.error(`[billing:apple:verify] refused: ${why}`);
      return res.status(400).json({ error: "That purchase could not be verified.", code: why });
    }

    const owner = await userIdForAppleTransaction(transaction);
    if (owner && owner !== userId) {
      // Distinguish "the transaction names someone else" from "we already
      // hold it for someone else" only in the log; the client gets one
      // answer for both, because neither is something it can fix.
      const ref = transaction.originalTransactionId ?? transaction.transactionId ?? "?";
      const stored = await storedOwnerOfAppleSubscription(ref);
      console.error(
        `[billing:apple:verify] ${ref} belongs to another account (${stored ? "stored" : "token"})`
      );
      return res.status(stored ? 409 : 403).json({
        error: "That purchase belongs to a different account.",
        code: "wrong_account",
      });
    }

    // Best effort: Apple's current view, if the API is configured and
    // answers. A failure here means "slightly less current", not "refused".
    let status = null;
    const ref = transaction.originalTransactionId ?? transaction.transactionId;
    if (ref && cfg.api) {
      const snap = await fetchAppleSubscriptionStatus(cfg, ref);
      if (snap) {
        status = snap.status;
        // Apple's latest signed objects supersede what the app sent, which
        // may be a renewal or two behind after a restore.
        try {
          if (snap.signedTransactionInfo)
            transaction = await verifier.transaction(snap.signedTransactionInfo);
          if (snap.signedRenewalInfo) renewalInfo = await verifier.renewalInfo(snap.signedRenewalInfo);
        } catch (e) {
          if (!describeVerificationFailure(e)) throw e;
          console.error("[billing:apple:verify] API payload failed verification; using the app's");
        }
      }
    }

    const facts = subscriptionFromApple({ transaction, renewalInfo, status });
    if (!facts)
      return res.status(422).json({ error: "That is not a subscription purchase.", code: "not_subscription" });

    await upsertAppleSubscription({ userId, facts, transaction, renewalInfo });
    return res.json({ ok: true, entitlement: await entitlementFor(userId) });
  } catch (e) {
    console.error("[billing:apple:verify]", (e as Error).message);
    return res.status(500).json({ error: "Could not record that purchase." });
  }
});

/**
 * App Store Server Notifications V2. Body: { signedPayload }.
 *
 * Registered in App Store Connect → App → App Information → App Store Server
 * Notifications, as PUBLIC_BASE_URL + this path — one URL for production and
 * one for sandbox, and this server handles whichever APPLE_IAP_ENVIRONMENT
 * says (a payload from the other is refused as wrong_environment and
 * answered 400, so Apple stops resending it).
 */
appleBillingRouter.post("/notifications", async (req: Request, res: Response) => {
  const verifier = appleVerifier();
  if (!appleIapConfig() || !verifier) return res.status(404).json({ error: "Not found." });

  const { signedPayload } = req.body ?? {};
  if (!looksLikeJws(signedPayload))
    return res.status(400).json({ error: "signedPayload is required." });

  let note;
  try {
    note = await verifier.notification(signedPayload);
  } catch (e) {
    const why = describeVerificationFailure(e);
    if (!why) {
      console.error("[billing:apple:notifications]", (e as Error).message);
      return res.status(500).json({ error: "Verification failed." });
    }
    console.error(`[billing:apple:notifications] refused: ${why}`);
    // 400, not 401: Apple's retry would carry the same bytes and fail the
    // same way. `retryable` is the one case where asking again could help.
    return res.status(why === "retryable" ? 500 : 400).json({ error: "Refused.", code: why });
  }

  const type = note.notificationType ?? "UNKNOWN";
  const signedTx = note.data?.signedTransactionInfo;
  if (type === "TEST" || !signedTx) {
    // TEST is the preflight's round trip; the rest (CONSUMPTION_REQUEST,
    // summaries, external-purchase events) carry nothing this app acts on.
    console.log(`[billing:apple:notifications] ${type} acknowledged`);
    return res.json({ received: true });
  }

  try {
    let transaction;
    let renewalInfo = null;
    try {
      transaction = await verifier.transaction(signedTx);
      if (note.data?.signedRenewalInfo)
        renewalInfo = await verifier.renewalInfo(note.data.signedRenewalInfo);
    } catch (e) {
      const why = describeVerificationFailure(e);
      if (!why) throw e;
      console.error(`[billing:apple:notifications] inner payload refused: ${why}`);
      return res.status(400).json({ error: "Refused.", code: why });
    }

    const userId = await userIdForAppleTransaction(transaction);
    if (!userId) {
      // Not worth a retry — Apple would redeliver forever. Logged with the
      // id so an operator can link it by hand.
      console.error(
        `[billing:apple:notifications] ${type}: no account for ${transaction.originalTransactionId ?? "?"}`
      );
      return res.json({ received: true });
    }

    const facts = subscriptionFromApple({
      transaction,
      renewalInfo,
      status: note.data?.status ?? null,
    });
    if (facts) {
      await upsertAppleSubscription({ userId, facts, transaction, renewalInfo, notificationType: type });
      console.log(`[billing:apple:notifications] ${type}${note.subtype ? `/${note.subtype}` : ""} → ${facts.status}`);
    }
    return res.json({ received: true });
  } catch (e) {
    console.error("[billing:apple:notifications]", (e as Error).message);
    // 500 asks Apple to retry, which is right for a transient database fault.
    return res.status(500).json({ error: "Processing failed." });
  }
});
