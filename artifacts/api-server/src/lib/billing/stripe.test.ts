/**
 * server/lib/billing/stripe.test.ts — the translation layer, without Stripe.
 *
 * NO NETWORK, AND THAT IS THE POINT OF WHAT IS TESTED HERE. Live Checkout,
 * real cards and Stripe-delivered webhooks cannot be exercised from this
 * container and are NOT covered by anything in this file — see ROADMAP for
 * what still has to be checked by hand against a test-mode account. What can
 * be pinned here is the part that decides who gets access: the mapping from
 * Stripe's vocabulary to this app's, which is where a wrong answer means
 * either a paying customer locked out or a free ride.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normaliseStripeStatus } from "./stripe";

test("active and trialing entitle", () => {
  assert.equal(normaliseStripeStatus("active"), "active");
  // A Stripe trial is a paid plan that has not billed yet. Someone in one has
  // done everything asked of them.
  assert.equal(normaliseStripeStatus("trialing"), "active");
});

test("past_due is grace — the provider's retry window, not a local timer", () => {
  // A failed card is usually an expired card rather than a decision to leave,
  // and Stripe is still retrying. Grace ENDS when Stripe says the
  // subscription ended, so there is no duration here to drift from the
  // Dashboard's dunning settings.
  assert.equal(normaliseStripeStatus("past_due"), "grace");
});

test("incomplete is NOT grace", () => {
  // The trap: `incomplete` means the FIRST payment never succeeded — someone
  // who started a checkout and abandoned it. Treating it as grace hands a
  // free month to anyone who opens the payment page.
  assert.equal(normaliseStripeStatus("incomplete"), "expired");
  assert.equal(normaliseStripeStatus("incomplete_expired"), "expired");
});

test("ended states expire", () => {
  assert.equal(normaliseStripeStatus("canceled"), "expired");
  assert.equal(normaliseStripeStatus("unpaid"), "expired");
  assert.equal(normaliseStripeStatus("paused"), "expired");
});

test("an unknown future status fails closed", () => {
  // Stripe adds statuses. Under-serving shows up in access_events as an
  // account to investigate; over-serving shows up as nothing at all.
  assert.equal(
    normaliseStripeStatus("some_status_added_in_2027" as never),
    "expired"
  );
});

test("every Stripe status maps to a value entitlement understands", () => {
  // Guards the seam itself: entitlement.ts treats exactly 'active' and
  // 'grace' as entitling, so a mapping that returned anything else would
  // silently deny access rather than fail loudly.
  const all = [
    "active", "past_due", "unpaid", "canceled", "incomplete",
    "incomplete_expired", "trialing", "paused",
  ] as const;
  for (const s of all) {
    assert.ok(
      ["active", "grace", "expired"].includes(normaliseStripeStatus(s)),
      `${s} mapped outside the normalised set`
    );
  }
});
