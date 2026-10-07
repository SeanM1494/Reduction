/**
 * lib/storeKit.ts — the store handler for lib/purchase.ts, on expo-iap:
 * the App Store on an iPhone, Google Play on Android.
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
 * GOOGLE PLAY, THE SAME FLOW WITH THREE DIFFERENCES. The purchase token
 * is opaque, so the server asks Google about it
 * (POST /api/billing/google/verify) instead of checking a signature; the
 * account rides as `obfuscatedAccountId` (the user id, which Play echoes
 * back as obfuscatedExternalAccountId); and "finish" is ACKNOWLEDGE, which
 * the server also does, so the client's acknowledge failing on an already
 * acknowledged purchase is expected and swallowed. A Play subscription is
 * bought through one of its offers, so `offers()` remembers each plan's
 * base-plan offer token for `purchase()` to use.
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
import { fetchBillingConfig, verifyApplePurchase, verifyGooglePurchase } from './api';
import type { Offer, PurchaseHandler, PurchaseOutcome } from './purchase';
import {
  basePlanOffer,
  googleVerifyBodyFrom,
  offersFrom,
  plainPrice,
  PLAN_ORDER,
  PLAN_SKUS,
  verifyBodyFrom,
  type Plan,
} from './purchasePolicy';
import { purchase as runPurchase, reconcile, restore as runRestore, sweep, type Store, type Verifier } from './storeKitFlow';
import { STORE_WORDS, storeHostOf } from './storeWords';

type StorePurchase = Purchase & { transactionDate: number; isAcknowledgedAndroid?: boolean | null };

const host = storeHostOf(Platform.OS);
const isAndroid = host === 'android';

/** The app's own package on Play, which the subscriptions page needs.
 *  The same string as app.json's android.package. */
const ANDROID_PACKAGE = 'com.recipereduction.mobile';

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

/** Play's offer token per plan sku, from the last `offers()`. A purchase
 *  is only ever started from a box that has fetched them. */
const playOfferTokens = new Map<string, string>();

const store: Store<StorePurchase> = {
  words: STORE_WORDS[host],
  async requestSubscription(sku, appAccountToken) {
    if (!isAndroid) {
      await requestPurchase({ request: { apple: { sku, appAccountToken } }, type: 'subs' });
      return;
    }
    const offerToken = playOfferTokens.get(sku);
    if (!offerToken) throw Object.assign(new Error('That plan is not available right now.'), { code: 'sku-not-found' });
    await requestPurchase({
      request: { google: { skus: [sku], obfuscatedAccountId: appAccountToken, subscriptionOffers: [{ sku, offerToken }] } },
      type: 'subs',
    });
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
    if (!isAndroid) {
      await finishTransaction({ purchase: p, isConsumable: false });
      return;
    }
    // The server has acknowledged by now (billing/googlePlay.ts); this is
    // the belt to its braces, and Play refuses a second acknowledge.
    if (p.isAcknowledgedAndroid) return;
    try {
      await finishTransaction({ purchase: p, isConsumable: false });
    } catch (e) {
      trace('acknowledge refused (the server may already have):', describeError(e));
    }
  },
  async availablePurchases() {
    return (await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true })) as StorePurchase[];
  },
  ...(isAndroid ? { unfinished: (p: StorePurchase) => p.isAcknowledgedAndroid === false } : {}),
};

const verifier: Verifier<{ signedTransactionInfo: string } | { purchaseToken: string }> = isAndroid
  ? {
      bodyFrom: googleVerifyBodyFrom,
      async verify(body) {
        await verifyGooglePurchase(body as { purchaseToken: string });
      },
    }
  : {
      bodyFrom: verifyBodyFrom,
      async verify(body) {
        await verifyApplePurchase(body as { signedTransactionInfo: string });
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

/** A simulator cannot buy from the App Store; an Android emulator with
 *  Google Play installed can buy from Play (test accounts), so only iOS
 *  asks whether this is a device. */
const hostCanSell = () => (Platform.OS === 'ios' && Device.isDevice) || isAndroid;

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
        nativePurchase: cfg.nativePurchase,
        purchaseAvailable: cfg.purchaseAvailable,
      });
      // Per store, so an Android phone is never told it can sell because
      // the APPLE adapter is configured. `nativePurchaseAvailable` is the
      // Apple answer older iPhone builds read; a server too old to say
      // `nativePurchase` cannot record a Play purchase at all.
      const can = isAndroid ? cfg.nativePurchase?.android === true : (cfg.nativePurchase?.ios ?? cfg.nativePurchaseAvailable);
      if (!can) return false;
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
    if (isAndroid) {
      playOfferTokens.clear();
      for (const p of products) {
        const offer = basePlanOffer((p as { subscriptionOffers?: Parameters<typeof basePlanOffer>[0] }).subscriptionOffers);
        if (offer?.offerTokenAndroid) playOfferTokens.set(p.id, offer.offerTokenAndroid);
      }
    }
    const offers = offersFrom(
      products
        // A Play product with no offer to buy it through cannot be sold.
        .filter((p) => !isAndroid || playOfferTokens.has(p.id))
        .map((p) => ({ id: p.id, displayPrice: isAndroid ? plainPrice(p.displayPrice) : p.displayPrice }))
    );
    if (offers.length !== skus.length) {
      trace(
        'missing from the store:',
        skus.filter((s) => !offers.some((o) => o.sku === s)),
        isAndroid
          ? '(a product Play has not returned: not active, no active base plan, the build not on a testing track, or a tester account not signed in — Play does not say which)'
          : '(a product Apple has not returned: agreement, status, bundle id, or propagation — the store does not say which)'
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
      await deepLinkToSubscriptions(isAndroid ? { packageNameAndroid: ANDROID_PACKAGE } : {});
      return { status: 'started' };
    } catch (e) {
      return { status: 'error', message: (e as Error).message || 'Could not open your subscriptions.' };
    }
  },
};

/**
 * The standing listener for everything the store delivers outside a
 * purchase call — renewals, Ask to Buy approvals, a transaction left
 * unfinished because the server was unreachable, a Play payment that has
 * just cleared — plus, on Play, one sweep of what is still unacknowledged. Started once the account
 * is known, because verifying needs the session. Returns the unsubscribe.
 */
export function startStoreKitReconciler(onSettled: () => void): () => void {
  if (!hostCanSell()) return () => {};
  let off: (() => void) | null = null;
  let stopped = false;
  void connect().then((ok) => {
    if (!ok || stopped) return;
    off = reconcile(store, verifier, onSettled);
    // Google Play only (the store has `unfinished`): anything left
    // unacknowledged by an earlier launch, settled before Play refunds it.
    void sweep(store, verifier, onSettled);
  });
  return () => {
    stopped = true;
    off?.();
  };
}
