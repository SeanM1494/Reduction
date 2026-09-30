/**
 * routes/counters.db.test.ts — the anonymous daily counters (Sep 30).
 *
 * What must hold: the app can report only the closed list of names, and only
 * signed in; a count has no user attached anywhere; concurrent increments
 * all land; a wall hit is counted where the 402 is written; and the admin
 * read shows totals, never a person.
 *
 * The counters are shared totals, so each test measures the CHANGE in a
 * count rather than its value, and cleans nothing it did not create.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { needsDatabase } from "../lib/testdb";
import { countEvent, CLIENT_COUNTERS, isClientCounter } from "../lib/counters";
import { countersRouter, resetCounterBrake } from "./counters";
import { adminRouter, resetAdminThrottle } from "./admin";
import { subscriptionRequired } from "../lib/billing/access";

const SECRET = "test-admin-secret-counters-0123456789";
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
  app.use("/api/counters", countersRouter);
  app.use("/api/admin", adminRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

after(() => server?.close());

async function today(name: string): Promise<number> {
  const r = (await getDb().execute(sql`
    select count from daily_counters where day = (now() at time zone 'utc')::date and name = ${name}`)) as unknown as {
    rows: Array<{ count: number }>;
  };
  return Number(r.rows[0]?.count ?? 0);
}

const post = async (name: unknown, user: string | null = "counter-user") =>
  (
    await fetch(`${await listen()}/api/counters`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: JSON.stringify({ name }),
    })
  ).status;

const settle = () => new Promise((r) => setTimeout(r, 200));

test("counters: the table holds day, name and count — no column that could name anyone", async (t) => {
  if (!(await needsDatabase(t, "daily_counters"))) return;
  const cols = ((await getDb().execute(sql`
    select column_name from information_schema.columns where table_name = 'daily_counters' order by column_name`)) as unknown as {
    rows: Array<{ column_name: string }>;
  }).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["count", "day", "name"]);
});

test("counters: the app reports only the allow-listed names, and only signed in", async (t) => {
  if (!(await needsDatabase(t, "daily_counters"))) return;
  resetCounterBrake();
  assert.equal(await post("reel_shown", null), 401);
  assert.equal(await post("save"), 400, "a server-side name cannot be reported by the app");
  assert.equal(await post("anything_else"), 400);
  assert.equal(await post({ name: "reel_shown" }), 400);
  assert.equal(isClientCounter("reel_tap_data"), true);
  const before = await today("reel_tap_curated");
  assert.equal(await post("reel_tap_curated"), 204);
  await settle();
  assert.equal(await today("reel_tap_curated"), before + 1);
  for (const n of CLIENT_COUNTERS) assert.ok(n.startsWith("reel_"), "the client list is the reel's events only");
});

test("counters: concurrent increments all land (one row per day and name)", async (t) => {
  if (!(await needsDatabase(t, "daily_counters"))) return;
  const before = await today("coupon_redeemed");
  await Promise.all(Array.from({ length: 12 }, () => countEvent("coupon_redeemed")));
  assert.equal(await today("coupon_redeemed"), before + 12);
});

test("counters: a wall hit is counted where the 402 is written", async (t) => {
  if (!(await needsDatabase(t, "daily_counters"))) return;
  const before = await today("wall_hit.subscription_required");
  const fake = { status: () => fake, json: () => fake } as unknown as import("express").Response;
  subscriptionRequired(fake, null);
  await settle();
  assert.equal(await today("wall_hit.subscription_required"), before + 1);
});

test("counters: a per-account brake answers 429 past 120 an hour", async (t) => {
  if (!(await needsDatabase(t, "daily_counters"))) return;
  resetCounterBrake();
  for (let i = 0; i < 120; i++) assert.equal(await post("reel_shown", "brake-user"), 204);
  assert.equal(await post("reel_shown", "brake-user"), 429);
  assert.equal(await post("reel_shown", "another-user"), 204, "per account, not global");
  resetCounterBrake();
});

test("counters: the admin read is totals by day, with extractions by route beside them", async (t) => {
  if (!(await needsDatabase(t, "daily_counters", "extraction_events"))) return;
  const prev = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = SECRET;
  resetAdminThrottle();
  try {
    await countEvent("save");
    const res = await fetch(`${await listen()}/api/admin/counters?days=7`, { headers: { "x-admin-secret": SECRET } });
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.days, 7);
    assert.ok(body.counters[0].counts.save >= 1);
    assert.ok(Array.isArray(body.extractions));
    assert.doesNotMatch(text, /counter-user|brake-user|userId|user_id/, "no person anywhere in it");
    const wrong = await fetch(`${await listen()}/api/admin/counters`, { headers: { "x-admin-secret": "nope" } });
    assert.equal(wrong.status, 401);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
});
