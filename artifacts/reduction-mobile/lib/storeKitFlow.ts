/**
 * lib/storeKitFlow.ts — the purchase flow, with the store behind an
 * interface so the flow can be proven under node.
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
 */

import {
  newestOwnPurchase,
  outcomeFromStoreError,
  PLAN_SKUS,
  verifyBodyFrom,
  type Plan,
  type PurchaseOutcome,
  type StorePurchase,
} from './purchasePolicy';

export interface StoreError {
  code: string;
  message?: string | null;
}

/** The slice of the store the flow needs. lib/storeKit.ts binds expo-iap
 *  to it; the tests bind a scripted fake. */
export interface Store<P extends StorePurchase> {
  /** Ask the store to sell `sku` to this account. The result arrives
   *  through `onPurchase`/`onError`, not here. */
  requestSubscription(sku: string, appAccountToken: string): Promise<void>;
  onPurchase(listener: (p: P) => void): () => void;
  onError(listener: (e: StoreError) => void): () => void;
  finish(p: P): Promise<void>;
  availablePurchases(): Promise<P[]>;
}

export interface Verifier {
  /** POST the signed transaction to the server. Rejects when refused. */
  verify(body: { signedTransactionInfo: string }): Promise<void>;
}

/**
 * Verify with the server, then finish with the store. `false` when the
 * purchase is not ours, `true` when it is now recorded and finished;
 * throws when the server refused, leaving the transaction unfinished on
 * purpose.
 */
export async function settle<P extends StorePurchase>(store: Store<P>, verifier: Verifier, p: P): Promise<boolean> {
  const body = verifyBodyFrom(p);
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
      settle(store, verifier, p)
        .then((ok) => finishWith(ok ? { status: 'completed' } : { status: 'error', message: 'The purchase could not be verified.' }))
        .catch((e) => finishWith({ status: 'error', message: (e as Error).message || 'The purchase could not be recorded.' }));
    });
    const offError = store.onError((e) => finishWith(outcomeFromStoreError(e.code, e.message)));
    store.requestSubscription(sku, userId).catch((e) => {
      const err = e as { code?: string; message?: string };
      finishWith(err?.code ? outcomeFromStoreError(err.code, err.message) : { status: 'error', message: err?.message || 'The purchase could not be started.' });
    });
  });
}

/** Restore: the newest of this Apple ID's purchases that is ours, verified
 *  and bound to this account. The account binding is the server's: a
 *  subscription already bound to another account is refused there. */
export async function restore<P extends StorePurchase>(store: Store<P>, verifier: Verifier): Promise<PurchaseOutcome> {
  let purchases: P[];
  try {
    purchases = await store.availablePurchases();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err?.code ? outcomeFromStoreError(err.code, err.message) : { status: 'error', message: err?.message || 'Could not read your purchases.' };
  }
  const newest = newestOwnPurchase(purchases);
  if (!newest) return { status: 'error', message: 'No Reduction subscription was found for this Apple ID.' };
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
