import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeJws, newestOwnPurchase, offersFrom, outcomeFromStoreError, PLAN_SKUS, planOf, verifyBodyFrom } from "./purchasePolicy";

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
