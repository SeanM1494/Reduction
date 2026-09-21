/**
 * server/routes/account.db.test.ts — account deletion, against a real
 * Postgres, with the one provider a server can cancel stubbed at its seam.
 *
 * What is under test: the order (billing stopped BEFORE anything is
 * deleted, and nothing deleted when it cannot be), what goes (every row the
 * account owns, cascading or not), what stays (the admin audit trail), and
 * what the client is told about the subscription it cannot cancel for the
 * person. Stripe's own API is behind `setStripeCancelForTests`; the Apple
 * case needs no stub because there is nothing to call.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  accessEvents,
  accountAccess,
  adminEvents,
  identities,
  pushSubscriptions,
  recipes,
  sessions,
  subscriptions,
  trials,
  users,
} from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { setStripeCancelForTests } from "../lib/billing/stripe";
import { accountRouter } from "./account";

const TABLES = [
  "users", "recipes", "sessions", "identities", "subscriptions", "account_access",
  "access_events", "trials", "push_subscriptions", "admin_events",
];

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
  app.use("/api/account", accountRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const minted = new Set<string>();
const mintedTrials = new Set<string>();
const mintedAdmin = new Set<number>();

/** A whole account: the user, a session, an identity, a recipe, an
 *  allowance row, an access event, a push token and a claimed trial. */
async function makeAccount(opts: { sub?: { provider: string; status: string; ref?: string } } = {}) {
  const db = getDb();
  const id = crypto.randomUUID();
  minted.add(id);
  await db.insert(users).values({ id, displayName: "Deleter", email: `${id}@example.test` });
  await db.insert(identities).values({ provider: "google", subject: `g-${id}`, userId: id, email: `${id}@example.test` });
  await db.insert(sessions).values({ idHash: crypto.createHash("sha256").update(id).digest("hex"), userId: id, expiresAt: new Date(Date.now() + 3_600_000) });
  await db.insert(recipes).values({ ownerKey: `user:${id}`, userId: id, id: `r-${id}`, recipe: { title: "Toast", sections: [] } as any });
  await db.insert(accountAccess).values({ userId: id, recipeAllowance: 1, recipesUsed: 1 } as any);
  await db.insert(accessEvents).values({ userId: id, action: "save", decision: "allow", reason: "within_allowance", enforced: false });
  await db.insert(pushSubscriptions).values({ userId: id, endpoint: `ExponentPushToken[${id}]`, p256dh: "", auth: "" });
  const trialId = crypto.randomUUID();
  mintedTrials.add(trialId);
  await db.insert(trials).values({ id: trialId, claimedByUserId: id, claimedAt: new Date() });
  if (opts.sub) {
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: id,
      provider: opts.sub.provider,
      provider_ref: opts.sub.ref ?? `ref-${id}`,
      status: opts.sub.status,
      renewsAt: new Date(Date.now() + 30 * 86_400_000),
      willNotRenew: false,
    });
  }
  return { id, trialId };
}

