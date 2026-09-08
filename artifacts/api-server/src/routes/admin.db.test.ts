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
import { accountAccess, adminEvents, coupons, couponRedemptions, identities, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { adminRouter, resetAdminThrottle } from "./admin";
import { normaliseCode } from "../lib/billing/coupons";

const TABLES = ["users", "identities", "account_access", "admin_events", "coupons", "coupon_redemptions"];
const SECRET = "test-admin-secret-0123456789";

let server: Server | null = null;
let base = "";

async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json());
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
      await db.delete(adminEvents).where(eq(adminEvents.targetUserId, id));
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
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
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

// ---------------------------------------------------------------------------
// PATCH: setting enforce_override.
// ---------------------------------------------------------------------------

async function patchUser(body: unknown, secret: string | null) {
  const res = await fetch(`${await listen()}/api/admin/user`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { "x-admin-secret": secret }),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const overrideOf = async (userId: string) => {
  const [row] = await getDb()
    .select({ v: accountAccess.enforceOverride })
    .from(accountAccess)
    .where(eq(accountAccess.userId, userId));
  return row?.v ?? null;
};

const auditFor = (userId: string) =>
  getDb().select().from(adminEvents).where(eq(adminEvents.targetUserId, userId));

test("PATCH is gated exactly like GET", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const id = await makeUser(`patchgate-${crypto.randomUUID()}@example.test`);
  await withSecret(undefined, async () => {
    assert.equal((await patchUser({ userId: id, enforceOverride: true }, "x")).status, 404);
  });
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    assert.equal((await patchUser({ userId: id, enforceOverride: true }, null)).status, 401);
    assert.equal((await patchUser({ userId: id, enforceOverride: true }, "wrong")).status, 401);
  });
  // Nothing was written by any of the refused calls.
  assert.equal(await overrideOf(id), null);
  assert.equal((await auditFor(id)).length, 0);
  resetAdminThrottle();
});

test("sets true, false, and clears back to null", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const id = await makeUser(`tri-${crypto.randomUUID()}@example.test`);
  await withSecret(SECRET, async () => {
    let r = await patchUser({ userId: id, enforceOverride: true }, SECRET);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.before, r.body.after, r.body.changed], [null, true, true]);
    assert.equal(await overrideOf(id), true);

    r = await patchUser({ userId: id, enforceOverride: false }, SECRET);
    assert.deepEqual([r.body.before, r.body.after], [true, false]);
    assert.equal(await overrideOf(id), false);

    // null is a VALUE here — "follow the global flag" — not an absent field.
    r = await patchUser({ userId: id, enforceOverride: null }, SECRET);
    assert.deepEqual([r.body.before, r.body.after], [false, null]);
    assert.equal(await overrideOf(id), null);
  });
  resetAdminThrottle();
});

test("null clears rather than forcing off — the states are different", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const id = await makeUser(`nullvsfalse-${crypto.randomUUID()}@example.test`);
  await withSecret(SECRET, async () => {
    await patchUser({ userId: id, enforceOverride: false }, SECRET);
    assert.equal(await overrideOf(id), false, "false means never enforce");
    await patchUser({ userId: id, enforceOverride: null }, SECRET);
    // The bug this guards: `if (!body.enforceOverride)` collapses false, null
    // and missing into one branch, so "clear it" silently becomes "force it
    // off" — identical-looking until the global flag is switched on.
    assert.equal(await overrideOf(id), null, "null means follow the global flag");
  });
  resetAdminThrottle();
});

test("a missing enforceOverride key is refused, and writes nothing", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const id = await makeUser(`missing-${crypto.randomUUID()}@example.test`);
  await withSecret(SECRET, async () => {
    assert.equal((await patchUser({ userId: id }, SECRET)).status, 422);
    for (const bad of ["true", 1, 0, "", "null", {}]) {
      assert.equal(
        (await patchUser({ userId: id, enforceOverride: bad }, SECRET)).status,
        422,
        `${JSON.stringify(bad)} is not a tri-state`
      );
    }
    assert.equal((await patchUser({ enforceOverride: true }, SECRET)).status, 422);
  });
  assert.equal((await auditFor(id)).length, 0);
  resetAdminThrottle();
});

test("an unknown user id is 404, not a 500 from the foreign key", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    const r = await patchUser(
      { userId: crypto.randomUUID(), enforceOverride: true },
      SECRET
    );
    assert.equal(r.status, 404, "a typo'd id must read as a wrong id");
  });
  resetAdminThrottle();
});

