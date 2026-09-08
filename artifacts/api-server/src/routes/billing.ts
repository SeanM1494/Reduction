/**
 * server/routes/billing.ts — checkout, the webhook, and the portal.
 *
 * THE WEBHOOK IS THE TRUTH; THE REDIRECT IS A HINT. A user coming back from
 * Checkout with `?paid=1` has proved nothing — they can type that URL. Only a
 * signature-verified webhook may write a subscription, which is why the
 * success redirect below refreshes entitlement rather than granting it.
 *
 * ORDERING MATTERS IN server/index.ts. The webhook needs the RAW body to
 * verify Stripe's signature, so its route is mounted with express.raw BEFORE
 * the global express.json(). Mount it after and the signature check fails on
 * every event, permanently, with a message that does not say why.
 */

import { Router, type Request, type Response } from "express";
import { userIdOf } from "../middleware/session";
import {
  USER_METADATA_KEY,
  stripeClient,
  stripeConfigured,
  stripePriceId,
  stripeWebhookSecret,
  upsertStripeSubscription,
  userIdForStripeSubscription,
} from "../lib/billing/stripe";
import { entitlementFor } from "../lib/billing/entitlement";
import { redeemCoupon, redemptionsFor } from "../lib/billing/coupons";

export const billingRouter = Router();

/**
 * What the client needs to render the paywall, or null when billing is off.
 *
 * The same posture as /api/auth/providers and /api/push/config: an
 * unconfigured server makes the client hide the control rather than render
 * one that fails when tapped.
 */
billingRouter.get("/config", (_req: Request, res: Response) => {
  res.json({
    // Deliberately NOT "stripeEnabled". The client learns that a purchase is
    // possible, not who processes it — see client/src/lib/purchase.ts for why
    // that distinction is load-bearing for the App Store build.
    purchaseAvailable: stripeConfigured(),
    priceLabel: "$1.99/month",
  });
});

billingRouter.get("/status", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.json({ entitlement: null });
  try {
    const ent = await entitlementFor(userId);
    return res.json({ entitlement: ent, redemptions: await redemptionsFor(userId) });
  } catch (e) {
    console.error("[billing:status]", (e as Error).message);
    return res.status(500).json({ error: "Could not load your subscription." });
  }
});

billingRouter.post("/checkout", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });

  const stripe = stripeClient();
  const price = stripePriceId();
  if (!stripe || !price)
    return res.status(503).json({ error: "Subscriptions are not available yet." });

  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      // "Free months" coupons live here, natively. This one flag is the
      // entire implementation of that mechanic — see lib/billing/coupons.ts
      // for why the other mechanic is not in Stripe at all.
      allow_promotion_codes: true,
      client_reference_id: userId,
      // Stamped on the SUBSCRIPTION, not just the session, so every later
      // event (renewal, payment failure, cancellation) names its account
      // without a customer lookup table.
      subscription_data: { metadata: { [USER_METADATA_KEY]: userId } },
      success_url: `${base}/?subscribed=1`,
      cancel_url: `${base}/?subscribed=0`,
    });
    return res.json({ url: session.url });
  } catch (e) {
    console.error("[billing:checkout]", (e as Error).message);
    return res.status(502).json({ error: "Could not start checkout." });
  }
});

/** Cancel and card updates go to Stripe's own portal — cheaper to run and
 *  safer than reimplementing cancellation, and it is also the surface Apple
 *  will replace wholesale rather than one this app has to port. */
billingRouter.post("/portal", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "Not available." });

  try {
    const ent = await entitlementFor(userId);
    if (ent.provider !== "stripe")
      return res.status(409).json({
        error: "This subscription is managed elsewhere.",
        code: "wrong_provider",
        provider: ent.provider,
      });
    const [sub] = await stripe.subscriptions
      .list({ limit: 1, status: "all" })
      .then((r) => r.data.filter((s) => s.metadata?.[USER_METADATA_KEY] === userId));
    if (!sub?.customer) return res.status(404).json({ error: "No subscription found." });

    const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
    const portal = await stripe.billingPortal.sessions.create({
      customer: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      return_url: `${base}/`,
    });
    return res.json({ url: portal.url });
  } catch (e) {
    console.error("[billing:portal]", (e as Error).message);
    return res.status(502).json({ error: "Could not open the billing portal." });
  }
});

billingRouter.post("/coupon", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const { code } = req.body ?? {};
  if (typeof code !== "string" || code.length > 64)
    return res.status(422).json({ error: "Enter a code." });

  try {
    const out = await redeemCoupon(userId, code);
    if (!out.ok) {
      const message =
        out.code === "already_redeemed"
          ? "You've already used that code."
          : out.code === "expired"
            ? "That code has expired."
            : out.code === "exhausted"
              ? "That code has been fully claimed."
              : "We don't recognise that code.";
      return res.status(422).json({ error: message, code: out.code });
    }
    return res.json({ ok: true, recipes: out.recipes, entitlement: await entitlementFor(userId) });
  } catch (e) {
    console.error("[billing:coupon]", (e as Error).message);
    return res.status(500).json({ error: "Could not redeem that code." });
  }
});

/**
 * The webhook. Mounted separately in server/index.ts with express.raw.
 *
 * Signature-verified, and 404s rather than running unverified when the secret
 * is unset — an open webhook endpoint lets anyone on the internet grant
 * themselves a subscription.
 */
export const stripeWebhookHandler = async (req: Request, res: Response) => {
  const stripe = stripeClient();
  const secret = stripeWebhookSecret();
  if (!stripe || !secret) return res.status(404).json({ error: "Not found." });

  const signature = req.get("stripe-signature");
  if (!signature) return res.status(400).json({ error: "Missing signature." });

  let event;
  try {
    // req.body is a Buffer here, not parsed JSON — see the note at the top.
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, secret);
  } catch (e) {
    console.error("[billing:webhook] bad signature:", (e as Error).message);
    return res.status(400).json({ error: "Bad signature." });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const userId = await userIdForStripeSubscription(sub);
        if (!userId) {
          // Not an error worth 500ing over — Stripe would redeliver forever.
          console.error(`[billing:webhook] no account for subscription ${sub.id}`);
          break;
        }
        await upsertStripeSubscription({ userId, sub });
        break;
      }
      default:
        // Everything else is acknowledged and ignored. Stripe sends a great
        // many event types and 404ing them makes it retry things this app
        // will never care about.
        break;
    }
    // 200 on anything successfully processed OR deliberately ignored, so
    // Stripe stops retrying. The upsert is keyed on (provider, provider_ref),
    // so a redelivery converges rather than duplicating.
    return res.json({ received: true });
  } catch (e) {
    console.error("[billing:webhook]", (e as Error).message);
    // 500 asks Stripe to retry, which is right for a transient database fault.
    return res.status(500).json({ error: "Webhook processing failed." });
  }
};
