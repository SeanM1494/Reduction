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
  getStorefront,
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

/**
 * Dev-only trace of what the store actually answers, in the Metro console.
 *
 * Every failure on the way to a price is swallowed by design further up —
 * `available()` answers false, `offers()` answers [], SubscribeBox renders
 * nothing — which is right for a user and useless for whoever is holding
 * the phone asking why the wall is empty. So in a dev build each step says
 * what it asked and what came back: the host that answered the config, the
 * connection, the storefront, the products by id and price, and any error
 * with the fields expo-iap normalises native failures into (`code`,
 * `debugMessage`, `responseCode`). Silent in a release build: `__DEV__` is
 * false there and the branch is dead code.
 *
 * expo-iap's own logger is enabled the same way: it is silent unless
 * `globalThis.EXPO_IAP_DEV_MODE` is true, and its `[Expo-IAP Debug]` lines
 * show the request as the library saw it, one layer nearer the native call.
 */
const trace = (...args: unknown[]) => {
  if (__DEV__) console.log('[storekit]', ...args);
};
if (__DEV__) (globalThis as { EXPO_IAP_DEV_MODE?: boolean }).EXPO_IAP_DEV_MODE = true;

function describeError(e: unknown): Record<string, unknown> {
  const r = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
  return {
    code: r.code,
    message: r.message ?? (typeof e === 'string' ? e : undefined),
    debugMessage: r.debugMessage,
    responseCode: r.responseCode,
    productIds: r.productIds,
  };
}

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
    connected = initConnection()
      .then((ok) => {
        trace('initConnection ->', ok);
        return ok;
      })
      .catch((e) => {
        trace('initConnection FAILED', describeError(e));
        connected = null;
        return false;
      });
  }
  return connected;
}

const hostCanSell = () => Platform.OS === 'ios' && Device.isDevice;

export const storeKitHandler: PurchaseHandler = {
  async available() {
    if (!hostCanSell()) {
      trace('available: host cannot sell', { os: Platform.OS, isDevice: Device.isDevice });
      return false;
    }
    try {
      const cfg = await fetchBillingConfig();
      // The host is the one that matters: a dev build asks whichever server
      // its dev server names, which is not necessarily the deployment whose
      // preflight was just run.
      trace('available: /api/billing/config from', process.env.EXPO_PUBLIC_DOMAIN, '->', {
        nativePurchaseAvailable: cfg.nativePurchaseAvailable,
        purchaseAvailable: cfg.purchaseAvailable,
      });
      if (!cfg.nativePurchaseAvailable) return false;
    } catch (e) {
      trace('available: /api/billing/config FAILED', describeError(e));
      return false;
    }
    return connect();
  },

  async offers(): Promise<Offer[]> {
    if (!(await connect())) return [];
    const skus = PLAN_ORDER.map((p) => PLAN_SKUS[p]);
    if (__DEV__) {
      try {
        trace('storefront ->', await getStorefront());
      } catch (e) {
        trace('storefront FAILED', describeError(e));
      }
    }
    trace('fetchProducts asking for', skus);
    let products;
    try {
      products = (await fetchProducts({ skus, type: 'subs' })) ?? [];
    } catch (e) {
      // Rethrown so the caller's own handling is unchanged; the log is the
      // point. Unknown SKUs never throw — they are simply absent from the
      // result — so an error here is the store or the connection, not the
      // catalogue.
      trace('fetchProducts FAILED', describeError(e));
      throw e;
    }
    trace(
      `fetchProducts -> ${products.length} product(s)`,
      products.map((p) => ({ id: p.id, displayPrice: p.displayPrice, type: p.type, platform: p.platform }))
    );
    const offers = offersFrom(products.map((p) => ({ id: p.id, displayPrice: p.displayPrice })));
    if (offers.length !== skus.length) {
      trace(
        'missing from the store:',
        skus.filter((s) => !offers.some((o) => o.sku === s)),
        '(a product Apple has not returned: agreement, status, bundle id, or propagation — the store does not say which)'
      );
    }
    return offers;
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
