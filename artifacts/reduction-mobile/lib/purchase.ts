/**
 * lib/purchase.ts — how a subscription gets bought, on a phone.
 *
 * The web's purchase.ts seam, ported. The reason it exists is the same:
 * the paywall and the Plan card call `startPurchase()` and never know who
 * processes it. On the web that is Stripe Checkout; here it is StoreKit
 * (lib/storeKit.ts), registered at startup on iOS. On any host with no
 * handler registered — the web build, a simulator, Android for now — the
 * default handler says "unavailable" and every surface stays exactly as it
 * was before purchases existed: the wall states the limit and offers a
 * code, and nothing steers anyone anywhere (guideline 3.1.1).
 *
 * Deliberately a module-level slot rather than React context: a purchase
 * handler is a property of the HOST the app runs in, not of a component
 * subtree, and threading it through props would put the seam back in
 * every caller.
 */

import type { Plan } from './purchasePolicy';

export type PurchaseOutcome =
  | { status: 'started' }
  | { status: 'completed' }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export interface Offer {
  plan: Plan;
  sku: string;
  /** The store's own localised price string ("$1.99"). Never computed
   *  here: the store knows the storefront, the currency and the tax. */
  price: string;
}

export interface PurchaseHandler {
  /** Whether this host can sell right now. */
  available(): Promise<boolean>;
  /** The plans the store will sell, with their prices, in display order. */
  offers(): Promise<Offer[]>;
  /** Begin a purchase for the signed-in account. May present a native
   *  sheet; callers handle every outcome and assume nothing about timing. */
  purchase(plan: Plan, userId: string): Promise<PurchaseOutcome>;
  /** Re-attach a subscription this Apple ID already holds to this account. */
  restore(userId: string): Promise<PurchaseOutcome>;
  /** Manage or cancel an existing subscription — the store's own page. */
  manage(): Promise<PurchaseOutcome>;
}

const unavailableHandler: PurchaseHandler = {
  async available() {
    return false;
  },
  async offers() {
    return [];
  },
  async purchase() {
    return { status: 'unavailable' };
  },
  async restore() {
    return { status: 'unavailable' };
  },
  async manage() {
    return { status: 'unavailable' };
  },
};

let handler: PurchaseHandler = unavailableHandler;

export function setPurchaseHandler(next: PurchaseHandler): void {
  handler = next;
}

export const purchaseAvailable = () => handler.available();
export const purchaseOffers = () => handler.offers();
export const startPurchase = (plan: Plan, userId: string) => handler.purchase(plan, userId);
export const restorePurchases = (userId: string) => handler.restore(userId);
export const manageSubscription = () => handler.manage();
