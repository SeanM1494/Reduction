/**
 * client/src/components/SubscriptionSetting.tsx — subscription state, and the
 * second place a code can be redeemed.
 *
 * BOTH PLACES, DELIBERATELY. The paywall catches someone holding a code at
 * the moment of intent; this catches someone who was given one last week and
 * has gone looking for where it goes. Same component underneath.
 *
 * NOTHING HERE NAMES A PAYMENT PROVIDER. "Manage subscription" calls
 * `manageSubscription()`, which is the web billing portal today and will be
 * the system settings deep-link under StoreKit — the button does not know or
 * care. The one place provider is mentioned is the wrong-provider message,
 * where it is the actual answer to the user's question.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchSessionState, type Entitlement } from "../lib/session";
import { manageSubscription, purchaseAvailable, startPurchase } from "../lib/purchase";
import CouponBox from "./CouponBox";

export default function SubscriptionSetting() {
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [canBuy, setCanBuy] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const state = await fetchSessionState();
      setEnt(state.entitlement);
    } catch {
      /* leave it null — the card just shows less */
    }
  }, []);

  useEffect(() => {
    void load();
    purchaseAvailable().then(setCanBuy).catch(() => setCanBuy(false));
  }, [load]);

  if (!ent) return null;

  const remaining = Math.max(0, ent.allowance - ent.used);

  return (
    <div className="rd-settings-card">
      <h2 className="rd-settings-heading">Subscription</h2>

      {ent.subscribed ? (
        <>
          <p className="rd-settings-line">
            <strong>Unlimited</strong>
            {ent.status === "grace" ? (
              <span className="rd-settings-sub"> &mdash; payment retrying</span>
            ) : null}
          </p>
          {ent.status === "grace" ? (
            /* Grace is Stripe's own retry window, not a timer this app runs,
               so the copy promises no specific number of days — see
               server/lib/billing/stripe.ts. */
            <p className="rd-settings-line rd-settings-sub">
              Your last payment didn&rsquo;t go through. We&rsquo;ll keep
              trying, and nothing changes while we do. Updating your card
              fixes it straight away.
            </p>
          ) : null}
          <button
            className="rd-btn rd-settings-toggle"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const out = await manageSubscription();
              if (out.status !== "started") setBusy(false);
            }}
          >
            Manage subscription
          </button>
        </>
      ) : (
        <>
          <p className="rd-settings-line">
            <strong>Free</strong>
            <span className="rd-settings-sub">
              {" "}
              &mdash; {remaining} of {ent.allowance}{" "}
              {ent.allowance === 1 ? "recipe" : "recipes"} left
            </span>
          </p>
          {canBuy ? (
            <button
              className="rd-btn rd-settings-toggle"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const out = await startPurchase();
                if (out.status !== "started") setBusy(false);
              }}
            >
              Subscribe &mdash; $1.99/month
            </button>
          ) : null}
        </>
      )}

      <CouponBox onRedeemed={load} />
    </div>
  );
}
