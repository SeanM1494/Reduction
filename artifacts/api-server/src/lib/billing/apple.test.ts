/**
 * server/lib/billing/apple.test.ts — the App Store adapter, without a
 * database, without Apple.
 *
 * What this proves: the status translation (the whole provider-agnostic bet,
 * for the second provider), the facts derived from a signed transaction when
 * Apple gives no explicit status, the Server API token's shape and — the
 * one that bites — its 64-byte signature, the API client's request against a
 * loopback stub, and the configuration posture. What it cannot prove: that a
 * real Apple-signed payload verifies. See the header of apple.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import { Environment, VerificationException, VerificationStatus } from "@apple/app-store-server-library";
import {
  AppleEnvironmentUnconfigured,
  appStoreApiBase,
  appStoreApiJwt,
  appleIapConfig,
  describeAppleIapEnv,
  describeVerificationFailure,
  environmentDeclaredBy,
  environmentOfTransaction,
  fetchAppleSubscriptionStatus,
  normaliseAppleStatus,
  requestAppleTestNotification,
  resetAppleIapCache,
  selectingVerifier,
  subscriptionFromApple,
  type AppleEnvironment,
  type AppleIapConfig,
  type AppleVerifier,
} from "./apple";

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  resetAppleIapCache();
  const restore = () => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAppleIapCache();
  };
  const out = fn();
  if (out instanceof Promise) return out.finally(restore);
  restore();
  return undefined;
}

/** A self-signed EC certificate, DER, base64 — NOT an Apple root. It stands
 *  in for one only to prove the config loads and reports certificates; the
 *  verifier is never built from it here. */
const TEST_ROOT_B64 =
  "MIIBlzCCAT2gAwIBAgIUFpj+s/LuyTN38ZgRilBfQrvmHFAwCgYIKoZIzj0EAwIwITEfMB0GA1UEAwwWUmVkdWN0aW9uIFRlc3QgUm9vdCBDQTAeFw0yNjA5MTAwMTUxMzRaFw0zNjA5MDcwMTUxMzRaMCExHzAdBgNVBAMMFlJlZHVjdGlvbiBUZXN0IFJvb3QgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARevbKg4MGFxYXHyCOFM+92LyGYKOimi9ATQdTsBlqB2DryOf1+8mSp+HGJSnwb7KqPzRN8DPwOGQlfIRMcPVwfo1MwUTAdBgNVHQ4EFgQUFSPfLVtuy4YNAE3P5xlWq2Dis9YwHwYDVR0jBBgwFoAUFSPfLVtuy4YNAE3P5xlWq2Dis9YwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEAnpfexLrfCn+CtydX+U+cod4t3qnNL40eP/EVwZ50/hwCIBWZvE80LgbuQjHKN8S6aYwyDW8pxjCu9DuCcISe3WuZ";

const ALL_UNSET = {
  APPLE_BUNDLE_ID: undefined,
  APPLE_IAP_ENVIRONMENT: undefined,
  APPLE_APP_APPLE_ID: undefined,
  APPLE_ROOT_CERTS: undefined,
  APPLE_ROOT_CA_DIR: undefined,
  APPLE_IAP_KEY_ID: undefined,
  APPLE_IAP_ISSUER_ID: undefined,
  APPLE_IAP_PRIVATE_KEY: undefined,
  APPLE_STOREKIT_API_URL: undefined,
  APPLE_IAP_OFFLINE: undefined,
};

const { privateKey: TEST_KEY } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const TEST_KEY_PEM = TEST_KEY.export({ type: "pkcs8", format: "pem" }).toString();

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);

// ------------------------------------------------------------ translation ---

test("Apple's five statuses collapse to the three this app knows", () => {
  // 1 ACTIVE, 2 EXPIRED, 3 BILLING_RETRY, 4 BILLING_GRACE_PERIOD, 5 REVOKED.
  assert.equal(normaliseAppleStatus(1), "active");
  assert.equal(normaliseAppleStatus(2), "expired");
  // Both retry states are "Apple is still trying to collect" — the
  // provider's retry window, which is what grace means here. It ends when
  // Apple says so, never on a local timer.
  assert.equal(normaliseAppleStatus(3), "grace");
  assert.equal(normaliseAppleStatus(4), "grace");
  assert.equal(normaliseAppleStatus(5), "expired");
  // A status Apple adds later under-serves rather than entitles.
  assert.equal(normaliseAppleStatus(99), "expired");
});

