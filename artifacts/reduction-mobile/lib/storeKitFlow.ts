/**
 * lib/storeKitFlow.ts — the purchase flow, with the store behind an
 * interface so the flow can be proven under node. One flow for both
 * stores: the App Store and Google Play differ in what they hand back
 * (a signed JWS, an opaque purchase token) and in what "finish" means
 * (finish a transaction, acknowledge a purchase), and lib/storeKit.ts
 * binds each to this interface; the order below holds for either.
 *
 * WHAT MUST HOLD, whatever the library does:
 *
 *  - A transaction is FINISHED only after the server has verified and
 *    recorded it. Finishing first and verifying second would let a purchase
 *    the server never saw (a network drop between the two) vanish from the
 *    queue, with money taken and nothing unlocked. Left unfinished, StoreKit
 *    re-delivers it on the next launch and the reconciler tries again.
 *  - Only OUR products are verified or finished from here. Anything else in
 *    the queue is not this app's business.
 *  - The listener is the source of truth for a purchase, never the return
 *    value of the request (the library says so too): renewals, Ask to Buy
 *    approvals and unfinished transactions all arrive the same way.
 *  - A PENDING purchase (Google Play, a payment that has not cleared) is
 *    neither verified nor finished: it is reported as started, and the
 *    same purchase arrives again, cleared, through the listener.
 *  - Google Play does NOT re-deliver an unacknowledged purchase on its
 *    own, the way StoreKit re-delivers an unfinished transaction, and
 *    refunds one left unacknowledged for three days. So on Play the
 *    reconciler also sweeps the store's purchases once at start
 *    (`sweep`), and the server acknowledges too (billing/googlePlay.ts).
 */

import {
  newestOwnPurchase,
  outcomeFromStoreError,
  PLAN_SKUS,
  type Plan,
  type PurchaseOutcome,
  type StorePurchase,
} from './purchasePolicy';
import type { StoreWords } from './storeWords';

export interface StoreError {
  code: string;
  message?: string | null;
}

/** The slice of the store the flow needs. lib/storeKit.ts binds expo-iap
 *  to it; the tests bind a scripted fake. */
export interface Store<P extends StorePurchase> {
  /** What this store is called in the sentences the flow returns. */
  readonly words: StoreWords;
  /** Ask the store to sell `sku` to this account. The result arrives
   *  through `onPurchase`/`onError`, not here. */
  requestSubscription(sku: string, appAccountToken: string): Promise<void>;
  onPurchase(listener: (p: P) => void): () => void;
  onError(listener: (e: StoreError) => void): () => void;
  finish(p: P): Promise<void>;
  availablePurchases(): Promise<P[]>;
  /** Google Play only: whether this purchase still needs settling (it was
   *  never acknowledged). Absent on a store that re-delivers by itself. */
  unfinished?(p: P): boolean;
}

export interface Verifier<B = unknown> {
  /** What the server is sent for this purchase, or null when it is not one
   *  of ours, has not cleared, or carries nothing verifiable. */
  bodyFrom(p: StorePurchase): B | null;
  /** POST it to the server. Rejects when refused. */
  verify(body: B): Promise<void>;
}

/**
 * Verify with the server, then finish with the store. `false` when the
 * purchase is not ours, `true` when it is now recorded and finished;
 * throws when the server refused, leaving the transaction unfinished on
 * purpose.
 */
export async function settle<P extends StorePurchase>(store: Store<P>, verifier: Verifier, p: P): Promise<boolean> {
  const body = verifier.bodyFrom(p);
  if (!body) return false;
  await verifier.verify(body);
  await store.finish(p);
  return true;
}

/**
 * One purchase, start to outcome. Resolves when our product arrives and is
 * settled, when the store reports an error, or when the server refuses.
 * A purchase of some OTHER product arriving meanwhile is ignored, not
 * treated as this one.
 */
