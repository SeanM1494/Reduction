/**
 * server/routes/billingGoogle.db.test.ts — the Google Play routes and the
 * deletion-time cancel, against a real Postgres, with Google stubbed on
 * loopback.
 *
 * THE STUB IS THE BOUNDARY. A local server plays Google's token endpoint
 * and the Play Developer API (GOOGLE_OAUTH_TOKEN_URL, GOOGLE_PLAY_API_URL),
 * answering each purchase token from a map. What is under test is
 * everything on this side of Google: the gates, the account-binding rules,
 * the row written, a replaced token's row closed, the acknowledge, the
 * entitlement that results, and Pub/Sub's retry contract (which answers
 * are 200). That Google answers as documented needs a real purchase.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, subscriptions, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { resetGooglePlayCache, type PlaySubscription } from "../lib/billing/googlePlay";
import { cancelSubscriptionsFor } from "../lib/billing/cancel";
import { googleBillingRouter } from "./billingGoogle";

const TABLES = ["users", "subscriptions", "account_access"];
const PKG = "com.recipereduction.mobile";
const RTDN = "rtdn-test-token";
const DAY = 86_400_000;

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = JSON.stringify({
  client_email: "verifier@example.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

// ------------------------------------------------------- Google, stubbed ---

const play = new Map<string, PlaySubscription>();
const acknowledged: string[] = [];
const cancelled: string[] = [];
let googleDown = false;
let cancelRefused = false;

const google: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const url = req.url ?? "";
    const send = (status: number, out: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    };
    if (url === "/token") return send(200, { access_token: "at", expires_in: 3600 });
    if (googleDown) return send(503, {});
    const v2 = url.match(/\/purchases\/subscriptionsv2\/tokens\/([^/?]+)$/);
    if (v2) {
      const sub = play.get(decodeURIComponent(v2[1]));
      return sub ? send(200, sub) : send(400, { error: { message: "Invalid Value" } });
    }
    const ack = url.match(/\/purchases\/subscriptions\/[^/]+\/tokens\/([^/:]+):acknowledge$/);
    if (ack) {
      acknowledged.push(decodeURIComponent(ack[1]));
      return send(200, {});
    }
    const cancel = url.match(/\/purchases\/subscriptions\/[^/]+\/tokens\/([^/:]+):cancel$/);
    if (cancel) {
      if (cancelRefused) return send(500, {});
      cancelled.push(decodeURIComponent(cancel[1]));
      return send(200, {});
    }
    send(404, {});
  });
});
let googleBase = "";

const ENV_KEYS = ["GOOGLE_PLAY_PACKAGE_NAME", "GOOGLE_PLAY_SERVICE_ACCOUNT", "GOOGLE_PLAY_RTDN_TOKEN", "GOOGLE_OAUTH_TOKEN_URL", "GOOGLE_PLAY_API_URL"];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

async function configure(on: boolean) {
  if (!googleBase) {
    await new Promise<void>((r) => google.listen(0, "127.0.0.1", r));
    const a = google.address();
    googleBase = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  }
  for (const k of ENV_KEYS) delete process.env[k];
  if (on) {
    process.env.GOOGLE_PLAY_PACKAGE_NAME = PKG;
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = SA;
    process.env.GOOGLE_PLAY_RTDN_TOKEN = RTDN;
    process.env.GOOGLE_OAUTH_TOKEN_URL = `${googleBase}/token`;
    process.env.GOOGLE_PLAY_API_URL = googleBase;
  }
  resetGooglePlayCache();
  googleDown = false;
  cancelRefused = false;
}

// ------------------------------------------------------------- the app ---

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
  app.use("/api/billing/google", googleBillingRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const minted = new Set<string>();
async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Play Test" });
  minted.add(id);
  return id;
}

after(async () => {
  // Only when this run made rows: with no database, getDb() throws.
  if (minted.size) {
    const db = getDb();
    for (const id of minted) {
      await db.delete(subscriptions).where(eq(subscriptions.userId, id));
      await db.delete(accountAccess).where(eq(accountAccess.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  resetGooglePlayCache();
  server?.close();
  if (googleBase) google.close();
});

async function post(path: string, body: unknown, userId: string | null = null) {
  const res = await fetch(`${await listen()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userId ? { "x-test-user": userId } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const rowsFor = (userId: string) => getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId));

const newToken = () => `tok.${crypto.randomUUID()}`;
const active = (userId: string | null, extra: PlaySubscription = {}): PlaySubscription => ({
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
  lineItems: [{ productId: "com.recipereduction.mobile.plan.monthly", expiryTime: new Date(Date.now() + 30 * DAY).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }],
  ...(userId ? { externalAccountIdentifiers: { obfuscatedExternalAccountId: userId } } : {}),
  ...extra,
});
const notify = (token: string, type = 4) => ({
  message: {
    data: Buffer.from(JSON.stringify({ packageName: PKG, subscriptionNotification: { notificationType: type, purchaseToken: token } })).toString("base64"),
    messageId: "m1",
  },
  subscription: "projects/x/subscriptions/y",
});

// ------------------------------------------------------------------ gates ---

test("both routes are absent or refusing until the adapter is configured", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(false);
  const userId = await makeUser();
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: newToken() }, userId)).status, 503);
  assert.equal((await post(`/api/billing/google/notifications?token=${RTDN}`, notify(newToken()))).status, 404);
});

test("verify: signed in only, and the token must look like one", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const userId = await makeUser();
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: newToken() })).status, 401);
  assert.equal((await post("/api/billing/google/verify", {}, userId)).status, 422);
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: "short" }, userId)).status, 422);
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: "has spaces in it ok" }, userId)).status, 422);
});

// ------------------------------------------------------------------ verify ---

test("verify: a good purchase writes a 'google_play' row, acknowledges, and the account is subscribed", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const userId = await makeUser();
  const token = newToken();
  play.set(token, active(userId));

  const r = await post("/api/billing/google/verify", { purchaseToken: token }, userId);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.entitlement.subscribed, true);
  assert.equal(r.body.entitlement.provider, "google_play");
  const [row] = await rowsFor(userId);
  assert.equal(row.provider_ref, token);
  assert.equal(row.status, "active");
  assert.equal(row.willNotRenew, false);
  assert.ok(acknowledged.includes(token), "the server acknowledged it");

  // A repeat converges on the same row, and an acknowledged purchase is
  // not acknowledged again.
  play.set(token, { ...active(userId), acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" });
  const before = acknowledged.length;
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: token }, userId)).status, 200);
  assert.equal((await rowsFor(userId)).length, 1);
  assert.equal(acknowledged.length, before);
});

test("verify: a purchase naming another account is refused, and so is one already held by another", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const owner = await makeUser();
  const thief = await makeUser();
  const token = newToken();
  play.set(token, active(owner));
  const named = await post("/api/billing/google/verify", { purchaseToken: token }, thief);
  assert.equal(named.status, 403);
  assert.equal(named.body.code, "wrong_account");

  // Held for the owner, then submitted by someone else with no account id
  // on the purchase: still the owner's.
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: token }, owner)).status, 200);
  play.set(token, active(null));
  const stored = await post("/api/billing/google/verify", { purchaseToken: token }, thief);
  assert.equal(stored.status, 409);
  assert.equal((await rowsFor(thief)).length, 0);
  assert.equal((await rowsFor(owner))[0].userId, owner);
});

test("verify: a token Google does not know is 400, Google down is 502, and nothing is written", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const userId = await makeUser();
  const unknown = await post("/api/billing/google/verify", { purchaseToken: newToken() }, userId);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "not_found");
  googleDown = true;
  const token = newToken();
  play.set(token, active(userId));
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: token }, userId)).status, 502);
  assert.equal((await rowsFor(userId)).length, 0);
});

test("verify: a payment that has not cleared writes nothing and is not acknowledged", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const userId = await makeUser();
  const token = newToken();
  play.set(token, active(userId, { subscriptionState: "SUBSCRIPTION_STATE_PENDING" }));
  const r = await post("/api/billing/google/verify", { purchaseToken: token }, userId);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "pending");
  assert.equal((await rowsFor(userId)).length, 0);
  assert.ok(!acknowledged.includes(token));
});

test("verify: a plan change closes the replaced token's row, and only the same account's", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const userId = await makeUser();
  const monthly = newToken();
  const yearly = newToken();
  play.set(monthly, active(userId));
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: monthly }, userId)).status, 200);
  play.set(yearly, active(userId, { linkedPurchaseToken: monthly }));
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: yearly }, userId)).status, 200);
  const rows = await rowsFor(userId);
  const byRef = Object.fromEntries(rows.map((r) => [r.provider_ref, r.status]));
  assert.deepEqual(byRef, { [monthly]: "expired", [yearly]: "active" });
  const ent = await post("/api/billing/google/verify", { purchaseToken: yearly }, userId);
  assert.equal(ent.body.entitlement.status, "active");
});

// ----------------------------------------------------------- notifications ---

test("notifications: the URL's token is required, and a wrong one is indistinguishable from no route", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  assert.equal((await post("/api/billing/google/notifications", notify(newToken()))).status, 404);
  assert.equal((await post("/api/billing/google/notifications?token=wrong", notify(newToken()))).status, 404);
  // Configured but no token set: the route does not exist at all.
  delete process.env.GOOGLE_PLAY_RTDN_TOKEN;
  resetGooglePlayCache();
  assert.equal((await post(`/api/billing/google/notifications?token=${RTDN}`, notify(newToken()))).status, 404);
});

test("notifications: a renewal, a cancel and an expiry each rewrite the row from Google's answer", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const userId = await makeUser();
  const token = newToken();
  play.set(token, active(userId));
  assert.equal((await post(`/api/billing/google/notifications?token=${RTDN}`, notify(token, 4))).status, 200);
  assert.equal((await rowsFor(userId))[0].status, "active");

  play.set(token, active(userId, { subscriptionState: "SUBSCRIPTION_STATE_CANCELED" }));
  assert.equal((await post(`/api/billing/google/notifications?token=${RTDN}`, notify(token, 3))).status, 200);
  let [row] = await rowsFor(userId);
  assert.deepEqual([row.status, row.willNotRenew], ["active", true]);

  play.set(token, active(userId, { subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }));
  assert.equal((await post(`/api/billing/google/notifications?token=${RTDN}`, notify(token, 13))).status, 200);
  [row] = await rowsFor(userId);
  assert.equal(row.status, "expired");
});

test("notifications: what can never succeed is acknowledged (200); only Google being down asks for a retry", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const url = `/api/billing/google/notifications?token=${RTDN}`;
  assert.equal((await post(url, { message: { data: "garbage" } })).status, 200);
  assert.equal((await post(url, { message: { data: Buffer.from(JSON.stringify({ packageName: PKG, testNotification: { version: "1.0" } })).toString("base64") } })).status, 200);
  // Another package's message is not this app's.
  const other = newToken();
  play.set(other, active(null));
  assert.equal(
    (await post(url, { message: { data: Buffer.from(JSON.stringify({ packageName: "com.someone.else", subscriptionNotification: { notificationType: 4, purchaseToken: other } })).toString("base64") } })).status,
    200
  );
  // A token naming no account yet: acknowledged, nothing written.
  const orphan = newToken();
  play.set(orphan, active(null));
  assert.equal((await post(url, notify(orphan))).status, 200);
  const orphanRows = await getDb()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, "google_play"), eq(subscriptions.provider_ref, orphan)));
  assert.equal(orphanRows.length, 0);
  googleDown = true;
  assert.equal((await post(url, notify(newToken()))).status, 500);
});

// ------------------------------------------------------- account deletion ---

test("deletion cancels a Play subscription at Google, and leaves it to the person when Google refuses", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await configure(true);
  const userId = await makeUser();
  const token = newToken();
  play.set(token, active(userId));
  assert.equal((await post("/api/billing/google/verify", { purchaseToken: token }, userId)).status, 200);

  cancelRefused = true;
  assert.deepEqual(await cancelSubscriptionsFor(userId), { cancelled: [], manual: ["google_play"] });
  assert.ok(!cancelled.includes(token));

  cancelRefused = false;
  assert.deepEqual(await cancelSubscriptionsFor(userId), { cancelled: ["google_play"], manual: [] });
  assert.ok(cancelled.includes(token));
  assert.equal((await rowsFor(userId))[0].willNotRenew, true);
});
