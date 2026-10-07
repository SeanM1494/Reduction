import { test } from "node:test";
import assert from "node:assert/strict";
import { basePlanOffer, googleVerifyBodyFrom, looksLikeJws, newestOwnPurchase, offersFrom, outcomeFromStoreError, plainPrice, PLAN_SKUS, planOf, verifyBodyFrom } from "./purchasePolicy";
import { STORE_WORDS } from "./storeWords";

const JWS = "eyJhbGciOiJFUzI1NiJ9.eyJ0cmFuc2FjdGlvbklkIjoiMSJ9.c2ln";

test("the two products are distinct and round-trip through planOf", () => {
  assert.notEqual(PLAN_SKUS.monthly, PLAN_SKUS.yearly);
  // The literal strings, pinned: these are the ids in App Store Connect
  // under the record whose bundle id the build carries. The un-suffixed
  // originals are burned account-wide (see purchasePolicy.ts) and must not
  // come back; a change here is a change in App Store Connect first.
  assert.deepEqual(PLAN_SKUS, {
    monthly: "com.recipereduction.mobile.plan.monthly",
    yearly: "com.recipereduction.mobile.plan.yearly",
  });
  assert.equal(planOf(PLAN_SKUS.monthly), "monthly");
  assert.equal(planOf(PLAN_SKUS.yearly), "yearly");
  assert.equal(planOf("com.example.other"), null);
});

test("offersFrom keeps display order and drops plans the store does not know", () => {
  const both = offersFrom([
    { id: PLAN_SKUS.yearly, displayPrice: "$19.99" },
    { id: "com.example.other", displayPrice: "$0.99" },
    { id: PLAN_SKUS.monthly, displayPrice: "$1.99" },
  ]);
  assert.deepEqual(both.map((o) => [o.plan, o.price]), [["monthly", "$1.99"], ["yearly", "$19.99"]]);
  assert.deepEqual(offersFrom([{ id: PLAN_SKUS.yearly, displayPrice: "$19.99" }]).map((o) => o.plan), ["yearly"]);
  assert.deepEqual(offersFrom([]), []);
});

test("verifyBodyFrom sends only our products, and only a JWS", () => {
  assert.deepEqual(verifyBodyFrom({ productId: PLAN_SKUS.monthly, purchaseToken: JWS, transactionDate: 1 }), { signedTransactionInfo: JWS });
  assert.equal(verifyBodyFrom({ productId: "com.example.other", purchaseToken: JWS, transactionDate: 1 }), null);
  assert.equal(verifyBodyFrom({ productId: PLAN_SKUS.monthly, purchaseToken: "not-a-jws", transactionDate: 1 }), null);
  assert.equal(verifyBodyFrom({ productId: PLAN_SKUS.monthly, purchaseToken: null, transactionDate: 1 }), null);
  assert.equal(looksLikeJws("a.b"), false);
});

test("newestOwnPurchase picks the latest of ours and ignores the rest", () => {
  const p = newestOwnPurchase([
    { productId: PLAN_SKUS.monthly, transactionDate: 10 },
    { productId: "com.example.other", transactionDate: 99 },
    { productId: PLAN_SKUS.yearly, transactionDate: 20 },
  ]);
  assert.equal(p?.productId, PLAN_SKUS.yearly);
  assert.equal(newestOwnPurchase([{ productId: "com.example.other", transactionDate: 99 }]), null);
  assert.equal(newestOwnPurchase([]), null);
});

test("outcomeFromStoreError: a cancel is not an error, Ask to Buy is started, no store is unavailable", () => {
  assert.deepEqual(outcomeFromStoreError("user-cancelled"), { status: "cancelled" });
  assert.deepEqual(outcomeFromStoreError("deferred-payment"), { status: "started" });
  assert.deepEqual(outcomeFromStoreError("iap-not-available"), { status: "unavailable" });
  assert.equal(outcomeFromStoreError("network-error").status, "error");
  assert.equal(outcomeFromStoreError("already-owned").status, "error");
  assert.deepEqual(outcomeFromStoreError("unknown", "boom"), { status: "error", message: "boom" });
  assert.deepEqual(outcomeFromStoreError("unknown", null), { status: "error", message: "The purchase could not be completed." });
});

test("outcomeFromStoreError: the iOS sentences are unchanged, and Android names its own store", () => {
  assert.deepEqual(outcomeFromStoreError("network-error"), { status: "error", message: "The App Store could not be reached. Try again in a moment." });
  assert.deepEqual(outcomeFromStoreError("already-owned"), { status: "error", message: 'This Apple ID already has a subscription. Use "Restore purchases".' });
  assert.deepEqual(outcomeFromStoreError("network-error", null, STORE_WORDS.android), { status: "error", message: "Google Play could not be reached. Try again in a moment." });
  assert.deepEqual(outcomeFromStoreError("already-owned", null, STORE_WORDS.android), { status: "error", message: 'This Google account already has a subscription. Use "Restore purchases".' });
});

test("googleVerifyBodyFrom sends only our products, only once cleared, only with a token", () => {
  const base = { productId: PLAN_SKUS.yearly, purchaseToken: " tok ", transactionDate: 1 };
  assert.deepEqual(googleVerifyBodyFrom({ ...base, purchaseState: "purchased" }), { purchaseToken: "tok" });
  assert.deepEqual(googleVerifyBodyFrom(base), { purchaseToken: "tok" });
  assert.equal(googleVerifyBodyFrom({ ...base, purchaseState: "pending" }), null);
  assert.equal(googleVerifyBodyFrom({ ...base, productId: "com.example.other" }), null);
  assert.equal(googleVerifyBodyFrom({ ...base, purchaseToken: "" }), null);
  assert.equal(googleVerifyBodyFrom({ ...base, purchaseToken: "x".repeat(5000) }), null);
});

test("basePlanOffer picks the plain base plan over a trial, and something buyable over nothing", () => {
  const trial = { id: "free-week", basePlanIdAndroid: "monthly", offerTokenAndroid: "t-trial" };
  const plain = { id: "monthly", basePlanIdAndroid: "monthly", offerTokenAndroid: "t-plain" };
  const noId = { id: null, basePlanIdAndroid: "monthly", offerTokenAndroid: "t-noid" };
  assert.equal(basePlanOffer([trial, plain])?.offerTokenAndroid, "t-plain");
  assert.equal(basePlanOffer([trial, noId])?.offerTokenAndroid, "t-noid");
  assert.equal(basePlanOffer([trial])?.offerTokenAndroid, "t-trial");
  assert.equal(basePlanOffer([{ ...plain, offerTokenAndroid: null }]), null);
  assert.equal(basePlanOffer(null), null);
});

test("plainPrice drops a period the store already wrote", () => {
  assert.equal(plainPrice("$1.99"), "$1.99");
  assert.equal(plainPrice("$1.99/month"), "$1.99");
  assert.equal(plainPrice("19,99 € / year"), "19,99 €");
});
