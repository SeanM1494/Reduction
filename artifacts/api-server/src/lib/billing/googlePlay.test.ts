/**
 * server/lib/billing/googlePlay.test.ts — the Play adapter, without a
 * database, without Google.
 *
 * What this proves: the state translation (the provider-agnostic bet, for
 * the third provider), when the server acknowledges, the notification
 * envelope, the configuration posture, the service-account assertion
 * (that it verifies with the account's public key and says what Google's
 * token endpoint requires), and the token exchange and lookup against a
 * loopback stub. What it cannot prove: that Google answers the way its
 * documentation says. See the header of googlePlay.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  decodePlayNotification,
  describeGooglePlayEnv,
  fetchPlaySubscription,
  googleAccessToken,
  googlePlayConfig,
  needsAcknowledge,
  parseServiceAccount,
  productIdOfStored,
  resetGooglePlayCache,
  rtdnTokenMatches,
  serviceAccountAssertion,
  subscriptionFromGoogle,
  type PlaySubscription,
} from "./googlePlay";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SA = {
  type: "service_account",
  client_email: "play-verifier@example.iam.gserviceaccount.com",
  private_key: KEY_PEM,
  private_key_id: "kid-1",
  token_uri: "https://oauth2.googleapis.com/token",
};

const ENV_KEYS = ["GOOGLE_PLAY_PACKAGE_NAME", "GOOGLE_PLAY_SERVICE_ACCOUNT", "GOOGLE_PLAY_RTDN_TOKEN", "GOOGLE_OAUTH_TOKEN_URL", "GOOGLE_PLAY_API_URL", "PUBLIC_BASE_URL"];

async function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  resetGooglePlayCache();
  try {
    await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetGooglePlayCache();
  }
}

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY = 86_400_000;
const item = (expiresIn: number, extra: Record<string, unknown> = {}) => ({
  productId: "com.recipereduction.mobile.plan.monthly",
  expiryTime: new Date(NOW + expiresIn).toISOString(),
  ...extra,
});

// ------------------------------------------------------- translation ---

test("states map to active, grace and expired, and grace is Google's", () => {
  const facts = (sub: PlaySubscription) => {
    const r = subscriptionFromGoogle(sub, "tok", NOW);
    assert.equal(r.kind, "facts");
    return r.kind === "facts" ? r.facts : null!;
  };
  assert.equal(facts({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [item(30 * DAY)] }).status, "active");
  assert.equal(facts({ subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", lineItems: [item(-DAY)] }).status, "grace");
  for (const s of ["SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"]) {
    assert.equal(facts({ subscriptionState: s, lineItems: [item(30 * DAY)] }).status, "expired", s);
  }
});

test("cancelled keeps the paid-for time, and says it will not renew", () => {
  const live = subscriptionFromGoogle({ subscriptionState: "SUBSCRIPTION_STATE_CANCELED", lineItems: [item(5 * DAY)] }, "tok", NOW);
  assert.deepEqual(live.kind === "facts" && [live.facts.status, live.facts.willNotRenew], ["active", true]);
  const over = subscriptionFromGoogle({ subscriptionState: "SUBSCRIPTION_STATE_CANCELED", lineItems: [item(-DAY)] }, "tok", NOW);
  assert.equal(over.kind === "facts" && over.facts.status, "expired");
});

test("auto-renew off is 'will not renew'; renewsAt is the latest expiry; the token is the ref", () => {
  const r = subscriptionFromGoogle(
    {
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      lineItems: [item(3 * DAY), item(30 * DAY, { autoRenewingPlan: { autoRenewEnabled: false } })],
    },
    "tok-1",
    NOW
  );
  assert.equal(r.kind, "facts");
  if (r.kind !== "facts") return;
  assert.equal(r.facts.providerRef, "tok-1");
  assert.equal(r.facts.willNotRenew, true);
  assert.equal(r.facts.renewsAt?.getTime(), NOW + 30 * DAY);
  assert.equal(r.facts.replaces, null);
});

test("a replacement names the token it replaced, never itself", () => {
  const r = subscriptionFromGoogle({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", linkedPurchaseToken: "old", lineItems: [item(DAY)] }, "new", NOW);
  assert.equal(r.kind === "facts" && r.facts.replaces, "old");
  const self = subscriptionFromGoogle({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", linkedPurchaseToken: "same", lineItems: [item(DAY)] }, "same", NOW);
  assert.equal(self.kind === "facts" && self.facts.replaces, null);
});

test("pending is not written, and an unknown state is not guessed at", () => {
  assert.deepEqual(subscriptionFromGoogle({ subscriptionState: "SUBSCRIPTION_STATE_PENDING" }, "t", NOW), { kind: "pending" });
  assert.deepEqual(subscriptionFromGoogle({ subscriptionState: "SUBSCRIPTION_STATE_SOMETHING_NEW" }, "t", NOW), {
    kind: "unknown",
    state: "SUBSCRIPTION_STATE_SOMETHING_NEW",
  });
  assert.equal(subscriptionFromGoogle({}, "t", NOW).kind, "unknown");
});

test("the server acknowledges only an unacknowledged purchase that grants access", () => {
  const pending = "ACKNOWLEDGEMENT_STATE_PENDING";
  assert.equal(needsAcknowledge({ acknowledgementState: pending, subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" }), true);
  assert.equal(needsAcknowledge({ acknowledgementState: pending, subscriptionState: "SUBSCRIPTION_STATE_CANCELED" }), true);
  assert.equal(needsAcknowledge({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" }), false);
  assert.equal(needsAcknowledge({ acknowledgementState: pending, subscriptionState: "SUBSCRIPTION_STATE_PENDING" }), false);
  assert.equal(needsAcknowledge({ acknowledgementState: pending, subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }), false);
});

test("the stored row gives back its product id for a cancel", () => {
  assert.equal(productIdOfStored({ subscription: { lineItems: [{ productId: "p.monthly" }] } }), "p.monthly");
  assert.equal(productIdOfStored({}), null);
  assert.equal(productIdOfStored(null), null);
});

// ------------------------------------------------------ notifications ---

const envelope = (msg: unknown) => ({ message: { data: Buffer.from(JSON.stringify(msg)).toString("base64"), messageId: "1" }, subscription: "s" });

test("a notification envelope names its token, type and package", () => {
  assert.deepEqual(
    decodePlayNotification(envelope({ packageName: "com.x", subscriptionNotification: { notificationType: 2, purchaseToken: "tok" } })),
    { packageName: "com.x", purchaseToken: "tok", type: 2 }
  );
  assert.deepEqual(decodePlayNotification(envelope({ packageName: "com.x", testNotification: { version: "1.0" } })), {
    packageName: "com.x",
    purchaseToken: null,
    type: "test",
  });
  // A refund of a subscription is looked up; of a one-time product, not.
  assert.equal(decodePlayNotification(envelope({ voidedPurchaseNotification: { purchaseToken: "v", productType: 1 } }))?.purchaseToken, "v");
  assert.equal(decodePlayNotification(envelope({ voidedPurchaseNotification: { purchaseToken: "v", productType: 2 } }))?.purchaseToken, null);
  assert.equal(decodePlayNotification({ message: { data: "!!!not base64 json" } }), null);
  assert.equal(decodePlayNotification({}), null);
  assert.equal(decodePlayNotification(null), null);
});

test("the notifications token compares exactly", () => {
  assert.equal(rtdnTokenMatches("abc", "abc"), true);
  assert.equal(rtdnTokenMatches("abd", "abc"), false);
  assert.equal(rtdnTokenMatches(undefined, "abc"), false);
  assert.equal(rtdnTokenMatches(["abc"], "abc"), false);
});

// ------------------------------------------------------------- config ---

test("unconfigured until the package and a parseable service account are both set", async () => {
  await withEnv({}, () => assert.equal(googlePlayConfig(), null));
  await withEnv({ GOOGLE_PLAY_PACKAGE_NAME: "com.recipereduction.mobile" }, () => assert.equal(googlePlayConfig(), null));
  await withEnv({ GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(SA) }, () => assert.equal(googlePlayConfig(), null));
  await withEnv(
    { GOOGLE_PLAY_PACKAGE_NAME: "com.recipereduction.mobile", GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify({ ...SA, private_key: "garbage" }) },
    () => assert.equal(googlePlayConfig(), null)
  );
  await withEnv({ GOOGLE_PLAY_PACKAGE_NAME: "com.recipereduction.mobile", GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(SA) }, () => {
    const cfg = googlePlayConfig();
    assert.equal(cfg?.packageName, "com.recipereduction.mobile");
    assert.equal(cfg?.clientEmail, SA.client_email);
    assert.equal(cfg?.rtdnToken, null);
  });
});

test("the service account may be pasted as JSON, base64, or with its newlines flattened", async () => {
  assert.equal(parseServiceAccount(JSON.stringify(SA))?.client_email, SA.client_email);
  assert.equal(parseServiceAccount(Buffer.from(JSON.stringify(SA)).toString("base64"))?.client_email, SA.client_email);
  assert.equal(parseServiceAccount("not json"), null);
  assert.equal(parseServiceAccount(""), null);
  const flattened = { ...SA, private_key: KEY_PEM.replace(/\n/g, "\\n") };
  await withEnv({ GOOGLE_PLAY_PACKAGE_NAME: "p", GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(flattened) }, () => {
    assert.ok(googlePlayConfig(), "a key with literal \\n is repaired");
  });
});

test("the preflight report says what is missing and discloses no secret", async () => {
  await withEnv({ PUBLIC_BASE_URL: "https://example.com/", GOOGLE_PLAY_RTDN_TOKEN: "s3cret-token" }, () => {
    const r = describeGooglePlayEnv();
    assert.equal(r.configured, false);
    assert.deepEqual(r.missing, ["GOOGLE_PLAY_PACKAGE_NAME", "GOOGLE_PLAY_SERVICE_ACCOUNT"]);
    assert.equal(r.notifications.tokenSet, true);
    assert.equal(r.notifications.pushEndpoint, "https://example.com/api/billing/google/notifications?token=<GOOGLE_PLAY_RTDN_TOKEN>");
  });
  await withEnv({ GOOGLE_PLAY_PACKAGE_NAME: "p", GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(SA), GOOGLE_PLAY_RTDN_TOKEN: "s3cret-token" }, () => {
    const text = JSON.stringify(describeGooglePlayEnv());
    assert.ok(!text.includes("s3cret-token"));
    assert.ok(!text.includes(KEY_PEM.split("\n")[1].slice(0, 16)));
    assert.ok(text.includes(SA.client_email));
  });
});

// ------------------------------------------------ the token exchange ---

test("the assertion is RS256, verifies with the account's key, and asks for the publisher scope", async () => {
  await withEnv({ GOOGLE_PLAY_PACKAGE_NAME: "p", GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(SA) }, () => {
    const cfg = googlePlayConfig()!;
    const jwt = serviceAccountAssertion(cfg, "https://oauth2.googleapis.com/token", NOW);
    const [h, c, s] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT", kid: "kid-1" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    assert.equal(claims.iss, SA.client_email);
    assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
    assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
    assert.equal(claims.exp - claims.iat, 3600);
    assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url")));
  });
});

async function stub(handler: (req: { method: string; url: string; body: string }) => { status: number; body: unknown }) {
  const seen: Array<{ method: string; url: string; body: string; auth?: string }> = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body, auth: req.headers.authorization });
      const out = handler({ method: req.method ?? "", url: req.url ?? "", body });
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return { base, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("the access token is fetched once and reused; the lookup carries it", async () => {
  const s = await stub((req) => {
    if (req.url === "/token") return { status: 200, body: { access_token: "at-1", expires_in: 3600 } };
    if (req.url.includes("/subscriptionsv2/tokens/good")) return { status: 200, body: { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" } };
    if (req.url.includes("/subscriptionsv2/tokens/gone")) return { status: 410, body: {} };
    if (req.url.includes("/subscriptionsv2/tokens/never")) return { status: 400, body: {} };
    return { status: 503, body: {} };
  });
  try {
    await withEnv(
      {
        GOOGLE_PLAY_PACKAGE_NAME: "com.recipereduction.mobile",
        GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(SA),
        GOOGLE_OAUTH_TOKEN_URL: `${s.base}/token`,
        GOOGLE_PLAY_API_URL: s.base,
      },
      async () => {
        const cfg = googlePlayConfig()!;
        const good = await fetchPlaySubscription(cfg, "good");
        assert.deepEqual(good, { ok: true, sub: { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" } });
        assert.equal((await fetchPlaySubscription(cfg, "gone")).ok, false);
        const gone = await fetchPlaySubscription(cfg, "gone");
        assert.equal(!gone.ok && gone.kind, "not_found");
        const never = await fetchPlaySubscription(cfg, "never");
        assert.equal(!never.ok && never.kind, "not_found");
        const down = await fetchPlaySubscription(cfg, "other");
        assert.equal(!down.ok && down.kind, "unavailable");

        const tokenCalls = s.seen.filter((r) => r.url === "/token");
        assert.equal(tokenCalls.length, 1, "one exchange for five lookups");
        const form = new URLSearchParams(tokenCalls[0].body);
        assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
        const lookup = s.seen.find((r) => r.url.includes("/tokens/good"))!;
        assert.equal(lookup.url, "/androidpublisher/v3/applications/com.recipereduction.mobile/purchases/subscriptionsv2/tokens/good");
        assert.equal(lookup.auth, "Bearer at-1");
      }
    );
  } finally {
    await s.close();
  }
});

test("a refused service account is 'unavailable', never 'not found'", async () => {
  const s = await stub(() => ({ status: 401, body: { error: "invalid_grant" } }));
  try {
    await withEnv(
      { GOOGLE_PLAY_PACKAGE_NAME: "p", GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(SA), GOOGLE_OAUTH_TOKEN_URL: `${s.base}/token`, GOOGLE_PLAY_API_URL: s.base },
      async () => {
        const cfg = googlePlayConfig()!;
        await assert.rejects(googleAccessToken(cfg), /invalid_grant/);
        const r = await fetchPlaySubscription(cfg, "anything");
        assert.equal(!r.ok && r.kind, "unavailable");
      }
    );
  } finally {
    await s.close();
  }
});