test("every change leaves an audit row with both sides of it", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const id = await makeUser(`audit-${crypto.randomUUID()}@example.test`);
  await withSecret(SECRET, async () => {
    await patchUser({ userId: id, enforceOverride: true, note: "dogfooding" }, SECRET);
    await patchUser({ userId: id, enforceOverride: null }, SECRET);
  });
  const rows = (await auditFor(id)).sort((a, b) => a.id - b.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.action, r.before, r.after]),
    [
      ["set_enforce_override", "null", "true"],
      ["set_enforce_override", "true", "null"],
    ]
  );
  // Tri-state survives as text: "null" is distinguishable from a SQL NULL
  // meaning "not recorded", which a nullable boolean column could not do.
  assert.equal(rows[0].note, "dogfooding");
  assert.ok(rows[0].actorIp, "the actor's address is recorded");
  assert.ok(rows[0].at instanceof Date);
  resetAdminThrottle();
});

test("a no-op override is recorded, and says it changed nothing", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const id = await makeUser(`noop-${crypto.randomUUID()}@example.test`);
  await withSecret(SECRET, async () => {
    await patchUser({ userId: id, enforceOverride: true }, SECRET);
    const r = await patchUser({ userId: id, enforceOverride: true }, SECRET);
    assert.equal(r.body.changed, false);
    assert.deepEqual([r.body.before, r.body.after], [true, true]);
  });
  // Still audited: "someone tried to set this again" is worth knowing, and an
  // audit trail that omits attempts is not one.
  assert.equal((await auditFor(id)).length, 2);
  resetAdminThrottle();
});

test("the GET reports what the PATCH set, so the two agree", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const email = `roundtrip-${crypto.randomUUID()}@example.test`;
  const id = await makeUser(email);
  await withSecret(SECRET, async () => {
    await patchUser({ userId: id, enforceOverride: true }, SECRET);
    const { body } = await lookup(email, SECRET);
    assert.equal(body.users[0].access.enforceOverride, true);
  });
  resetAdminThrottle();
});

// ---------------------------------------------------------------------------
// The Anthropic preflight.
//
// The real API is never called: the SDK honours ANTHROPIC_BASE_URL, so a
// local stub plays the failures worth testing. What is under test is the
// SURFACING — that the API's own words reach the operator verbatim instead
// of collapsing into "something went wrong" — not Anthropic's behaviour.
// ---------------------------------------------------------------------------

async function stubAnthropic(
  status: number,
  body: unknown
): Promise<{ url: string; close: () => void }> {
  const srv = createServer((_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => srv.close() };
}

async function preflightAnthropic(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const res = await fetch(`${await listen()}/api/admin/preflight/anthropic`, {
      headers: { "x-admin-secret": SECRET },
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    process.env = saved;
  }
}

test("anthropic preflight: no key says so without calling anything", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    const { body } = await preflightAnthropic({ ANTHROPIC_API_KEY: undefined });
    assert.equal(body.ok, false);
    assert.equal(body.keyPresent, false);
    assert.match(String(body.note), /unset/);
  });
  resetAdminThrottle();
});

test("anthropic preflight: an expired key's rejection arrives verbatim", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const stub = await stubAnthropic(401, {
    type: "error",
    error: { type: "authentication_error", message: "API key is expired." },
  });
  try {
    await withSecret(SECRET, async () => {
      const { body } = await preflightAnthropic({
        ANTHROPIC_API_KEY: "sk-ant-api03-test-not-real",
        ANTHROPIC_BASE_URL: stub.url,
      });
      assert.equal(body.ok, false);
      assert.equal(body.status, 401);
      // The whole point: the API named the problem, and its words survive to
      // the operator instead of becoming "something went wrong".
      assert.match(String(body.error), /expired/i);
      assert.match(String(body.hint), /invalid, expired, or revoked/);
      // And the key itself is not in the report.
      assert.equal(JSON.stringify(body).includes("test-not-real"), false);
      assert.equal(body.keyPrefix, "sk-ant-api");
    });
  } finally {
    stub.close();
  }
  resetAdminThrottle();
});

test("anthropic preflight: exhausted credits get the credits hint", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const stub = await stubAnthropic(400, {
    type: "error",
    error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
  });
  try {
    await withSecret(SECRET, async () => {
      const { body } = await preflightAnthropic({
        ANTHROPIC_API_KEY: "sk-ant-api03-test-not-real",
        ANTHROPIC_BASE_URL: stub.url,
      });
      assert.equal(body.ok, false);
      assert.match(String(body.hint), /out of credits/);
    });
  } finally {
    stub.close();
  }
  resetAdminThrottle();
});

