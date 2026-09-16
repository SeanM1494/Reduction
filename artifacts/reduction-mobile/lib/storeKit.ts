/**
 * lib/storeKit.ts — the App Store handler for lib/purchase.ts, on expo-iap.
 *
 * ONLY THIS FILE IMPORTS expo-iap. The flow — verify with the server, THEN
 * finish with the store; only our products; the listener as the source of
 * truth — is lib/storeKitFlow.ts, pure and tested, and this file binds the
 * library to its Store interface and nothing more. The product ids are in
 * lib/purchasePolicy.ts.
 *
 * AVAILABLE MEANS THE SERVER CAN RECORD IT. A purchase StoreKit completes
 * is money taken; what unlocks the app is the server verifying the signed
 * transaction (POST /api/billing/apple/verify), which 503s until the Apple
 * adapter is configured. So `available()` asks the server first and only
 * then the store, and the wall never shows a price it cannot honour.
 *
 * THE ACCOUNT TOKEN. `appAccountToken` = the user's id (a v4 UUID, which is
 * what StoreKit requires of it) rides inside the signed transaction and is
 * how Apple's notifications name an account with no lookup table on this
 * side. A restore of a subscription bound to another account is refused by
 * the server, not reassigned.
 *
 * NOT VERIFIABLE FROM A CONTAINER: any of this against a real store. What
 * is proven is the flow under node and that the surfaces stay unchanged on
 * hosts without a handler. A sandbox purchase on a device is the first
 * real exercise.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import {
  deepLinkToSubscriptions,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap';
import { fetchBillingConfig, verifyApplePurchase } from './api';
import type { Offer, PurchaseHandler, PurchaseOutcome } from './purchase';
import { offersFrom, PLAN_ORDER, PLAN_SKUS, type Plan } from './purchasePolicy';
import { purchase as runPurchase, reconcile, restore as runRestore, type Store, type Verifier } from './storeKitFlow';

type StorePurchase = Purchase & { transactionDate: number };

const store: Store<StorePurchase> = {
  async requestSubscription(sku, appAccountToken) {
    await requestPurchase({ request: { apple: { sku, appAccountToken } }, type: 'subs' });
  },
  onPurchase(listener) {
    const sub = purchaseUpdatedListener((p) => listener(p as StorePurchase));
    return () => sub.remove();
  },
  onError(listener) {
    const sub = purchaseErrorListener((e) => listener({ code: e.code ?? 'unknown', message: e.message }));
    return () => sub.remove();
  },
  async finish(p) {
    await finishTransaction({ purchase: p, isConsumable: false });
  },
  async availablePurchases() {
    return (await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true })) as StorePurchase[];
  },
};

const verifier: Verifier = {
  async verify(body) {
    await verifyApplePurchase(body);
  },
};

let connected: Promise<boolean> | null = null;
/** One connection per process; the library tolerates repeats, the cost
 *  does not need paying twice. */
function connect(): Promise<boolean> {
  if (!connected) {
    connected = initConnection().catch(() => {
      connected = null;
      return false;
    });
  }
  return connected;
}

const hostCanSell = () => Platform.OS === 'ios' && Device.isDevice;

export const storeKitHandler: PurchaseHandler = {
  async available() {
    if (!hostCanSell()) return false;
    try {
      const cfg = await fetchBillingConfig();
      if (!cfg.nativePurchaseAvailable) return false;
    } catch {
      return false;
    }
    return connect();
  },

  async offers(): Promise<Offer[]> {
    if (!(await connect())) return [];
    const products = (await fetchProducts({ skus: PLAN_ORDER.map((p) => PLAN_SKUS[p]), type: 'subs' })) ?? [];
    return offersFrom(products.map((p) => ({ id: p.id, displayPrice: p.displayPrice })));
  },

  async purchase(plan: Plan, userId: string): Promise<PurchaseOutcome> {
    if (!(await connect())) return { status: 'unavailable' };
    return runPurchase(store, verifier, plan, userId);
  },

  async restore(): Promise<PurchaseOutcome> {
    if (!(await connect())) return { status: 'unavailable' };
    return runRestore(store, verifier);
  },

  async manage(): Promise<PurchaseOutcome> {
    try {
      await deepLinkToSubscriptions({});
      return { status: 'started' };
    } catch (e) {
      return { status: 'error', message: (e as Error).message || 'Could not open your subscriptions.' };
    }
  },
};

/**
 * The standing listener for everything the store delivers outside a
 * purchase call — renewals, Ask to Buy approvals, a transaction left
 * unfinished because the server was unreachable. Started once the account
 * is known, because verifying needs the session. Returns the unsubscribe.
 */
export function startStoreKitReconciler(onSettled: () => void): () => void {
  if (!hostCanSell()) return () => {};
  let off: (() => void) | null = null;
  let stopped = false;
  void connect().then((ok) => {
    if (ok && !stopped) off = reconcile(store, verifier, onSettled);
  });
  return () => {
    stopped = true;
    off?.();
  };
}
