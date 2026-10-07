/**
 * lib/purchasePolicy.ts — the decisions in the StoreKit handler, kept pure
 * so the runner can test them. lib/storeKit.ts owns the library calls and
 * nothing else.
 *
 * THE PRODUCTS ARE NAMED HERE AND IN APP STORE CONNECT, AND NOWHERE ELSE.
 * The server never sees a product id: it verifies a signed transaction and
 * reads an expiry, a status and an account token from it (the Apple
 * adapter's vocabulary ends there, on purpose). So these two strings are
 * the whole contract between the app and the store catalogue, and both
 * products must live in ONE subscription group so that switching plans is
 * an upgrade or downgrade rather than a second subscription.
 *
 * The `.plan.` segment is not decoration. The first ids
 * (`com.recipereduction.mobile.monthly` / `.yearly`) were created under an
 * App Store Connect record whose bundle id was a typo of the build's, and
 * App Store Connect burns a subscription's product id ACCOUNT-WIDE the
 * moment it is created — deleting the product does not free it (Sep 21:
 * "The Product ID you entered is already being used by another
 * subscription", after the originals were deleted). These two are the
 * replacements, under the record whose bundle id the build actually
 * carries; the old strings can never be used again on this account.
 *
 * GOOGLE PLAY USES THE SAME TWO IDS. Play's product ids allow lowercase
 * letters, digits, underscores and periods, so these strings are valid
 * there unchanged, and one table serves both stores. Each Play
 * subscription needs one auto-renewing base plan (monthly / yearly); the
 * app buys whichever base-plan offer `basePlanOffer` picks.
 */

import { STORE_WORDS, type StoreWords } from './storeWords';

export type Plan = 'monthly' | 'yearly';

export const PLAN_SKUS: Record<Plan, string> = {
  monthly: 'com.recipereduction.mobile.plan.monthly',
  yearly: 'com.recipereduction.mobile.plan.yearly',
};

/** Display order: the plan the web sells first, the better deal second. */
export const PLAN_ORDER: Plan[] = ['monthly', 'yearly'];

export const PLAN_LABELS: Record<Plan, { name: string; per: string }> = {
  monthly: { name: 'Monthly', per: 'month' },
  yearly: { name: 'Yearly', per: 'year' },
};

export function planOf(sku: string): Plan | null {
  for (const plan of PLAN_ORDER) if (PLAN_SKUS[plan] === sku) return plan;
  return null;
}

/** What the store said about a product; only the fields the app reads. */
export interface StoreProduct {
  id: string;
  displayPrice: string;
}

export interface OfferView {
  plan: Plan;
  sku: string;
  price: string;
}

/** The plans the store actually returned, in display order. A plan the
 *  store does not know (not yet created, not yet approved, wrong bundle)
 *  is simply absent rather than shown with no price. */
export function offersFrom(products: readonly StoreProduct[]): OfferView[] {
  const out: OfferView[] = [];
  for (const plan of PLAN_ORDER) {
    const p = products.find((x) => x.id === PLAN_SKUS[plan]);
    if (p) out.push({ plan, sku: p.id, price: p.displayPrice });
  }
  return out;
}

/** A JWS is three base64url segments — the same check the verify route
 *  makes before it reads anything, so a token the server would refuse is
 *  never sent. On iOS expo-iap's `purchaseToken` IS StoreKit 2's
 *  `jwsRepresentation`. */
const JWS_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const looksLikeJws = (s: unknown): s is string => typeof s === 'string' && JWS_RE.test(s);

/** What the store handed back about a purchase; only the fields read here. */
export interface StorePurchase {
  productId: string;
  purchaseToken?: string | null;
  transactionDate: number;
  /** 'pending' on Android while a slow payment (cash, some cards) has not
   *  cleared. Never granted and never acknowledged in that state; the same
   *  purchase arrives again as 'purchased' when it clears. */
  purchaseState?: string | null;
}