test("without an explicit status, the dates decide", () => {
  const base = { originalTransactionId: "orig-1", transactionId: "tx-9" };

  const active = subscriptionFromApple({
    transaction: { ...base, expiresDate: NOW + 30 * 24 * 60 * MIN },
    now: NOW,
  })!;
  assert.equal(active.status, "active");
  assert.equal(active.providerRef, "orig-1", "the original id, which survives every renewal");
  assert.equal(active.renewsAt?.getTime(), NOW + 30 * 24 * 60 * MIN);
  assert.equal(active.willNotRenew, false);

  // Lapsed, and Apple is retrying the card: grace.
  const retrying = subscriptionFromApple({
    transaction: { ...base, expiresDate: NOW - MIN },
    renewalInfo: { isInBillingRetryPeriod: true, autoRenewStatus: 1 },
    now: NOW,
  })!;
  assert.equal(retrying.status, "grace");

  // Lapsed, inside a grace period Apple granted: grace, and access lapses
  // when THAT ends, not when the period did.
  const inGrace = subscriptionFromApple({
    transaction: { ...base, expiresDate: NOW - MIN },
    renewalInfo: { gracePeriodExpiresDate: NOW + 5 * 24 * 60 * MIN, autoRenewStatus: 1 },
    now: NOW,
  })!;
  assert.equal(inGrace.status, "grace");
  assert.equal(inGrace.renewsAt?.getTime(), NOW + 5 * 24 * 60 * MIN);

  // Lapsed, grace period also over, nobody retrying: expired.
  const over = subscriptionFromApple({
    transaction: { ...base, expiresDate: NOW - 10 * 24 * 60 * MIN },
    renewalInfo: { gracePeriodExpiresDate: NOW - MIN, isInBillingRetryPeriod: false },
    now: NOW,
  })!;
  assert.equal(over.status, "expired");

  // Refunded or revoked: expired regardless of the expiry date.
  const revoked = subscriptionFromApple({
    transaction: { ...base, expiresDate: NOW + 30 * 24 * 60 * MIN, revocationDate: NOW - MIN },
    now: NOW,
  })!;
  assert.equal(revoked.status, "expired");
});

test("auto-renew off is 'will not renew', and is NOT expired", () => {
  // This is how an Apple subscription is cancelled: it runs to the end of
  // the paid period. Treating it as expired would cut off someone who has
  // paid for the rest of the month — the same rule as cancel_at_period_end.
  const f = subscriptionFromApple({
    transaction: { originalTransactionId: "o", expiresDate: NOW + 10 * 24 * 60 * MIN },
    renewalInfo: { autoRenewStatus: 0 },
    now: NOW,
  })!;
  assert.equal(f.status, "active");
  assert.equal(f.willNotRenew, true);
});

test("an explicit status from Apple overrides what the dates suggest", () => {
  // Apple knows things the dates do not — a grace period it granted, a
  // revocation it processed. When it says, it wins.
  const f = subscriptionFromApple({
    transaction: { originalTransactionId: "o", expiresDate: NOW + 10 * 24 * 60 * MIN },
    status: 5,
    now: NOW,
  })!;
  assert.equal(f.status, "expired");
  const g = subscriptionFromApple({
    transaction: { originalTransactionId: "o", expiresDate: NOW - 10 * 24 * 60 * MIN },
    status: 4,
    now: NOW,
  })!;
  assert.equal(g.status, "grace");
});

test("a purchase that is not a subscription, or has no id, is nothing", () => {
  assert.equal(subscriptionFromApple({ transaction: { originalTransactionId: "o" }, now: NOW }), null);
  assert.equal(subscriptionFromApple({ transaction: { expiresDate: NOW + MIN }, now: NOW }), null);
  // A transaction id alone is accepted as the ref — a first purchase's
  // originalTransactionId equals its transactionId, and Apple has been
  // known to omit the former on some payloads.
  assert.equal(
    subscriptionFromApple({ transaction: { transactionId: "t", expiresDate: NOW + MIN }, now: NOW })?.providerRef,
    "t"
  );
});

