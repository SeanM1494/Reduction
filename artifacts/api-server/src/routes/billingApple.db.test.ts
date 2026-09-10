/**
 * server/routes/billingApple.db.test.ts — the App Store routes, against a
 * real Postgres, with Apple's signatures stubbed out.
 *
 * THE STUB IS THE BOUNDARY. `setAppleVerifierForTests` replaces the library's
 * chain-walking verifier with a map from JWS-shaped strings to decoded
 * payloads, so what is under test is everything on this side of the
 * signature: the gates, the account-binding rules, the row written, the
 * entitlement that results, and Apple's retry contract (which responses are
 * 200). The signature check itself is the library's job and needs a real
 * Apple-signed payload, which cannot exist in a test.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { VerificationException, VerificationStatus } from "@apple/app-store-server-library";
import { getDb } from "../db";
import { accountAccess, subscriptions, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { resetAppleIapCache, setAppleVerifierForTests, type AppleVerifier } from "../lib/billing/apple";
import { appleBillingRouter } from "./billingApple";

const TABLES = ["users", "subscriptions", "account_access"];

const TEST_ROOT_B64 =
  "MIIBlzCCAT2gAwIBAgIUFpj+s/LuyTN38ZgRilBfQrvmHFAwCgYIKoZIzj0EAwIwITEfMB0GA1UEAwwWUmVkdWN0aW9uIFRlc3QgUm9vdCBDQTAeFw0yNjA5MTAwMTUxMzRaFw0zNjA5MDcwMTUxMzRaMCExHzAdBgNVBAMMFlJlZHVjdGlvbiBUZXN0IFJvb3QgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARevbKg4MGFxYXHyCOFM+92LyGYKOimi9ATQdTsBlqB2DryOf1+8mSp+HGJSnwb7KqPzRN8DPwOGQlfIRMcPVwfo1MwUTAdBgNVHQ4EFgQUFSPfLVtuy4YNAE3P5xlWq2Dis9YwHwYDVR0jBBgwFoAUFSPfLVtuy4YNAE3P5xlWq2Dis9YwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEAnpfexLrfCn+CtydX+U+cod4t3qnNL40eP/EVwZ50/hwCIBWZvE80LgbuQjHKN8S6aYwyDW8pxjCu9DuCcISe3WuZ";

const ENV_KEYS = [
  "APPLE_BUNDLE_ID", "APPLE_IAP_ENVIRONMENT", "APPLE_APP_APPLE_ID", "APPLE_ROOT_CERTS",
  "APPLE_ROOT_CA_DIR", "APPLE_IAP_KEY_ID", "APPLE_IAP_ISSUER_ID", "APPLE_IAP_PRIVATE_KEY",
  "APPLE_STOREKIT_API_URL",
];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

function configure(on: boolean) {
  for (const k of ENV_KEYS) delete process.env[k];
  if (on) {
    process.env.APPLE_BUNDLE_ID = "com.example.reduction";
    process.env.APPLE_IAP_ENVIRONMENT = "Sandbox";
    process.env.APPLE_ROOT_CERTS = TEST_ROOT_B64;
  }
  resetAppleIapCache();
}

/**
 * JWS-shaped handles. Each decoded payload is registered under a string that
 * passes the routes' shape check; anything not registered "fails to verify"
 * with the library's own exception type, the way a forged payload would.
 */
const payloads = new Map<string, unknown>();
let nextId = 0;
function signed(payload: unknown): string {
  const handle = `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(`p${nextId++}`).toString("base64url")}.c2ln`;
  payloads.set(handle, payload);
  return handle;
}
const FORGED = "eyJhbGciOiJFUzI1NiJ9.Zm9yZ2Vk.c2ln";
const WRONG_ENV = "eyJhbGciOiJFUzI1NiJ9.d3JvbmdlbnY.c2ln";

const stubVerifier: AppleVerifier = {
  async notification(s) {
    if (s === WRONG_ENV) throw new VerificationException(VerificationStatus.INVALID_ENVIRONMENT);
    if (!payloads.has(s)) throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
    return payloads.get(s) as any;
  },
  async transaction(s) {
    if (!payloads.has(s)) throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
    return payloads.get(s) as any;
  },
  async renewalInfo(s) {
    if (!payloads.has(s)) throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
    return payloads.get(s) as any;
  },
};

let server: Server | null = null;
let base = "";
async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    req.session = u ? { userId: u } : null;
    next();
  });
  app.use("/api/billing/apple", appleBillingRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const minted = new Set<string>();
async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Apple Test" });
  minted.add(id);
  return id;
}

