/**
 * client/src/lib/purchase.ts — how a subscription gets bought.
 *
 * WHY THIS INDIRECTION EXISTS AT ALL, WHEN THERE IS ONE IMPLEMENTATION.
 *
 * This app is going to the App Store, and probably to Play after it. Both
 * require their own billing library for a subscription that unlocks in-app
 * functionality — StoreKit and Google Play Billing — and neither will accept
 * a button that opens a Stripe Checkout URL in a browser. That is not a
 * hypothetical: it is the specific reason a submission gets rejected.
 *
 * The retrofit that hurts is not "add StoreKit". It is finding every place
 * the UI assumed buying means NAVIGATING SOMEWHERE. A component that calls
 * `window.location.href = url` has baked a web checkout into its own
 * definition of the verb, and every such component has to be reopened.
 *
 * So the button calls `purchase()`. What that does is decided here, in one
 * place, by which host the app is running in. Adding StoreKit later is
 * registering a second implementation in this file — the paywall, the
 * settings screen and anything else that ever sells a subscription do not
 * change at all.
 *
 * The web implementation is the only one today, and that is fine. The cost of
 * the seam is this file; the cost of not having it is every caller.
 */

export type PurchaseOutcome =
  | { status: "started" }
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export interface PurchaseHandler {
  /** Whether this host can sell right now. */
  available(): Promise<boolean>;
  /** Begin a purchase. May navigate away, present a native sheet, or
   *  resolve — callers must handle all three by not assuming a return. */
  purchase(): Promise<PurchaseOutcome>;
  /** Manage/cancel an existing subscription. */
  manage(): Promise<PurchaseOutcome>;
}

/**
 * Web: Stripe Checkout, reached through our own server so the price id and
 * the Stripe key never touch the client.
 *
 * Note this handler does not name Stripe anywhere a caller can see. The
 * client knows a purchase is possible, not who processes it — which is what
 * lets the native handler slot in without a single caller noticing.
 */
const webHandler: PurchaseHandler = {
  async available() {
    try {
      const res = await fetch("/api/billing/config");
      if (!res.ok) return false;
      const body = (await res.json()) as { purchaseAvailable?: boolean };
      return !!body.purchaseAvailable;
    } catch {
      return false;
    }
  },

  async purchase() {
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        return { status: "error", message: body.error ?? "Could not start checkout." };
      }
      window.location.href = body.url;
      // Navigation is in flight; the page is going away. "started" rather
      // than "completed" on purpose — only the webhook knows if it worked.
      return { status: "started" };
    } catch (e) {
      return { status: "error", message: (e as Error).message };
    }
  },

  async manage() {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        return { status: "error", message: body.error ?? "Could not open billing." };
      }
      window.location.href = body.url;
      return { status: "started" };
    } catch (e) {
      return { status: "error", message: (e as Error).message };
    }
  },
};

/**
 * The active handler.
 *
 * A native wrapper registers its own at startup — `setPurchaseHandler(storeKit)`
 * — and nothing else changes. Deliberately a module-level slot rather than
 * React context: a purchase handler is a property of the HOST the app is
 * running in, not of any component subtree, and threading it through props
 * would put the seam back in every caller.
 */
let handler: PurchaseHandler = webHandler;

export function setPurchaseHandler(next: PurchaseHandler): void {
  handler = next;
}

export const purchaseAvailable = () => handler.available();
export const startPurchase = () => handler.purchase();
export const manageSubscription = () => handler.manage();