// ------------------------------------------------------------------ config ---

test("unconfigured until it has a bundle id AND roots, and says which is missing", () => {
  withEnv(ALL_UNSET, () => {
    assert.equal(appleIapConfig(), null);
    const r = describeAppleIapEnv();
    assert.equal(r.configured, false);
    assert.deepEqual(r.missing, ["APPLE_BUNDLE_ID", "APPLE_ROOT_CERTS_or_APPLE_ROOT_CA_DIR", "APPLE_APP_APPLE_ID"]);
  });
  withEnv({ ...ALL_UNSET, APPLE_BUNDLE_ID: "com.example.reduction", APPLE_IAP_ENVIRONMENT: "sandbox" }, () => {
    assert.equal(appleIapConfig(), null, "no roots, nothing can be verified");
    // Sandbox does not need the App Store id, so it is not reported missing.
    assert.deepEqual(describeAppleIapEnv().missing, ["APPLE_ROOT_CERTS_or_APPLE_ROOT_CA_DIR"]);
  });
});

test("Production is the default environment, and requires the App Store id", () => {
  // Fail-closed direction: a sandbox payload against a production-configured
  // server is refused, never entitled.
  withEnv({ ...ALL_UNSET, APPLE_BUNDLE_ID: "com.example.reduction", APPLE_ROOT_CERTS: TEST_ROOT_B64 }, () => {
    assert.equal(appleIapConfig(), null, "Production without APPLE_APP_APPLE_ID cannot build a verifier");
    const r = describeAppleIapEnv();
    assert.equal(r.environment, "Production");
    assert.deepEqual(r.missing, ["APPLE_APP_APPLE_ID"]);
  });
  withEnv(
    { ...ALL_UNSET, APPLE_BUNDLE_ID: "com.example.reduction", APPLE_ROOT_CERTS: TEST_ROOT_B64, APPLE_APP_APPLE_ID: "123456789" },
    () => {
      const cfg = appleIapConfig()!;
      assert.equal(cfg.environment, "Production");
      assert.equal(cfg.appAppleId, 123456789);
      assert.equal(cfg.rootCerts.length, 1);
      assert.equal(cfg.api, null, "the Server API is optional");
      assert.equal(cfg.onlineChecks, true);
      // THE REVIEW CASE. App Review buys in Sandbox against this server, so
      // a production deployment must verify both.
      assert.deepEqual(cfg.verifies, ["Sandbox", "Production"]);
      assert.deepEqual((describeAppleIapEnv() as { verifies: string[] }).verifies, ["Sandbox", "Production"]);
    }
  );
  // A sandbox-selling server (the workspace) verifies sandbox only: without
  // the App Store id the library cannot bind a production payload.
  withEnv(
    { ...ALL_UNSET, APPLE_BUNDLE_ID: "com.example.reduction", APPLE_ROOT_CERTS: TEST_ROOT_B64, APPLE_IAP_ENVIRONMENT: "sandbox" },
    () => {
      const cfg = appleIapConfig()!;
      assert.equal(cfg.environment, "Sandbox");
      assert.deepEqual(cfg.verifies, ["Sandbox"]);
    }
  );
});

// ------------------------------------------- the environment a payload declares ---

/** A JWS-shaped string whose middle segment is the given payload, unsigned. */
const jwsOf = (payload: unknown) =>
  `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2ln`;