after(async () => {
  // Nothing minted means no database was reachable: touching getDb() here
  // would turn the skip path into a failure (CLAUDE.md, "the skip path has
  // to actually skip").
  if (!minted.size && !mintedTrials.size && !mintedAdmin.size) return;
  const db = getDb();
  for (const id of minted) {
    await db.delete(recipes).where(eq(recipes.userId, id));
    await db.delete(accessEvents).where(eq(accessEvents.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  for (const t of mintedTrials) await db.delete(trials).where(eq(trials.id, t));
  for (const a of mintedAdmin) await db.delete(adminEvents).where(eq(adminEvents.id, a));
  setStripeCancelForTests(null);
  server?.close();
});

async function del(userId: string | null) {
  const res = await fetch(`${await listen()}/api/account`, {
    method: "DELETE",
    headers: userId ? { "x-test-user": userId } : {},
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any, cookie: res.headers.get("set-cookie") };
}

/** Everything that should be gone after a deletion, counted. */
async function footprint(id: string) {
  const db = getDb();
  const count = async (q: Promise<unknown[]>) => (await q).length;
  return {
    users: await count(db.select().from(users).where(eq(users.id, id))),
    recipes: await count(db.select().from(recipes).where(eq(recipes.userId, id))),
    sessions: await count(db.select().from(sessions).where(eq(sessions.userId, id))),
    identities: await count(db.select().from(identities).where(eq(identities.userId, id))),
    access: await count(db.select().from(accountAccess).where(eq(accountAccess.userId, id))),
    events: await count(db.select().from(accessEvents).where(eq(accessEvents.userId, id))),
    push: await count(db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, id))),
    subs: await count(db.select().from(subscriptions).where(eq(subscriptions.userId, id))),
  };
}
const GONE = { users: 0, recipes: 0, sessions: 0, identities: 0, access: 0, events: 0, push: 0, subs: 0 };

test("account: signed out is 401 and nothing happens", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  assert.equal((await del(null)).status, 401);
});

test("account: a free account is deleted whole — every row it owns, the trial unclaimed, the cookie cleared", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  setStripeCancelForTests(async () => assert.fail("no subscription, nothing to cancel"));
  const { id, trialId } = await makeAccount();
  assert.notDeepEqual(await footprint(id), GONE, "the fixture has a footprint to begin with");
  const r = await del(id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, cancelled: [], manual: [] });
  assert.match(r.cookie ?? "", /rd_session=;|rd_session=.*Max-Age=0|Expires=/i, "the browser's cookie is cleared");
  assert.deepEqual(await footprint(id), GONE);
  const [trial] = await getDb().select().from(trials).where(eq(trials.id, trialId));
  assert.equal(trial.claimedByUserId, null, "the trial no longer names a user that does not exist");
});

test("account: a Stripe subscription is cancelled at the provider FIRST, then the account goes", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const calls: string[] = [];
  setStripeCancelForTests(async (ref) => {
    calls.push(ref);
    // The order is observable: the account still exists while Stripe is asked.
    assert.equal((await footprint(id)).users, 1, "nothing deleted before billing is stopped");
  });
  const { id } = await makeAccount({ sub: { provider: "stripe", status: "active", ref: "sub_live" } });
  const r = await del(id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, cancelled: ["stripe"], manual: [] });
  assert.deepEqual(calls, ["sub_live"]);
  assert.deepEqual(await footprint(id), GONE);
});

test("account: when Stripe refuses, NOTHING is deleted and the client is told", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  setStripeCancelForTests(async () => {
    throw new Error("stripe: 503");
  });
  const { id } = await makeAccount({ sub: { provider: "stripe", status: "grace" } });
  const before = await footprint(id);
  const r = await del(id);
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "cancel_failed");
  assert.deepEqual(await footprint(id), before, "the account is intact, subscription row included");
  assert.equal(before.subs, 1);
});

test("account: an App Store subscription cannot be cancelled by a server — deleted, and reported as manual", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  setStripeCancelForTests(async () => assert.fail("Stripe must not be asked about an Apple subscription"));
  const { id } = await makeAccount({ sub: { provider: "apple", status: "active", ref: "1000000123" } });
  const r = await del(id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, cancelled: [], manual: ["apple"] });
  assert.deepEqual(await footprint(id), GONE);
});

test("account: an expired subscription is history, not cancelled again", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  setStripeCancelForTests(async () => assert.fail("an expired subscription is not cancelled"));
  const { id } = await makeAccount({ sub: { provider: "stripe", status: "expired" } });
  const r = await del(id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, cancelled: [], manual: [] });
  assert.deepEqual(await footprint(id), GONE);
});

test("account: the admin audit trail outlives the account it names", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  setStripeCancelForTests(null);
  const { id } = await makeAccount();
  const [{ auditId }] = await getDb()
    .insert(adminEvents)
    .values({ targetUserId: id, action: "enforce_override", before: "null", after: "false", actorIp: "127.0.0.1" })
    .returning({ auditId: adminEvents.id });
  mintedAdmin.add(auditId);
  assert.equal((await del(id)).status, 200);
  const rows = await getDb().select().from(adminEvents).where(eq(adminEvents.id, auditId));
  assert.equal(rows.length, 1, "who was comped is still on record after the account is gone");
});
