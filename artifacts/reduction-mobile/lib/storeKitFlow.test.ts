import { test } from "node:test";
import assert from "node:assert/strict";
import { googleVerifyBodyFrom, PLAN_SKUS, verifyBodyFrom, type StorePurchase } from "./purchasePolicy";
import { purchase, reconcile, restore, sweep, type Store, type StoreError, type Verifier } from "./storeKitFlow";
import { STORE_WORDS } from "./storeWords";

const JWS = "eyJhbGciOiJFUzI1NiJ9.eyJ0cmFuc2FjdGlvbklkIjoiMSJ9.c2ln";
interface P extends StorePurchase { transactionId: string }
const own = (id: string, sku = PLAN_SKUS.monthly, date = 1): P => ({ productId: sku, purchaseToken: JWS, transactionDate: date, transactionId: id });

/** A scripted store: `requestSubscription` records the ask, and the test
 *  delivers purchases or errors through the listeners like StoreKit would. */
function fakeStore(opts: { available?: P[]; availableThrows?: StoreError; play?: boolean; acked?: Set<string> } = {}) {
  const purchaseListeners = new Set<(p: P) => void>();
  const errorListeners = new Set<(e: StoreError) => void>();
  const finished: string[] = [];
  const asked: Array<{ sku: string; token: string }> = [];
  const store: Store<P> = {
    words: opts.play ? STORE_WORDS.android : STORE_WORDS.ios,
    ...(opts.play ? { unfinished: (p: P) => !(opts.acked ?? new Set()).has(p.transactionId) } : {}),
    async requestSubscription(sku, appAccountToken) {
      asked.push({ sku, token: appAccountToken });
    },
    onPurchase(l) {
      purchaseListeners.add(l);
      return () => purchaseListeners.delete(l);
    },
    onError(l) {
      errorListeners.add(l);
      return () => errorListeners.delete(l);
    },
    async finish(p) {
      finished.push(p.transactionId);
    },
    async availablePurchases() {
      if (opts.availableThrows) throw opts.availableThrows;
      return opts.available ?? [];
    },
  };
  return {
    store,
    finished,
    asked,
    deliver: (p: P) => purchaseListeners.forEach((l) => l(p)),
    fail: (e: StoreError) => errorListeners.forEach((l) => l(e)),
    listeners: () => purchaseListeners.size + errorListeners.size,
  };
}
function fakeVerifier(opts: { refuse?: string; play?: boolean } = {}) {
  const bodies: string[] = [];
  const verifier: Verifier<{ signedTransactionInfo?: string; purchaseToken?: string }> = {
    bodyFrom: opts.play ? googleVerifyBodyFrom : verifyBodyFrom,
    async verify(body) {
      bodies.push(body.signedTransactionInfo ?? body.purchaseToken ?? "");
      if (opts.refuse) throw new Error(opts.refuse);
    },
  };
  return { verifier, bodies };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("purchase: asks the store with the account token, verifies, THEN finishes, and detaches", async () => {
  const s = fakeStore();
  const v = fakeVerifier();
  const out = purchase(s.store, v.verifier, "yearly", "user-1");
  await tick();
  assert.deepEqual(s.asked, [{ sku: PLAN_SKUS.yearly, token: "user-1" }]);
  s.deliver(own("t1", PLAN_SKUS.yearly));
  assert.deepEqual(await out, { status: "completed" });
  assert.deepEqual(v.bodies, [JWS]);
  assert.deepEqual(s.finished, ["t1"]);
  assert.equal(s.listeners(), 0, "listeners removed after the outcome");
});

test("purchase: a refused verification leaves the transaction UNFINISHED", async () => {
  const s = fakeStore();
  const v = fakeVerifier({ refuse: "That purchase belongs to a different account." });
  const out = purchase(s.store, v.verifier, "monthly", "user-1");
  await tick();
  s.deliver(own("t1"));
  assert.deepEqual(await out, { status: "error", message: "That purchase belongs to a different account." });
  assert.deepEqual(s.finished, [], "not finished: StoreKit re-delivers it next launch");
});

test("purchase: some other product arriving is not this purchase", async () => {
  const s = fakeStore();
  const v = fakeVerifier();
  let settled = false;
  const out = purchase(s.store, v.verifier, "monthly", "user-1").then((o) => {
    settled = true;
    return o;
  });
  await tick();
  s.deliver(own("other", "com.example.other"));
  await tick();
  assert.equal(settled, false);
  assert.deepEqual(s.finished, []);
  s.deliver(own("t2"));
  assert.deepEqual(await out, { status: "completed" });
});

test("purchase: cancel, Ask to Buy and a missing store come back as their own outcomes", async () => {
  for (const [code, status] of [["user-cancelled", "cancelled"], ["deferred-payment", "started"], ["iap-not-available", "unavailable"]] as const) {
    const s = fakeStore();
    const out = purchase(s.store, fakeVerifier().verifier, "monthly", "u");
    await tick();
    s.fail({ code });
    assert.equal((await out).status, status, code);
    assert.equal(s.listeners(), 0);
  }
});

test("purchase: a request that throws resolves as an error rather than hanging", async () => {
  const s = fakeStore();
  s.store.requestSubscription = async () => {
    throw { code: "sku-not-found", message: "No such product." };
  };
  assert.deepEqual(await purchase(s.store, fakeVerifier().verifier, "monthly", "u"), { status: "error", message: "No such product." });
});

test("restore: verifies and finishes the newest of ours; nothing of ours is a plain answer", async () => {
  const s = fakeStore({ available: [own("old", PLAN_SKUS.monthly, 1), own("new", PLAN_SKUS.yearly, 5), own("x", "com.example.other", 9)] });
  const v = fakeVerifier();
  assert.deepEqual(await restore(s.store, v.verifier), { status: "completed" });
  assert.deepEqual(s.finished, ["new"]);
  assert.equal(v.bodies.length, 1);

  const none = fakeStore({ available: [own("x", "com.example.other", 9)] });
  assert.equal((await restore(none.store, v.verifier)).status, "error");
  const broken = fakeStore({ availableThrows: { code: "network-error" } });
  assert.equal((await restore(broken.store, v.verifier)).status, "error");
});

test("reconcile: settles ours, ignores others, keeps a refused one unfinished, and stops on unsubscribe", async () => {
  const s = fakeStore();
  let settled = 0;
  const refuseOnce = { refuse: "" };
  const verifier: Verifier = {
    bodyFrom: verifyBodyFrom,
    async verify() {
      if (refuseOnce.refuse) throw new Error(refuseOnce.refuse);
    },
  };
  const off = reconcile(s.store, verifier, () => settled++);
  s.deliver(own("renewal"));
  s.deliver(own("other", "com.example.other"));
  await tick();
  assert.equal(settled, 1);
  assert.deepEqual(s.finished, ["renewal"]);
  refuseOnce.refuse = "server down";
  s.deliver(own("t9"));
  await tick();
  assert.equal(settled, 1);
  assert.deepEqual(s.finished, ["renewal"], "the refused one stays in the queue");
  off();
  assert.equal(s.listeners(), 0);
});

// ------------------------------------------------------------ Google Play ---

const playOwn = (id: string, state = "purchased", sku = PLAN_SKUS.monthly, date = 1): P => ({
  productId: sku,
  purchaseToken: `play-token-${id}`,
  transactionDate: date,
  transactionId: id,
  purchaseState: state,
});

test("play: a pending purchase is reported started, and neither verified nor acknowledged", async () => {
  const s = fakeStore({ play: true });
  const v = fakeVerifier({ play: true });
  const out = purchase(s.store, v.verifier, "monthly", "user-1");
  await tick();
  s.deliver(playOwn("p1", "pending"));
  assert.deepEqual(await out, { status: "started" });
  assert.deepEqual(v.bodies, []);
  assert.deepEqual(s.finished, []);
  assert.equal(s.listeners(), 0);
});

test("play: a cleared purchase is verified with its token, THEN acknowledged", async () => {
  const s = fakeStore({ play: true });
  const v = fakeVerifier({ play: true });
  const out = purchase(s.store, v.verifier, "yearly", "user-1");
  await tick();
  s.deliver(playOwn("p2", "purchased", PLAN_SKUS.yearly));
  assert.deepEqual(await out, { status: "completed" });
  assert.deepEqual(v.bodies, ["play-token-p2"]);
  assert.deepEqual(s.finished, ["p2"]);
});

test("play: the reconciler settles a pending purchase only once it clears", async () => {
  const s = fakeStore({ play: true });
  const v = fakeVerifier({ play: true });
  let settled = 0;
  const off = reconcile(s.store, v.verifier, () => settled++);
  s.deliver(playOwn("p3", "pending"));
  await tick();
  assert.equal(settled, 0);
  s.deliver(playOwn("p3", "purchased"));
  await tick();
  assert.equal(settled, 1);
  assert.deepEqual(s.finished, ["p3"]);
  off();
});

test("play: the sweep settles only purchases still unacknowledged, and only ours", async () => {
  const other: P = { ...playOwn("x"), productId: "com.example.other" };
  const s = fakeStore({ play: true, acked: new Set(["done"]), available: [playOwn("done"), playOwn("left"), other] });
  const v = fakeVerifier({ play: true });
  let settled = 0;
  assert.equal(await sweep(s.store, v.verifier, () => settled++), 1);
  assert.deepEqual(v.bodies, ["play-token-left"]);
  assert.deepEqual(s.finished, ["left"]);
  assert.equal(settled, 1);
});

test("play: a sweep the server refuses leaves the purchase for next launch", async () => {
  const s = fakeStore({ play: true, available: [playOwn("p4")] });
  const v = fakeVerifier({ play: true, refuse: "nope" });
  assert.equal(await sweep(s.store, v.verifier, () => {}), 0);
  assert.deepEqual(s.finished, []);
});

test("sweep does nothing on a store that re-delivers by itself", async () => {
  const s = fakeStore({ available: [own("t1")] });
  const v = fakeVerifier();
  assert.equal(await sweep(s.store, v.verifier, () => {}), 0);
  assert.deepEqual(v.bodies, []);
});

test("play: the restore message names the Google account, not an Apple ID", async () => {
  const s = fakeStore({ play: true, available: [] });
  const v = fakeVerifier({ play: true });
  assert.deepEqual(await restore(s.store, v.verifier), {
    status: "error",
    message: "No Reduction subscription was found for this Google account.",
  });
});
