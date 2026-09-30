/**
 * routes/costs.db.test.ts — GET /api/admin/costs (Sep 30).
 *
 * What it must get right: it is behind the admin secret like every admin
 * route; the 7- and 30-day windows count what they say; the top accounts are
 * ranked by fresh extractions and by estimated spend separately; a cache hit
 * is never counted as fresh or as spend; signed-out trials are a total, not
 * a row; and no email ever leaves, only account ids.
 *
 * Rows are seeded with outsized counts and costs so the ranking holds
 * whatever else the shared test database contains, and are marked by host
 * so only they are removed.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { extractionEvents, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { adminRouter, resetAdminThrottle } from "./admin";

const SECRET = "test-admin-secret-costs-0123456789";
const MARK = `costs-${crypto.randomUUID()}.invalid`;

let server: Server | null = null;
let base = "";
let seeded = false;
const minted: string[] = [];

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

async function costs(secret: string | null, env: string | null = SECRET) {
  const prev = process.env.ADMIN_SECRET;
  if (env === null) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = env;
  resetAdminThrottle();
  try {
    const res = await fetch(`${await listen()}/api/admin/costs`, { headers: secret ? { "x-admin-secret": secret } : {} });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text || "{}") };
  } finally {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

/** A heavy extractor (many cheap reads), a big spender (few dear ones),
 *  their cache hits, one read ten days ago, and a signed-out trial. */
async function seed() {
  const db = getDb();
  const heavy = crypto.randomUUID();
  const spender = crypto.randomUUID();
  for (const id of [heavy, spender]) {
    await db.insert(users).values({ id, displayName: "Cost Test", email: `${id}@costs.example.test` });
    minted.push(id);
  }
  const row = (userId: string | null, cached: boolean, cost: string, at = new Date(), source = "text") => ({
    source,
    cached,
    ok: true,
    host: MARK,
    userId,
    inputTokens: cached ? 0 : 5000,
    outputTokens: cached ? 0 : 1000,
    estCostUsd: cost,
    at,
  });
  await db.insert(extractionEvents).values([
    ...Array.from({ length: 300 }, () => row(heavy, false, "0.020000")),
    ...Array.from({ length: 50 }, () => row(heavy, true, "0")),
    row(heavy, false, "0.020000", daysAgo(10)),
    row(spender, false, "400.000000", new Date(), "url"),
    row(spender, false, "400.000000", new Date(), "url"),
    row(null, false, "0.030000"),
  ]);
  seeded = true;
  return { heavy, spender };
}

after(async () => {
  if (!seeded) return;
  const db = getDb();
  await db.delete(extractionEvents).where(eq(extractionEvents.host, MARK));
  for (const id of minted) await db.delete(users).where(eq(users.id, id));
  server?.close();
});

test("costs: absent without ADMIN_SECRET, refused with the wrong one", async (t) => {
  if (!(await needsDatabase(t, "extraction_events", "users"))) return;
  assert.equal((await costs(SECRET, null)).status, 404);
  assert.equal((await costs("wrong-secret")).status, 401);
  assert.equal((await costs(null)).status, 401);
});

test("costs: windows, both rankings, cache hits free and not fresh, ids and never emails", async (t) => {
  if (!(await needsDatabase(t, "extraction_events", "users"))) return;
  const { heavy, spender } = await seed();
  const r = await costs(SECRET);
  assert.equal(r.status, 200);
  assert.match(r.body.estimate, /Estimated at list price/);

  const week = r.body.last7Days;
  const month = r.body.last30Days;
  assert.equal(week.days, 7);
  assert.equal(month.days, 30);

  const inWeek = (list: { userId: string; fresh: number; estCostUsd: number }[], id: string) => list.find((a) => a.userId === id);
  assert.deepEqual(inWeek(week.topByFresh, heavy), { userId: heavy, fresh: 300, estCostUsd: 6 }, "cache hits are neither fresh nor spend");
  assert.deepEqual(inWeek(month.topByFresh, heavy), { userId: heavy, fresh: 301, estCostUsd: 6.02 }, "the ten-day-old read is in 30 days only");
  assert.equal(week.topByFresh[0].userId, heavy, "most fresh extractions first");
  assert.equal(week.topBySpend[0].userId, spender, "most spend first");
  assert.equal(week.topBySpend[0].estCostUsd, 800);
  assert.ok(week.topByFresh.length <= 20 && week.topBySpend.length <= 20);
  assert.ok(!week.topByFresh.some((a: { userId: string | null }) => a.userId === null), "a signed-out trial is not a row");

  assert.ok(week.fresh >= 303 && week.cached >= 50, "the totals include the seeded rows");
  assert.ok(week.estCostUsd >= 806.03);
  assert.ok(week.signedOut.fresh >= 1 && week.signedOut.estCostUsd >= 0.03);
  assert.ok(week.bySource.text.fresh >= 301 && week.bySource.url.fresh >= 2);
  assert.equal(typeof week.perFresh.median, "number");

  assert.doesNotMatch(r.text, /@/, "no email address anywhere in the answer");
});

test("costs: the cost columns are in this database (the health check's registry names them)", async (t) => {
  if (!(await needsDatabase(t, "extraction_events"))) return;
  const cols = (await getDb().execute(sql`
    select column_name from information_schema.columns
    where table_name = 'extraction_events' and column_name in ('user_id','input_tokens','output_tokens','est_cost_usd')`)) as unknown as { rows: unknown[] };
  assert.equal(cols.rows.length, 4);
});