after(async () => {
  if (minted.size) {
    const db = getDb();
    for (const id of minted) {
      await db.delete(subscriptions).where(eq(subscriptions.userId, id));
      await db.delete(accountAccess).where(eq(accountAccess.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  setAppleVerifierForTests(null);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  resetAppleIapCache();
  server?.close();
});

async function post(path: string, body: unknown, userId: string | null = null) {
  const res = await fetch(`${await listen()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userId ? { "x-test-user": userId } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function rowFor(userId: string) {
  const rows = await getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return rows;
}

const DAY = 24 * 60 * 60 * 1000;
const tx = (userId: string | null, ref: string, extra: Record<string, unknown> = {}) => ({
  originalTransactionId: ref,
  transactionId: `${ref}-latest`,
  bundleId: "com.example.reduction",
  productId: "monthly",
  expiresDate: Date.now() + 30 * DAY,
  environment: "Sandbox",
  ...(userId ? { appAccountToken: userId } : {}),
  ...extra,
});

// ------------------------------------------------------------------ gates ---

test("both routes are absent or refusing until the adapter is configured", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(false);
  setAppleVerifierForTests(null);
  const userId = await makeUser();
  // The app gets a 503 it can show; Apple gets a 404, because an
  // unconfigured verifier cannot tell Apple from anyone.
  assert.equal((await post("/api/billing/apple/verify", { signedTransactionInfo: signed({}) }, userId)).status, 503);
  assert.equal((await post("/api/billing/apple/notifications", { signedPayload: signed({}) })).status, 404);
});

test("verify: signed in only, and the body must be a JWS", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const userId = await makeUser();
  assert.equal((await post("/api/billing/apple/verify", { signedTransactionInfo: signed({}) })).status, 401);
  assert.equal((await post("/api/billing/apple/verify", {}, userId)).status, 422);
  assert.equal((await post("/api/billing/apple/verify", { signedTransactionInfo: "not a jws" }, userId)).status, 422);
  assert.equal(
    (await post("/api/billing/apple/verify", { signedTransactionInfo: signed({}), signedRenewalInfo: 42 }, userId)).status,
    422
  );
});

// ------------------------------------------------------------------ verify ---

test("verify: a good purchase writes an 'apple' row and the entitlement flips to subscribed", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const userId = await makeUser();
  const ref = `orig-${crypto.randomUUID()}`;

  const r = await post(
    "/api/billing/apple/verify",
    { signedTransactionInfo: signed(tx(userId, ref)), signedRenewalInfo: signed({ autoRenewStatus: 1 }) },
    userId
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.entitlement.subscribed, true);
  assert.equal(r.body.entitlement.provider, "apple");
  assert.equal(r.body.entitlement.status, "active");

  const rows = await rowFor(userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "apple");
  assert.equal(rows[0].provider_ref, ref, "keyed on the ORIGINAL transaction id");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].willNotRenew, false);
  assert.ok(rows[0].renewsAt && rows[0].renewsAt.getTime() > Date.now());
  // raw holds the decoded objects, never the JWS strings.
  assert.equal((rows[0].raw as any).transaction.originalTransactionId, ref);

  // A restore resubmits the same transaction: same row, not a second one.
  const again = await post("/api/billing/apple/verify", { signedTransactionInfo: signed(tx(userId, ref)) }, userId);
  assert.equal(again.status, 200);
  assert.equal((await rowFor(userId)).length, 1);
});

test("verify: a forged payload is 400 with the reason, and writes nothing", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const userId = await makeUser();
  const r = await post("/api/billing/apple/verify", { signedTransactionInfo: FORGED }, userId);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "bad_signature");
  assert.equal((await rowFor(userId)).length, 0);
});

test("verify: a transaction naming another account is refused, not reassigned", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const owner = await makeUser();
  const thief = await makeUser();
  const ref = `orig-${crypto.randomUUID()}`;

  // The token names the owner; the thief submits it: 403.
  const byToken = await post("/api/billing/apple/verify", { signedTransactionInfo: signed(tx(owner, ref)) }, thief);
  assert.equal(byToken.status, 403);
  assert.equal(byToken.body.code, "wrong_account");
  assert.equal((await rowFor(thief)).length, 0);
  assert.equal((await rowFor(owner)).length, 0, "a refusal writes nothing for anyone");

  // Now the owner records it; a token-less copy submitted by the thief hits
  // the stored binding: 409.
  assert.equal((await post("/api/billing/apple/verify", { signedTransactionInfo: signed(tx(owner, ref)) }, owner)).status, 200);
  const byRow = await post("/api/billing/apple/verify", { signedTransactionInfo: signed(tx(null, ref)) }, thief);
  assert.equal(byRow.status, 409);
  assert.equal((await rowFor(thief)).length, 0);
  assert.equal((await rowFor(owner))[0].userId, owner, "still the owner's");
});

test("verify: a token naming no account falls back to the session, never a dangling row", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const userId = await makeUser();
  const ref = `orig-${crypto.randomUUID()}`;
  // A UUID that is not a user — the app stamped a stale id, say.
  const r = await post(
    "/api/billing/apple/verify",
    { signedTransactionInfo: signed(tx(null, ref, { appAccountToken: crypto.randomUUID() })) },
    userId
  );
  assert.equal(r.status, 200);
  assert.equal((await rowFor(userId))[0]?.provider_ref, ref);
});

test("verify: a non-subscription purchase is refused as such", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const userId = await makeUser();
  const r = await post(
    "/api/billing/apple/verify",
    { signedTransactionInfo: signed({ originalTransactionId: "consumable-1", transactionId: "c1", productId: "tip" }) },
    userId
  );
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "not_subscription");
});

// ----------------------------------------------------------- notifications ---

test("notifications: TEST and payload-less types are acknowledged with 200", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  // Anything but 200 makes Apple retry, so "ignored on purpose" must be 200.
  const test_ = await post("/api/billing/apple/notifications", { signedPayload: signed({ notificationType: "TEST" }) });
  assert.equal(test_.status, 200);
  const summary = await post("/api/billing/apple/notifications", {
    signedPayload: signed({ notificationType: "RENEWAL_EXTENSION", subtype: "SUMMARY", summary: {} }),
  });
  assert.equal(summary.status, 200);
});

test("notifications: forged is 400, wrong environment is 400, missing body is 400", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  assert.equal((await post("/api/billing/apple/notifications", {})).status, 400);
  const forged = await post("/api/billing/apple/notifications", { signedPayload: FORGED });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.code, "bad_signature");
  // A sandbox server receiving a production payload (or vice versa) must
  // not entitle anyone — and must not 500, or Apple retries it forever.
  const env = await post("/api/billing/apple/notifications", { signedPayload: WRONG_ENV });
  assert.equal(env.status, 400);
  assert.equal(env.body.code, "wrong_environment");
});

test("notifications: the lifecycle, as Apple would send it, lands as active → grace → expired", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const userId = await makeUser();
  const ref = `orig-${crypto.randomUUID()}`;

  const notify = (type: string, subtype: string | null, status: number, txExtra: Record<string, unknown> = {}, ri: Record<string, unknown> = {}) =>
    post("/api/billing/apple/notifications", {
      signedPayload: signed({
        notificationType: type,
        subtype,
        notificationUUID: crypto.randomUUID(),
        data: {
          environment: "Sandbox",
          bundleId: "com.example.reduction",
          status,
          signedTransactionInfo: signed(tx(userId, ref, txExtra)),
          signedRenewalInfo: signed({ originalTransactionId: ref, autoRenewStatus: 1, ...ri }),
        },
      }),
    });

  // SUBSCRIBED/INITIAL_BUY — the first anyone here hears of it. The account
  // comes from the token; no verify call preceded this.
  assert.equal((await notify("SUBSCRIBED", "INITIAL_BUY", 1)).status, 200);
  let [row] = await rowFor(userId);
  assert.equal(row.status, "active");

  // The card fails: Apple says BILLING_RETRY (3). Grace — Apple's window.
  assert.equal((await notify("DID_FAIL_TO_RENEW", null, 3, { expiresDate: Date.now() - DAY }, { isInBillingRetryPeriod: true })).status, 200);
  [row] = await rowFor(userId);
  assert.equal(row.status, "grace");

  // The user turns auto-renew off: still active for the paid period.
  assert.equal((await notify("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", 1, {}, { autoRenewStatus: 0 })).status, 200);
  [row] = await rowFor(userId);
  assert.equal(row.status, "active");
  assert.equal(row.willNotRenew, true);

  // It runs out.
  assert.equal((await notify("EXPIRED", "VOLUNTARY", 2, { expiresDate: Date.now() - DAY }, { autoRenewStatus: 0 })).status, 200);
  [row] = await rowFor(userId);
  assert.equal(row.status, "expired");

  // One row throughout: every notification converged on (apple, ref).
  assert.equal((await rowFor(userId)).length, 1);
  assert.equal((row.raw as any).notificationType, "EXPIRED");
});

test("notifications: an account this server cannot name is acknowledged, logged, and NOT written", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const ref = `orig-${crypto.randomUUID()}`;
  const r = await post("/api/billing/apple/notifications", {
    signedPayload: signed({
      notificationType: "DID_RENEW",
      data: { environment: "Sandbox", bundleId: "com.example.reduction", status: 1, signedTransactionInfo: signed(tx(null, ref)) },
    }),
  });
  // 200: Apple would otherwise redeliver forever, and nothing changes by
  // asking again. The operator links it by hand from the log line.
  assert.equal(r.status, 200);
  const rows = await getDb().select().from(subscriptions).where(eq(subscriptions.provider_ref, ref));
  assert.equal(rows.length, 0);
});

test("notifications: a stored binding is enough — a later payload needs no token", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  configure(true);
  setAppleVerifierForTests(stubVerifier);
  const userId = await makeUser();
  const ref = `orig-${crypto.randomUUID()}`;
  assert.equal((await post("/api/billing/apple/verify", { signedTransactionInfo: signed(tx(userId, ref)) }, userId)).status, 200);
  const r = await post("/api/billing/apple/notifications", {
    signedPayload: signed({
      notificationType: "DID_RENEW",
      data: { environment: "Sandbox", bundleId: "com.example.reduction", status: 1, signedTransactionInfo: signed(tx(null, ref, { expiresDate: Date.now() + 60 * DAY })) },
    }),
  });
  assert.equal(r.status, 200);
  const [row] = await rowFor(userId);
  assert.ok(row.renewsAt!.getTime() > Date.now() + 50 * DAY, "the renewal moved the date");
});
