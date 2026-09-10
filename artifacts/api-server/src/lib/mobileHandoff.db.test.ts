/**
 * lib/mobileHandoff.db.test.ts — the mobile sign-in handoff, against Postgres.
 *
 * The property under test is the one the in-memory version could not have:
 * a code minted by one process is redeemable by another. Two processes are
 * stood in for by reading the row straight out of the table — if it is
 * there, any instance can find it. The rest is the single-use contract
 * (DELETE ... RETURNING), expiry, provider scoping (an OAuth `state` is not a
 * handoff), and the exchange route end to end: no session exists until the
 * code is redeemed, and the token it returns resolves to the right account.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { authStates, sessions, users } from "@workspace/db";
import { needsDatabase } from "./testdb";
import {
  consumeMobileHandoff,
  createAuthState,
  createMobileHandoff,
  MOBILE_HANDOFF_TTL_MS,
  resolveSession,
} from "./sessions";
import { authRouter } from "../routes/auth";

const TABLES = ["users", "auth_states", "sessions"];

const minted = new Set<string>();
async function makeUser(): Promise<string> {
  const id = `handoff-test-${randomUUID()}`;
  await getDb().insert(users).values({ id, displayName: "Handoff Test" });
  minted.add(id);
  return id;
}

let server: Server | null = null;
let base = "";
async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

after(async () => {
  if (minted.size) {
    const db = getDb();
    for (const id of minted) {
      await db.delete(authStates).where(eq(authStates.pkceVerifier, id));
      await db.delete(sessions).where(eq(sessions.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  server?.close();
});

async function exchange(body: unknown) {
  const res = await fetch(`${await listen()}/api/auth/mobile/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const sessionsFor = (userId: string) =>
  getDb().select().from(sessions).where(eq(sessions.userId, userId));

test("a handoff is a ROW, so the instance that mints it need not be the one that redeems it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const code = await createMobileHandoff(userId);

  // What another instance would see: nothing in this process's memory, one
  // row in the shared table, carrying the account and a short expiry.
  const [row] = await getDb().select().from(authStates).where(eq(authStates.state, code));
  assert.ok(row, "the code is in the database");
  assert.equal(row.provider, "mobile-handoff");
  assert.equal(row.pkceVerifier, userId);
  const ttl = new Date(row.expiresAt).getTime() - Date.now();
  assert.ok(ttl > MOBILE_HANDOFF_TTL_MS - 5_000 && ttl <= MOBILE_HANDOFF_TTL_MS, `ttl ${ttl}`);

  assert.deepEqual(await consumeMobileHandoff(code), { userId });
});

test("a code redeems exactly once", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const code = await createMobileHandoff(userId);
  assert.deepEqual(await consumeMobileHandoff(code), { userId });
  assert.equal(await consumeMobileHandoff(code), null, "replay finds nothing");
  assert.equal(await consumeMobileHandoff("not-a-code"), null);
});

test("an expired code is refused, and consumed on the way", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  const code = await createMobileHandoff(userId);
  await getDb()
    .update(authStates)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(authStates.state, code));
  assert.equal(await consumeMobileHandoff(code), null);
  const rows = await getDb().select().from(authStates).where(eq(authStates.state, code));
  assert.equal(rows.length, 0, "the dead row does not linger for the sweep");
});

test("an OAuth state is not a handoff: provider scoping keeps the two apart", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();
  // A leaked `state` from a mobile OAuth start must never be tradeable for a
  // session, and a handoff code must never satisfy a callback's state check.
  const state = await createAuthState({ provider: "google-mobile", pkceVerifier: userId });
  try {
    assert.equal(await consumeMobileHandoff(state), null);
    const [still] = await getDb().select().from(authStates).where(eq(authStates.state, state));
    assert.ok(still, "the OAuth state is untouched by the failed redemption");
  } finally {
    await getDb().delete(authStates).where(eq(authStates.state, state));
  }
  const code = await createMobileHandoff(userId);
  const [asState] = await getDb()
    .delete(authStates)
    .where(and(eq(authStates.state, code), eq(authStates.provider, "google-mobile")))
    .returning();
  assert.equal(asState, undefined, "a handoff code does not pass as a google-mobile state");
  await consumeMobileHandoff(code);
});

test("POST /mobile/exchange: the session is minted on redemption and resolves to the account", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const userId = await makeUser();

  assert.equal((await exchange({})).status, 400);
  const unknown = await exchange({ code: "definitely-not-issued" });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /expired/);

  const code = await createMobileHandoff(userId);
  // The security property: nothing exists for a sign-in nobody finished.
  assert.equal((await sessionsFor(userId)).length, 0, "no session before the exchange");

  const ok = await exchange({ code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(typeof ok.body.token, "string");
  assert.equal((await sessionsFor(userId)).length, 1, "exactly one session, minted by the exchange");
  const resolved = await resolveSession(ok.body.token);
  assert.equal(resolved?.userId, userId, "the token the app receives is the account's");

  // Replay: the code is spent, and no second session appears.
  const again = await exchange({ code });
  assert.equal(again.status, 400);
  assert.equal((await sessionsFor(userId)).length, 1);
});
