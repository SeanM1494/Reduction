/**
 * server/lib/billing/stripe.ts — THE ONLY FILE IN THIS CODEBASE THAT MAY
 * IMPORT THE STRIPE SDK OR KNOW A STRIPE-SHAPED FIELD NAME.
 *
 * That is a rule, not a description, and it is worth stating plainly because
 * breaking it is easy and the damage is invisible until a second provider
 * exists. This app is going to the App Store — where Apple requires IAP for
 * subscriptions unlocking in-app functionality — and likely to Play under the
 * same category of rule. Neither replaces Stripe: a subscription bought on
 * the web must keep working forever, so each store ADDS a provider. Every
 * `stripe.` reference outside this file is one more place a future adapter
 * has to be retrofitted into.
 *
 * What this file does: talk to Stripe, and translate. What it never does:
 * decide anything. Entitlement lives in entitlement.ts and knows nothing
 * about any of this.
 *
 * UNCONFIGURED IS NOT BROKEN. With STRIPE_SECRET_KEY absent, `stripeClient()`
 * returns null, the billing routes 404, and the paywall cannot be enforced —
 * the same posture push takes with its VAPID keys, so a half-finished Secrets
 * edit leaves the app working rather than 500ing on a checkout button.
 */

import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { subscriptions } from "../../../shared/schema";
import type { SubStatus } from "./entitlement";

let client: Stripe | null | undefined;

export function stripeClient(): Stripe | null {
  if (client !== undefined) return client;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  client = key ? new Stripe(key) : null;
  return client;
}

export function stripePriceId(): string | null {
  return process.env.STRIPE_PRICE_ID?.trim() || null;
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

/** Everything needed to sell a subscription is present. */
export function stripeConfigured(): boolean {
  return !!stripeClient() && !!stripePriceId();
}

/** Test seam, so a suite can drive configuration without touching env. */
export function resetStripeCache(): void {
  client = undefined;
}

/**
 * THE TRANSLATION, and the only place Stripe's vocabulary is allowed to
 * appear.
 *
 * GRACE IS THE PROVIDER'S RETRY WINDOW, NOT A LOCAL TIMER. Stripe's default
 * dunning is 8 attempts over roughly two weeks, and when they are exhausted
 * Stripe moves the subscription to `canceled` or `unpaid` depending on a
 * Dashboard setting. Both of those are settings the account owner can change,
 * so a local "grace lasts 14 days" constant would be a copy of a number that
 * lives somewhere else and drifts silently — cutting someone off while Stripe
 * is still happily retrying their card, or carrying them long after Stripe
 * gave up. Mapping `past_due` to 'grace' and letting Stripe decide when it
 * ends means there is no timer here to get wrong, and changing the retry
 * policy in the Dashboard changes this app with no deploy.
 *
 * `incomplete` is NOT grace: it is a subscription whose first payment never
 * succeeded, i.e. someone who has never paid. Treating it as grace would hand
 * out a free month to anyone who starts a checkout and abandons it.
 */
export function normaliseStripeStatus(s: Stripe.Subscription.Status): SubStatus {
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "grace";
    case "incomplete":
    case "incomplete_expired":
    case "canceled":
    case "unpaid":
    case "paused":
      return "expired";
    default:
      // A status Stripe adds after this was written. Expired is the safe
      // direction: it under-serves rather than giving away access, and it
      // shows up in access_events as an exhausted account to investigate.
      return "expired";
  }
}

/**
 * Write a Stripe subscription into the provider-agnostic table.
 *
 * Keyed on (provider, provider_ref), so redelivered webhooks — which Stripe
 * does routinely — converge rather than duplicate.
 */
export async function upsertStripeSubscription(params: {
  userId: string;
  sub: Stripe.Subscription;
}): Promise<void> {
  const { userId, sub } = params;
  // `current_period_end` is on the subscription item in current API versions
  // and on the subscription in older ones. Reading both is not defensive
  // clutter — it is the one field this app surfaces, and a missing value
  // silently becomes "no renewal date" in the UI.
  const periodEndUnix =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items?.data?.[0]?.current_period_end ??
    null;

  const values = {
    userId,
    provider: "stripe",
    provider_ref: sub.id,
    status: normaliseStripeStatus(sub.status),
    renewsAt: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    willNotRenew: !!sub.cancel_at_period_end,
    raw: sub as unknown as Record<string, unknown>,
    updatedAt: new Date(),
  };

  await getDb()
    .insert(subscriptions)
    .values({ id: randomUUID(), ...values })
    .onConflictDoUpdate({
      target: [subscriptions.provider, subscriptions.provider_ref],
      set: values,
    });
}

/**
 * Which account a Stripe subscription belongs to.
 *
 * Read from the subscription's own metadata, stamped at checkout via
 * `subscription_data.metadata`. That is deliberate: every subscription event
 * Stripe sends carries it, so no event needs a customer->user lookup table
 * and no event can arrive for an account this app cannot name.
 *
 * The fallback is the row we already stored, which covers the one case
 * metadata cannot: a subscription created outside this checkout flow (a
 * Dashboard comp, a support action) that was later linked by hand.
 */
export async function userIdForStripeSubscription(
  sub: Stripe.Subscription
): Promise<string | null> {
  const fromMetadata = sub.metadata?.userId;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;

  const rows = await getDb()
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(
      and(eq(subscriptions.provider, "stripe"), eq(subscriptions.provider_ref, sub.id))
    );
  return rows[0]?.userId ?? null;
}

/** The metadata key checkout stamps, so both sides agree on one spelling. */
export const USER_METADATA_KEY = "userId";