export function purchase<P extends StorePurchase>(
  store: Store<P>,
  verifier: Verifier,
  plan: Plan,
  userId: string
): Promise<PurchaseOutcome> {
  const sku = PLAN_SKUS[plan];
  return new Promise<PurchaseOutcome>((resolve) => {
    let done = false;
    const finishWith = (o: PurchaseOutcome) => {
      if (done) return;
      done = true;
      offPurchase();
      offError();
      resolve(o);
    };
    const offPurchase = store.onPurchase((p) => {
      if (p.productId !== sku) return;
      if (p.purchaseState === 'pending') {
        finishWith({ status: 'started' });
        return;
      }
      settle(store, verifier, p)
        .then((ok) => finishWith(ok ? { status: 'completed' } : { status: 'error', message: 'The purchase could not be verified.' }))
        .catch((e) => finishWith({ status: 'error', message: (e as Error).message || 'The purchase could not be recorded.' }));
    });
    const offError = store.onError((e) => finishWith(outcomeFromStoreError(e.code, e.message, store.words)));
    store.requestSubscription(sku, userId).catch((e) => {
      const err = e as { code?: string; message?: string };
      finishWith(err?.code ? outcomeFromStoreError(err.code, err.message, store.words) : { status: 'error', message: err?.message || 'The purchase could not be started.' });
    });
  });
}

/** Restore: the newest of this store account's purchases that is ours, verified
 *  and bound to this account. The account binding is the server's: a
 *  subscription already bound to another account is refused there. */
export async function restore<P extends StorePurchase>(store: Store<P>, verifier: Verifier): Promise<PurchaseOutcome> {
  let purchases: P[];
  try {
    purchases = await store.availablePurchases();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err?.code ? outcomeFromStoreError(err.code, err.message, store.words) : { status: 'error', message: err?.message || 'Could not read your purchases.' };
  }
  const newest = newestOwnPurchase(purchases);
  if (!newest) return { status: 'error', message: `No Reduction subscription was found for this ${store.words.account}.` };
  try {
    const ok = await settle(store, verifier, newest);
    return ok ? { status: 'completed' } : { status: 'error', message: 'That purchase could not be verified.' };
  } catch (e) {
    return { status: 'error', message: (e as Error).message || 'That purchase could not be recorded.' };
  }
}

/**
 * The standing listener: everything the store delivers outside a purchase
 * call — a renewal, an Ask to Buy approval, a transaction left unfinished
 * because the server was unreachable last time — is settled the same way.
 * Returns the unsubscribe. `onSettled` lets the app refresh the entitlement.
 */
export function reconcile<P extends StorePurchase>(store: Store<P>, verifier: Verifier, onSettled: () => void): () => void {
  return store.onPurchase((p) => {
    settle(store, verifier, p)
      .then((ok) => {
        if (ok) onSettled();
      })
      .catch(() => {
        // Left unfinished on purpose: it comes back next launch.
      });
  });
}

/**
 * Google Play's half of the reconciler: settle, once, every purchase of
 * ours the store still holds unacknowledged — one whose verify or
 * acknowledge never landed (the app closed, the network dropped). Play
 * will not hand it back through the listener, so without this it would be
 * refunded after three days with the person never unlocked. A store with
 * no `unfinished` has nothing to sweep. Resolves to how many were settled.
 */
export async function sweep<P extends StorePurchase>(store: Store<P>, verifier: Verifier, onSettled: () => void): Promise<number> {
  if (!store.unfinished) return 0;
  let purchases: P[];
  try {
    purchases = await store.availablePurchases();
  } catch {
    return 0;
  }
  let settled = 0;
  for (const p of purchases) {
    if (!store.unfinished(p)) continue;
    try {
      if (await settle(store, verifier, p)) settled++;
    } catch {
      // Left as it is: the next launch sweeps it again.
    }
  }
  if (settled) onSettled();
  return settled;
}