/** The body for POST /api/billing/apple/verify, or null when this purchase
 *  is not one of ours or carries nothing verifiable. */
export function verifyBodyFrom(p: StorePurchase): { signedTransactionInfo: string } | null {
  if (!planOf(p.productId)) return null;
  if (!looksLikeJws(p.purchaseToken)) return null;
  return { signedTransactionInfo: p.purchaseToken };
}

/** Play purchase tokens are opaque strings of a few hundred characters.
 *  The cap only keeps an absurd one from being posted; the server
 *  re-checks. */
const MAX_PLAY_TOKEN = 4096;

/** The body for POST /api/billing/google/verify, or null when this purchase
 *  is not one of ours, has not cleared, or carries no token. Google's
 *  answer about the token is the proof; nothing the phone says is. */
export function googleVerifyBodyFrom(p: StorePurchase): { purchaseToken: string } | null {
  if (!planOf(p.productId)) return null;
  if (p.purchaseState && p.purchaseState !== 'purchased') return null;
  const token = typeof p.purchaseToken === 'string' ? p.purchaseToken.trim() : '';
  if (!token || token.length > MAX_PLAY_TOKEN) return null;
  return { purchaseToken: token };
}

/** One of a Play subscription's offers; only the fields read here. */
export interface PlayOffer {
  id?: string | null;
  basePlanIdAndroid?: string | null;
  offerTokenAndroid?: string | null;
  offerTagsAndroid?: string[] | null;
}

/**
 * The offer to buy a Play subscription with: its plain base plan, never a
 * trial or a promotion this app has not decided to run. A base-plan offer
 * is the one with no offer id of its own (openiap reports its id as the
 * base plan's, or nothing). When every offer is a promotion, the first one
 * that can be bought is the fallback, rather than no plan at all.
 */
export function basePlanOffer<O extends PlayOffer>(offers: readonly O[] | null | undefined): O | null {
  const buyable = (offers ?? []).filter((o) => typeof o.offerTokenAndroid === 'string' && o.offerTokenAndroid);
  const plain = buyable.find((o) => !o.id || o.id === o.basePlanIdAndroid);
  return plain ?? buyable[0] ?? null;
}

/** A price as the box shows it, before it adds "/month". Some store
 *  strings already carry a period ("$1.99/month"); that part is dropped so
 *  the box never says "/month/month". */
export function plainPrice(price: string): string {
  const slash = price.indexOf('/');
  return (slash > 0 ? price.slice(0, slash) : price).trim();
}

/** For a restore: the most recent of this Apple ID's purchases that is one
 *  of ours, or null. */
export function newestOwnPurchase<P extends StorePurchase>(purchases: readonly P[]): P | null {
  let best: P | null = null;
  for (const p of purchases) {
    if (!planOf(p.productId)) continue;
    if (!best || p.transactionDate > best.transactionDate) best = p;
  }
  return best;
}

export type PurchaseOutcome =
  | { status: 'started' }
  | { status: 'completed' }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

/**
 * The store's error codes, read into the seam's vocabulary. A cancel is
 * not an error. "Deferred" is Ask to Buy — a child asked, a parent has not
 * answered — and is reported as started: the transaction arrives later,
 * through the same listener, when the parent approves.
 */
export function outcomeFromStoreError(code: string, message?: string | null, words: StoreWords = STORE_WORDS.ios): PurchaseOutcome {
  switch (code) {
    case 'user-cancelled':
      return { status: 'cancelled' };
    case 'deferred-payment':
    case 'pending':
      return { status: 'started' };
    case 'iap-not-available':
    case 'billing-unavailable':
    case 'feature-not-supported':
      return { status: 'unavailable' };
    case 'network-error':
    case 'service-timeout':
      return { status: 'error', message: `${words.theStore} could not be reached. Try again in a moment.` };
    case 'already-owned':
      return { status: 'error', message: `This ${words.account} already has a subscription. Use "Restore purchases".` };
    default:
      return { status: 'error', message: message || 'The purchase could not be completed.' };
  }
}