test("the declared environment is read from a transaction, a renewal info and a notification alike", () => {
  assert.equal(environmentDeclaredBy(jwsOf({ environment: "Sandbox", transactionId: "1" })), "Sandbox");
  assert.equal(environmentDeclaredBy(jwsOf({ environment: "Production", autoRenewStatus: 1 })), "Production");
  assert.equal(environmentDeclaredBy(jwsOf({ notificationType: "DID_RENEW", data: { environment: "Sandbox" } })), "Sandbox");
  // Unknown to this adapter, missing, or not even JSON: null, so the caller
  // falls back to the server's own environment rather than guessing.
  assert.equal(environmentDeclaredBy(jwsOf({ environment: "Xcode" })), null);
  assert.equal(environmentDeclaredBy(jwsOf({ transactionId: "1" })), null);
  assert.equal(environmentDeclaredBy("eyJhbGciOiJFUzI1NiJ9.bm90IGpzb24.c2ln"), null);
  assert.equal(environmentDeclaredBy("garbage"), null);
});

test("a verified transaction's environment is Sandbox or Production, nothing else", () => {
  assert.equal(environmentOfTransaction({ environment: Environment.SANDBOX } as any), "Sandbox");
  assert.equal(environmentOfTransaction({ environment: Environment.PRODUCTION } as any), "Production");
});

// ------------------------------------------------ dispatch by environment ---

/** A fake per-environment verifier that records which one was asked. */
function fakeVerifiers() {
  const calls: Array<[AppleEnvironment, string]> = [];
  const build = (env: AppleEnvironment): AppleVerifier => ({
    async notification(s) { calls.push([env, "notification"]); return { notificationType: "TEST" } as any; },
    async transaction(s) { calls.push([env, "transaction"]); return { transactionId: env } as any; },
    async renewalInfo(s) { calls.push([env, "renewalInfo"]); return { autoRenewStatus: 1 } as any; },
  });
  return { calls, build };
}

test("THE REVIEW CASE: a production server verifies a sandbox payload with the sandbox verifier", async () => {
  const { calls, build } = fakeVerifiers();
  const v = selectingVerifier({ environment: "Production", verifies: ["Sandbox", "Production"] }, build);
  const tx = await v.transaction(jwsOf({ environment: "Sandbox", transactionId: "s1" }));
  assert.equal(tx.transactionId, "Sandbox");
  await v.renewalInfo(jwsOf({ environment: "Sandbox" }));
  await v.notification(jwsOf({ data: { environment: "Sandbox" } }));
  // A customer's purchase, same server, same process.
  await v.transaction(jwsOf({ environment: "Production", transactionId: "p1" }));
  assert.deepEqual(calls, [
    ["Sandbox", "transaction"],
    ["Sandbox", "renewalInfo"],
    ["Sandbox", "notification"],
    ["Production", "transaction"],
  ]);
});

test("a payload with no readable environment is verified as the server's own", async () => {
  const { calls, build } = fakeVerifiers();
  const v = selectingVerifier({ environment: "Production", verifies: ["Sandbox", "Production"] }, build);
  await v.transaction(jwsOf({ transactionId: "no-env" }));
  await v.transaction("garbage.that.passes-nothing");
  assert.deepEqual(calls, [["Production", "transaction"], ["Production", "transaction"]]);
});

test("a production payload reaching a sandbox-only server is refused as such, not entitled", async () => {
  const { calls, build } = fakeVerifiers();
  const v = selectingVerifier({ environment: "Sandbox", verifies: ["Sandbox"] }, build);
  await assert.rejects(
    v.transaction(jwsOf({ environment: "Production", transactionId: "p1" })),
    (e: unknown) => e instanceof AppleEnvironmentUnconfigured && e.environment === "Production"
  );
  assert.deepEqual(calls, [], "no verifier was even built for it");
  // And the route answers it with a code that names the fix.
  assert.equal(describeVerificationFailure(new AppleEnvironmentUnconfigured("Production")), "production_unconfigured");
  // Distinct from the library's own mismatch, which is a signature disagreeing with the claim.
  assert.equal(
    describeVerificationFailure(new VerificationException(VerificationStatus.INVALID_ENVIRONMENT)),
    "wrong_environment"
  );
});

test("each environment's verifier is built once and reused", async () => {
  let builds = 0;
  const v = selectingVerifier({ environment: "Production", verifies: ["Sandbox", "Production"] }, (env) => {
    builds++;
    return fakeVerifiers().build(env);
  });
  await v.transaction(jwsOf({ environment: "Sandbox" }));
  await v.transaction(jwsOf({ environment: "Sandbox" }));
  await v.transaction(jwsOf({ environment: "Production" }));
  assert.equal(builds, 2);
});