test("anthropic preflight: a working key reports ok and the model that answered", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const stub = await stubAnthropic(200, {
    id: "msg_stub",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: "p" }],
    stop_reason: "max_tokens",
    usage: { input_tokens: 3, output_tokens: 1 },
  });
  try {
    await withSecret(SECRET, async () => {
      const { body } = await preflightAnthropic({
        ANTHROPIC_API_KEY: "sk-ant-api03-test-not-real",
        ANTHROPIC_BASE_URL: stub.url,
      });
      assert.equal(body.ok, true);
      assert.equal(body.modelAnswered, "claude-sonnet-5");
      assert.equal(typeof body.ms, "number");
    });
  } finally {
    stub.close();
  }
  resetAdminThrottle();
});

// ---------------------------------------------------------------------------
// Minting coupons.
// ---------------------------------------------------------------------------

const mintedCodes = new Set<string>();

async function mint(body: unknown, secret: string | null = SECRET) {
  const res = await fetch(`${await listen()}/api/admin/coupon`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { "x-admin-secret": secret }),
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (typeof parsed.code === "string") mintedCodes.add(parsed.code);
  return { status: res.status, body: parsed };
}

after(async () => {
  if (mintedCodes.size) {
    const db = getDb();
    for (const code of mintedCodes) {
      await db.delete(couponRedemptions).where(eq(couponRedemptions.code, code));
      await db.delete(coupons).where(eq(coupons.code, code));
    }
    mintedCodes.clear();
  }
});

test("minting is gated exactly like everything else here", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(undefined, async () => {
    assert.equal((await mint({ code: "X", recipes: 1 }, "x")).status, 404);
  });
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    assert.equal((await mint({ code: "X", recipes: 1 }, null)).status, 401);
  });
  resetAdminThrottle();
});

test("mints a code, normalised the same way redemption normalises it", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const raw = `neighbor ${crypto.randomUUID().slice(0, 8)}`;
  await withSecret(SECRET, async () => {
    const { status, body } = await mint({ code: raw, recipes: 10, maxRedemptions: 1 });
    assert.equal(status, 200);
    assert.equal(body.created, true);
    // " neighbor abc " and "NEIGHBORABC" must be the same code on both ends,
    // or a code typed off a text message fails for its spaces.
    assert.equal(body.code, normaliseCode(raw));
  });
  resetAdminThrottle();
});

test("a duplicate code is refused loudly, and the original is untouched", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const code = `DUPE${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await withSecret(SECRET, async () => {
    assert.equal((await mint({ code, recipes: 5 })).status, 200);
    const again = await mint({ code, recipes: 500 });
    // createCoupon's onConflictDoNothing used to make this silent — an
    // operator re-minting with a different grant was told nothing while the
    // old value stayed live.
    assert.equal(again.status, 409);
    const [row] = await getDb().select().from(coupons).where(eq(coupons.code, code));
    assert.equal(row.recipes, 5, "the original grant survives");
  });
  resetAdminThrottle();
});

test("bounds hold: zero, fractional and absurd grants are refused", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  await withSecret(SECRET, async () => {
    for (const recipes of [0, -1, 2.5, 10_001, "10", null, undefined]) {
      assert.equal((await mint({ code: `B${Date.now()}`, recipes })).status, 422, String(recipes));
    }
    assert.equal((await mint({ code: "", recipes: 1 })).status, 422, "empty code");
    assert.equal(
      (await mint({ code: "PAST", recipes: 1, expiresAt: "2001-01-01" })).status,
      422,
      "an already-expired code is a typo, not a promotion"
    );
  });
  resetAdminThrottle();
});

test("end to end: operator mints, account redeems, allowance rises", async (t) => {
  if (!(await needsDatabase(t as TestContext, ...TABLES))) return;
  resetAdminThrottle();
  const code = `E2E${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const userId = await makeUser(`e2e-${crypto.randomUUID()}@example.test`);
  await withSecret(SECRET, async () => {
    await mint({ code, recipes: 10, maxRedemptions: 1 });
  });
  // The neighbor's side of the transaction, through the same library call the
  // billing route uses.
  const { redeemCoupon } = await import("../lib/billing/coupons");
  const out = await redeemCoupon(userId, code.toLowerCase());
  assert.deepEqual(out, { ok: true, recipes: 10 });
  const [access] = await getDb()
    .select()
    .from(accountAccess)
    .where(eq(accountAccess.userId, userId));
  assert.equal(access.recipeAllowance, 11, "1 free + the 10 the code granted");
  // And the operator can see the redemption in the listing.
  await withSecret(SECRET, async () => {
    const res = await fetch(`${await listen()}/api/admin/coupons`, {
      headers: { "x-admin-secret": SECRET },
    });
    const { coupons: list } = (await res.json()) as {
      coupons: Array<{ code: string; redeemedCount: number }>;
    };
    assert.equal(list.find((c) => c.code === code)?.redeemedCount, 1);
  });
  resetAdminThrottle();
});
