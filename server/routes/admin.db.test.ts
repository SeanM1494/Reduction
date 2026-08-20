/**
 * server/routes/admin.db.test.ts — the operator lookup.
 *
 * Driven through the real Express router with supertest-free plumbing (a
 * bare http server on an ephemeral port), because what is under test is the
 * GATE as much as the query: a route that 404s without a secret, refuses a
 * wrong one, and only then reads. Testing the handler function directly would
 * skip exactly the part that keeps other people out.
 */

import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, identities, users } from "../../shared/schema";
import { needsDatabase } from "../lib/testdb";
import { adminRouter, resetAdminThrottle } from "./admin";

const TABLES = ["users", "identities", "account_access"];
const SECRET = "test-admin-secret-0123456789";

let server: Server | null = null;
let base = "";

async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use("/api/admin", adminRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const minted = new Set<string>();

async function makeUser(email: string | null, providerEmail?: string) {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Admin Test", email });
  if (providerEmail !== undefined) {
    await getDb().insert(identities).values({
      provider: "google",
      subject: `subj-${id}`,
      userId: id,
      email: providerEmail,
      emailVerified: true,
    });
  }
  minted.add(id);
  return id;
}

after(async () => {
  // getDb() throws with no DATABASE_URL, and every test here skips in that
  // case — so an unguarded teardown turns a clean skip into a failure.
  if (minted.size) {
    const db = getDb();
    for (const id of minted) {
      await db.delete(identities).where(eq(identities.userId, id));
      await db.delete(accountAccess).where(eq(accountAccess.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
    minted.clear();
  }
  server?.close();
});

async function lookup(email: string, secret: string | null) {
  const url = `${await listen()}/api/admin/user?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: secret === null ? {} : { "x-admin-secret": secret },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function withSecret<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ADMIN_SECRET;
  if (value === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = value;
  return fn().finally(() => {
    if (saved === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = saved;
  });
}

test("with ADMIN_SECRET unset the route does not exist", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(undefined, async () => {
    const { status } = await lookup("anyone@example.com", "whatever");
    // 404, not 401: an unconfigured admin surface should not advertise that
    // it is there and merely locked.
    assert.equal(status, 404);
  });
});

test("a wrong or missing secret is refused", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    assert.equal((await lookup("a@b.test", null)).status, 401);
    assert.equal((await lookup("a@b.test", "wrong")).status, 401);
    // A prefix of the real secret must fare no better than nonsense — the
    // compare is over hashes, so length tells an attacker nothing either.
    assert.equal((await lookup("a@b.test", SECRET.slice(0, 10))).status, 401);
  });
});

test("finds an account by its display email", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  const email = `find-${crypto.randomUUID()}@example.test`;
  const id = await makeUser(email);
  await withSecret(SECRET, async () => {
    const { status, body } = await lookup(email, SECRET);
    assert.equal(status, 200);
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].id, id);
  });
});

test("finds an account by its PROVIDER email when the display one differs", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  const provider = `prov-${crypto.randomUUID()}@example.test`;
  // users.email is display-only and can be stale; identities.email is what
  // the provider last said. An operator has whichever address they were
  // given, and guessing which column it landed in is the hand-written SQL
  // this route exists to replace.
  const id = await makeUser("stale@example.test", provider);
  await withSecret(SECRET, async () => {
    const { body } = await lookup(provider, SECRET);
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].id, id);
  });
});

test("matching is case-insensitive and ignores surrounding space", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  const email = `Case-${crypto.randomUUID()}@Example.Test`;
  const id = await makeUser(email.toLowerCase());
  await withSecret(SECRET, async () => {
    const { body } = await lookup(`  ${email.toUpperCase()}  `, SECRET);
    assert.equal(body.users.length, 1, "addresses get typed from memory");
    assert.equal(body.users[0].id, id);
  });
});

test("two accounts sharing an email are BOTH returned", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  const email = `dupe-${crypto.randomUUID()}@example.test`;
  const a = await makeUser(email);
  const b = await makeUser(email);
  await withSecret(SECRET, async () => {
    const { body } = await lookup(email, SECRET);
    // There is deliberately no unique constraint on email — see schema.ts for
    // the account-takeover reason. Collapsing to the first match would hide
    // the second, which is precisely the case an operator needs to see.
    assert.equal(body.users.length, 2);
    const ids = body.users.map((u: { id: string }) => u.id).sort();
    assert.deepEqual(ids, [a, b].sort());
  });
});

test("an unknown address returns an empty list, not an error", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    const { status, body } = await lookup("nobody-here@example.test", SECRET);
    assert.equal(status, 200);
    assert.deepEqual(body.users, []);
  });
});

test("the answer carries why they might be walled", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  const email = `access-${crypto.randomUUID()}@example.test`;
  const id = await makeUser(email);
  await getDb()
    .insert(accountAccess)
    .values({ userId: id, recipeAllowance: 1, recipesUsed: 1 });
  await withSecret(SECRET, async () => {
    const { body } = await lookup(email, SECRET);
    // The operational reason to look someone up is almost always "why can't
    // they add a recipe", so the answer ships with the id.
    assert.deepEqual(body.users[0].access, {
      allowance: 1,
      used: 1,
      enforceOverride: null,
    });
  });
});

test("a missing email parameter is refused before any query", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    const res = await fetch(`${await listen()}/api/admin/user`, {
      headers: { "x-admin-secret": SECRET },
    });
    assert.equal(res.status, 422);
  });
});

test("the brake counts guesses, not work", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const email = `brake-${crypto.randomUUID()}@example.test`;
  await makeUser(email);
  await withSecret(SECRET, async () => {
    // Well past MAX_FAILURES. An operator working a support queue must not
    // be locked out by a mechanism aimed at somebody guessing.
    for (let i = 0; i < 15; i++) {
      assert.equal((await lookup(email, SECRET)).status, 200, `lookup ${i + 1}`);
    }

    // Failures DO accumulate, and lock out.
    for (let i = 0; i < 10; i++) await lookup(email, "wrong");
    assert.equal((await lookup(email, "wrong")).status, 429, "guessing is braked");
    // And the brake applies to a correct secret too while it is engaged —
    // otherwise it brakes nothing an attacker cares about.
    assert.equal((await lookup(email, SECRET)).status, 429);
  });
  resetAdminThrottle();
});

test("a success clears earlier failures", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const email = `clear-${crypto.randomUUID()}@example.test`;
  await makeUser(email);
  await withSecret(SECRET, async () => {
    // A fat-fingered paste, then the right one, should leave no residue.
    for (let i = 0; i < 9; i++) await lookup(email, "wrong");
    assert.equal((await lookup(email, SECRET)).status, 200);
    for (let i = 0; i < 9; i++) await lookup(email, "wrong");
    assert.equal((await lookup(email, SECRET)).status, 200, "the counter was reset");
  });
  resetAdminThrottle();
});