test("the Server API host follows the TRANSACTION's environment, not the server's", () => {
  withEnv({ APPLE_STOREKIT_API_URL: undefined }, () => {
    const prod = apiConfig({ environment: "Production", verifies: ["Sandbox", "Production"] });
    assert.equal(appStoreApiBase(prod), "https://api.storekit.apple.com", "the default is the server's own");
    assert.equal(appStoreApiBase(prod, "Sandbox"), "https://api.storekit-sandbox.itunes.apple.com", "a reviewer's purchase is looked up where it exists");
    assert.equal(appStoreApiBase(prod, "Production"), "https://api.storekit.apple.com");
  });
});

test("roots are reported by subject and expiry, and a bad paste is counted, not fatal", () => {
  withEnv(
    {
      ...ALL_UNSET,
      APPLE_BUNDLE_ID: "com.example.reduction",
      APPLE_IAP_ENVIRONMENT: "Sandbox",
      APPLE_ROOT_CERTS: `${TEST_ROOT_B64}, not-a-certificate`,
    },
    () => {
      const cfg = appleIapConfig()!;
      assert.equal(cfg.rootCerts.length, 1, "the good one survives the bad one");
      const r = describeAppleIapEnv() as { rootCertificates: Array<{ subject: string; isApple: boolean }> ; rootCertificatesDroppedAsUnparseable: number };
      assert.equal(r.rootCertificates.length, 1);
      assert.match(r.rootCertificates[0].subject, /Reduction Test Root CA/);
      assert.equal(r.rootCertificates[0].isApple, false, "so a test cert left in production is visible");
      assert.equal(r.rootCertificatesDroppedAsUnparseable, 1);
    }
  );
});

// --------------------------------------------------- App Store Server API ---

function apiConfig(overrides: Partial<AppleIapConfig> = {}): AppleIapConfig {
  return {
    bundleId: "com.example.reduction",
    environment: "Sandbox",
    verifies: ["Sandbox"],
    rootCerts: [Buffer.from(TEST_ROOT_B64, "base64")],
    appAppleId: null,
    api: { keyId: "ABCDEF1234", issuerId: "57246542-96fe-1a63-e053-0824d011072a", privateKeyPem: TEST_KEY_PEM },
    onlineChecks: true,
    ...overrides,
  };
}

const decodeSeg = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());

test("the Server API token is ES256 with a 64-byte signature and Apple's claims", () => {
  const cfg = apiConfig();
  const token = appStoreApiJwt(cfg, NOW);
  const [h, p, sig] = token.split(".");
  assert.deepEqual(decodeSeg(h), { alg: "ES256", kid: "ABCDEF1234", typ: "JWT" });
  const payload = decodeSeg(p);
  assert.equal(payload.iss, cfg.api!.issuerId, "iss is the ISSUER ID, not the team id");
  assert.equal(payload.aud, "appstoreconnect-v1");
  assert.equal(payload.bid, "com.example.reduction");
  assert.equal(payload.iat, Math.floor(NOW / 1000));
  assert.ok(payload.exp - payload.iat <= 60 * 60, "Apple rejects a lifetime over an hour");

  // THE test. DER would be ~70 bytes and variable; JWS needs raw r||s.
  assert.equal(Buffer.from(sig, "base64url").length, 64);
  assert.ok(
    crypto.verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: crypto.createPublicKey(TEST_KEY), dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url")
    )
  );
});

test("the token is cached, and a rotated key id invalidates the cache", () => {
  resetAppleIapCache();
  const cfg = apiConfig();
  const a = appStoreApiJwt(cfg, NOW);
  const b = appStoreApiJwt(cfg, NOW + MIN);
  assert.equal(a, b);
  const c = appStoreApiJwt(apiConfig({ api: { ...cfg.api!, keyId: "ROTATED999" } }), NOW + MIN);
  assert.notEqual(a, c);
  assert.equal(decodeSeg(c.split(".")[0]).kid, "ROTATED999");
  resetAppleIapCache();
});

