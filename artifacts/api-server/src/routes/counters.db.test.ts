/**
 * routes/counters.db.test.ts — the anonymous daily counters (Sep 30).
 *
 * What must hold: the app can report only the closed list of names, and only
 * signed in; a count has no user attached anywhere; concurrent increments
 * all land; a wall hit is counted where the 402 is written; and the admin
 * reads (the counts, and the usage report built on the library) show
 * totals, never a person.
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
import { countEvent, CLIENT_COUNTERS, COOK_COUNTERS, isClientCounter } from "../lib/counters";
import { readUsage } from "../lib/usage";
import { randomUUID } from "node:crypto";
import { recipes, users } from "@workspace/db";
import { inArray } from "drizzle-orm";
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
  for (const n of CLIENT_COUNTERS)
    assert.ok(n.startsWith("reel_") || (COOK_COUNTERS as readonly string[]).includes(n), "the client list is the reel's and the cooking view's events only");
  assert.equal(await post("recipe_opened"), 204, "the cooking view's events are on the list");
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

const DAY = 86_400_000;
const tiny = { title: "t", servings: 1, sections: [] };

test("usage: repeat cooks, cooked-through shares and the view split, as totals", async (t) => {
  if (!(await needsDatabase(t, "daily_counters", "users", "recipes"))) return;
  const db = getDb();
  const [a, b, c, me] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const now = Date.now();
  await db.insert(users).values([a, b, c, me].map((id) => ({ id, displayName: "Usage Test" })));
  // a: two recipes cooked, on two days, one of them 8 days after joining.
  // b: one recipe started, never finished; one untouched, from a paste.
  // c: nothing at all. me: cooks a lot, and is excluded.
  await db.execute(sql`update users set created_at = now() - interval '10 days' where id = ${a}`);
  const r = (owner: string, id: string, fields: Record<string, unknown>) => ({
    id,
    ownerKey: `usage-test-${owner}`,
    userId: owner,
    recipe: { ...tiny, sourceUrl: "https://example.invalid/r" } as never,
    ...fields,
  });
  await db.insert(recipes).values([
    r(a, "a1", { cooked: [now - 9 * DAY], mode: "steps" }),
    r(a, "a2", { cooked: [now - 2 * DAY, now - DAY] }),
    r(b, "b1", { done: ["s1"] }),
    { ...r(b, "b2", {}), recipe: tiny as never },
    r(me, "m1", { cooked: [now - DAY, now], mode: "steps" }),
  ]);
  try {
    const u = await readUsage(30, [me], [a, b, c, me]);
    assert.equal(u.excluded, 1);
    assert.deepEqual(u.comingBack, { signedUp: 3, cookedOne: 1, cookedTwoRecipes: 1, cookedTwoDays: 1, cookedAfterWeek: 1 });
    const link = u.cookedThrough.find((x) => x.kind === "link")!;
    const other = u.cookedThrough.find((x) => x.kind === "other")!;
    assert.deepEqual(link, { kind: "link", saved: 3, started: 3, cooked: 2, lastViewSteps: 1 });
    assert.deepEqual(other, { kind: "other", saved: 1, started: 0, cooked: 0, lastViewSteps: 0 });
    assert.deepEqual(Object.keys(u.views).sort(), [...COOK_COUNTERS].sort());
    const text = JSON.stringify(u);
    for (const id of [a, b, c, me]) assert.ok(!text.includes(id), "no account id in the report");
    assert.doesNotMatch(text, /usage-test|example\.invalid/);
  } finally {
    await db.delete(recipes).where(inArray(recipes.userId, [a, b, c, me]));
    await db.delete(users).where(inArray(users.id, [a, b, c, me]));
  }
});

test("usage: the cooking-view counts sum over the window", async (t) => {
  if (!(await needsDatabase(t, "daily_counters", "users", "recipes"))) return;
  const before = (await readUsage(7, [], [])).views.finished_steps;
  await countEvent("finished_steps");
  await countEvent("finished_steps");
  const after = (await readUsage(7, [], [])).views.finished_steps;
  assert.equal(after - before, 2);
});

test("usage: the admin read answers JSON and text, behind the secret, with no person in either", async (t) => {
  if (!(await needsDatabase(t, "daily_counters", "users", "recipes"))) return;
  const prev = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = SECRET;
  resetAdminThrottle();
  try {
    const h = { headers: { "x-admin-secret": SECRET } };
    const json = await fetch(`${await listen()}/api/admin/usage?days=30&exclude=someone`, h);
    assert.equal(json.status, 200);
    const body = (await json.json()) as { days: number; excluded: number };
    assert.equal(body.days, 30);
    assert.equal(body.excluded, 1);
    const text = await fetch(`${await listen()}/api/admin/usage?format=text`, h);
    assert.equal(text.status, 200);
    assert.match(text.headers.get("content-type") ?? "", /text\/plain/);
    const s = await text.text();
    assert.match(s, /COMING BACK/);
    assert.doesNotMatch(s, /someone|user_id|userId|@/);
    assert.equal((await fetch(`${await listen()}/api/admin/usage`, { headers: { "x-admin-secret": "nope" } })).status, 401);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
});
