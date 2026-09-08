/**
 * client/src/components/Paywall.tsx — what someone sees when they've used
 * their one free recipe.
 *
 * THE DESIGN PROBLEM IS "LIMIT, NOT DEAD END". This screen replaces the Find
 * tab's controls entirely rather than appearing after a rejected action —
 * because letting someone type a search, wait, and then be refused spends
 * their attention and our API budget to deliver a no. The server gate is the
 * enforcement; this is what stops the UI inviting work it will refuse.
 *
 * Four choices worth keeping if this is ever redesigned:
 *
 *  1. THEIR RECIPE IS NAMED. "Aunt Meg's Cinnamon Rolls is yours to keep"
 *     turns "you are locked out" into "you have something", and it is the
 *     single cheapest thing that stops this reading as a dead end.
 *  2. THE PRICE IS ON THE SCREEN, not behind a link. At $1.99 the number IS
 *     the argument; making someone navigate to find it loses more than the
 *     number costs.
 *  3. THERE IS A REAL WAY OUT. "Open my recipe" goes somewhere they value. A
 *     wall with no door reads as hostile; a wall with one reads as a limit,
 *     and the app stays usable either way.
 *  4. NO COUNTDOWN, NO FAKE SCARCITY. The argument is that the product is
 *     worth two pounds a month. If that is not carrying it, a manipulative
 *     modal will not.
 *
 * The button calls `startPurchase()` and never opens a URL itself — see
 * lib/purchase.ts for why that matters for the App Store build.
 */

import { useCallback, useEffect, useState } from "react";
import { purchaseAvailable, startPurchase } from "../lib/purchase";
import CouponBox from "./CouponBox";

interface Props {
  /** The one recipe they already have, if they have one. */
  recipeTitle?: string | null;
  onOpenRecipe?: () => void;
  /** Refreshes session/entitlement after a code lifts the wall. */
  onEntitlementChange?: () => void;
  /** "search" | "extract" — only changes the opening line. */
  context?: "search" | "extract" | "generic";
}

export default function Paywall({
  recipeTitle,
  onOpenRecipe,
  onEntitlementChange,
  context = "generic",
}: Props) {
  const [canBuy, setCanBuy] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let alive = true;
    purchaseAvailable()
      .then((v) => alive && setCanBuy(v))
      .catch(() => alive && setCanBuy(false));
    return () => {
      alive = false;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    const out = await startPurchase();
    // "started" means we are navigating (web) or a native sheet is up. Either
    // way there is nothing more for this component to do.
    if (out.status === "error") {
      setError(out.message);
      setBusy(false);
    } else if (out.status === "cancelled" || out.status === "unavailable") {
      setBusy(false);
    }
  }, []);

  const lead =
    context === "search"
      ? "Searching for a new recipe needs a subscription."
      : context === "extract"
        ? "Adding a new recipe needs a subscription."
        : "You've used your free recipe.";

  return (
    <div className="rd-paywall">
      <h2 className="rd-paywall-title">{lead}</h2>

      {recipeTitle ? (
        <p className="rd-paywall-keep">
          <strong>{recipeTitle}</strong> is yours to keep &mdash; cook it, edit
          it, scale it, any time.
        </p>
      ) : null}

      <div className="rd-paywall-offer">
        <p className="rd-paywall-plan">Unlimited recipes</p>
        <p className="rd-paywall-price">$1.99<span>/month</span></p>
      </div>

      {canBuy === false ? (
        <p className="rd-paywall-soon" role="status">
          Subscriptions aren&rsquo;t open yet. Hold tight &mdash; your recipe
          is safe in the meantime.
        </p>
      ) : (
        <button
          className="rd-btn rd-paywall-cta"
          onClick={subscribe}
          disabled={busy || canBuy === null}
        >
          {busy ? "One moment…" : "Subscribe"}
        </button>
      )}

      {error ? (
        <p className="rd-paywall-error" role="alert">
          {error}
        </p>
      ) : null}

      {showCode ? (
        <CouponBox
          onRedeemed={() => {
            setShowCode(false);
            onEntitlementChange?.();
          }}
        />
      ) : (
        <button className="rd-paywall-link" onClick={() => setShowCode(true)}>
          Have a code?
        </button>
      )}

      {onOpenRecipe && recipeTitle ? (
        <button className="rd-btn rd-paywall-back" onClick={onOpenRecipe}>
          Open my recipe
        </button>
      ) : null}
    </div>
  );
}