test("a damaged key paste is named as such, not as an ASN.1 error", () => {
  assert.throws(
    () => appStoreApiJwt(apiConfig({ api: { keyId: "K", issuerId: "I", privateKeyPem: "garbage" } })),
    /APPLE_IAP_PRIVATE_KEY is not a readable PEM/
  );
});

/** Apple's Server API on a loopback port: records requests, answers as told. */
async function withApiStub(
  respond: (req: { method: string; url: string }) => { status: number; json: unknown },
  fn: (seen: Array<{ method: string; url: string; auth: string | undefined }>) => Promise<void>
) {
  const seen: Array<{ method: string; url: string; auth: string | undefined }> = [];
  const server: Server = createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization });
    const out = respond({ method: req.method ?? "", url: req.url ?? "" });
    res.writeHead(out.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.json));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    await withEnv({ APPLE_STOREKIT_API_URL: base }, () => fn(seen));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("the status lookup asks for one originalTransactionId and returns its last transaction", async () => {
  await withApiStub(
    () => ({
      status: 200,
      json: {
        environment: "Sandbox",
        bundleId: "com.example.reduction",
        data: [
          {
            subscriptionGroupIdentifier: "grp",
            lastTransactions: [
              { originalTransactionId: "other", status: 2, signedTransactionInfo: "x.y.z" },
              { originalTransactionId: "orig-1", status: 4, signedTransactionInfo: "a.b.c", signedRenewalInfo: "d.e.f" },
            ],
          },
        ],
      },
    }),
    async (seen) => {
      const snap = await fetchAppleSubscriptionStatus(apiConfig(), "orig-1");
      assert.deepEqual(snap, { status: 4, signedTransactionInfo: "a.b.c", signedRenewalInfo: "d.e.f" });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, "GET");
      assert.equal(seen[0].url, "/inApps/v1/subscriptions/orig-1");
      assert.match(seen[0].auth ?? "", /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  );
});

test("a failing or unknowing API is null, never a throw — the transaction itself is the fallback", async () => {
  await withApiStub(
    () => ({ status: 404, json: { errorCode: 4040010, errorMessage: "Original transaction id not found." } }),
    async () => {
      assert.equal(await fetchAppleSubscriptionStatus(apiConfig(), "nope"), null);
    }
  );
  await withApiStub(
    () => ({ status: 200, json: { data: [{ lastTransactions: [{ originalTransactionId: "other", status: 1 }] }] } }),
    async () => {
      assert.equal(await fetchAppleSubscriptionStatus(apiConfig(), "orig-1"), null, "not in the response");
    }
  );
  // Unconfigured credentials: skipped entirely, no request made.
  await withApiStub(
    () => ({ status: 200, json: {} }),
    async (seen) => {
      assert.equal(await fetchAppleSubscriptionStatus(apiConfig({ api: null }), "orig-1"), null);
      assert.equal(seen.length, 0);
    }
  );
  // Nothing listening.
  await withEnv({ APPLE_STOREKIT_API_URL: "http://127.0.0.1:9" }, async () => {
    assert.equal(await fetchAppleSubscriptionStatus(apiConfig(), "orig-1"), null);
  });
});

test("the test-notification request is a POST and reports Apple's answer either way", async () => {
  await withApiStub(
    (r) => (r.method === "POST" ? { status: 200, json: { testNotificationToken: "tok_123" } } : { status: 405, json: {} }),
    async (seen) => {
      const out = await requestAppleTestNotification(apiConfig());
      assert.deepEqual(out, { ok: true, token: "tok_123" });
      assert.equal(seen[0].url, "/inApps/v1/notifications/test");
    }
  );
  await withApiStub(
    () => ({ status: 401, json: { errorMessage: "Unauthenticated" } }),
    async () => {
      const out = await requestAppleTestNotification(apiConfig());
      assert.deepEqual(out, { ok: false, status: 401, detail: "Unauthenticated" });
    }
  );
  assert.equal((await requestAppleTestNotification(apiConfig({ api: null }))).ok, false);
});
