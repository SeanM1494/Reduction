/**
 * server/routes/costBrake.db.test.ts — the daily brakes (lib/costBrake.ts)
 * in front of the paid model calls, against a real Postgres and a loopback
 * stand-in for the Messages API.
 *
 * What is under test: the decision is pure and refuses only past a limit;
 * today's use is read from extraction_events (so every instance sees every
 * other's spend); and a refused request makes NO model call, writes NO
 * extraction_events row (or it would count toward the brake that refused
 * it), and gives a signed-out visitor their trial back.
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, extractionEvents, trials, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { recipesRouter, resetRateLimitForTests } from "./recipes";
import {
  DEFAULT_LIMITS,
  brakeDecision,
  brakeLimits,
  startOfUtcDay,
  todaysUse,
  type BrakeLimits,
} from "../lib/costBrake";

const TABLES = ["users", "account_access", "extraction_events", "trials"];
const HOST = "costbrake-test.invalid";

// ------------------------------------------------------------ pure parts --
test("limits: unset is the default, `off` is none, and a typo is never unlimited", () => {
  assert.deepEqual(brakeLimits({}), DEFAULT_LIMITS);
  assert.deepEqual(
    brakeLimits({ EXTRACTION_DAILY_BUDGET_USD: "off", SIGNED_OUT_DAILY_EXTRACTIONS: " OFF ", ACCOUNT_DAILY_EXTRACTIONS: "off" }),
    { budgetUsd: null, signedOutPerDay: null, accountPerDay: null }
  );
  assert.equal(brakeLimits({ EXTRACTION_DAILY_BUDGET_USD: "7.5" }).budgetUsd, 7.5);
  for (const bad of ["0", "-3", "lots", "$25", "Infinity"])
    assert.equal(brakeLimits({ ACCOUNT_DAILY_EXTRACTIONS: bad }).accountPerDay, DEFAULT_LIMITS.accountPerDay, bad);
});

test("decision: each limit refuses at the limit, not before, and only its own actor", () => {
  const L: BrakeLimits = { budgetUsd: 10, signedOutPerDay: 5, accountPerDay: 3 };
  const use = { usd: 0, signedOutFresh: 0, accountFresh: 0 };
  assert.equal(brakeDecision(L, use, "u", "extract"), null);
  assert.equal(brakeDecision(L, { ...use, usd: 9.99 }, null, "extract"), null);
  assert.equal(brakeDecision(L, { ...use, usd: 10 }, "u", "extract")?.body.code, "daily_budget");
  assert.equal(brakeDecision(L, { ...use, usd: 10 }, null, "search")?.status, 503);

  assert.equal(brakeDecision(L, { ...use, accountFresh: 2 }, "u", "extract"), null);
  assert.equal(brakeDecision(L, { ...use, accountFresh: 3 }, "u", "extract")?.body.code, "account_daily_limit");
  // A signed-in account is never held by the signed-out pool, nor the reverse.
  assert.equal(brakeDecision(L, { ...use, signedOutFresh: 99 }, "u", "extract"), null);
  assert.equal(brakeDecision(L, { ...use, signedOutFresh: 5 }, null, "extract")?.body.code, "signed_out_daily_limit");
  // The counts are of extractions; a search answers only to the budget.
  assert.equal(brakeDecision(L, { ...use, signedOutFresh: 5, accountFresh: 3 }, null, "search"), null);

  const none: BrakeLimits = { budgetUsd: null, signedOutPerDay: null, accountPerDay: null };
  assert.equal(brakeDecision(none, { usd: 1e6, signedOutFresh: 1e6, accountFresh: 1e6 }, null, "extract"), null);
});

test("the day starts at midnight UTC", () => {
  assert.equal(startOfUtcDay(new Date("2026-10-03T23:59:59-07:00")).toISOString(), "2026-10-04T00:00:00.000Z");
  assert.equal(startOfUtcDay(new Date("2026-10-03T00:00:00Z")).toISOString(), "2026-10-03T00:00:00.000Z");
});

// ---------------------------------------------------- the stand-in model --
let model: Server;
let modelCalls = 0;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "EXTRACTION_DAILY_BUDGET_USD",
  "SIGNED_OUT_DAILY_EXTRACTIONS",
  "ACCOUNT_DAILY_EXTRACTIONS",
];

before(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  model = createServer((req, res) => {
    modelCalls++;
    req.resume();
    req.on("end", () => {
      res.statusCode = 500;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  const a = model.address();
  process.env.ANTHROPIC_API_KEY = "stub-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});

let server: Server | null = null;
let base = "";
async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    req.session = u ? { userId: u } : null;
    next();
  });
  app.use("/api/recipes", recipesRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const minted = new Set<string>();
const trialIds = new Set<string>();
let touched = false;

after(async () => {
  server?.close();
  model?.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (!touched) return; // no database: touch nothing
  const db = getDb();
  await db.delete(extractionEvents).where(eq(extractionEvents.host, HOST));
  if (minted.size) await db.delete(extractionEvents).where(inArray(extractionEvents.userId, [...minted]));
  if (trialIds.size) await db.delete(trials).where(inArray(trials.id, [...trialIds]));
  for (const id of minted) {
    await db.delete(accountAccess).where(eq(accountAccess.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Cost Brake Test" });
  minted.add(id);
  return id;
}

/** A fresh (uncached) extraction today, as recordExtraction would write it. */
async function freshRow(userId: string | null, cost = "0.010000") {
  touched = true;
  await getDb().insert(extractionEvents).values({
    source: "text",
    cached: false,
    via: "self",
    host: HOST,
    ok: true,
    userId,
    estCostUsd: cost,
  });
}

async function eventsFor(userId: string): Promise<number> {
  const rows = await getDb().select().from(extractionEvents).where(eq(extractionEvents.userId, userId));
  return rows.length;
}

async function post(path: string, body: unknown, userId?: string) {
  const res = await fetch(`${await listen()}/api/recipes/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userId ? { "x-test-user": userId } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any, cookie: res.headers.get("set-cookie") };
}

function uniqueText(): string {
  return `Cost brake test ${crypto.randomUUID()}: whisk two eggs with a pinch of salt, then cook gently in butter.`;
}

function setLimits(l: Partial<Record<"budget" | "signedOut" | "account", string>>) {
  process.env.EXTRACTION_DAILY_BUDGET_USD = l.budget ?? "off";
  process.env.SIGNED_OUT_DAILY_EXTRACTIONS = l.signedOut ?? "off";
  process.env.ACCOUNT_DAILY_EXTRACTIONS = l.account ?? "off";
  resetRateLimitForTests();
}

// ------------------------------------------------------------- database --
test("today's use: an account's count is exact, and the pool and spend see it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const me = await makeUser();
  const before = await todaysUse(me);
  assert.equal(before.accountFresh, 0);

  await freshRow(me, "0.250000");
  await freshRow(me, "0.250000");
  await freshRow(null, "0.100000");
  // A cache hit cost nothing and counts toward nothing.
  await getDb().insert(extractionEvents).values({ source: "url", cached: true, host: HOST, ok: true, userId: me, estCostUsd: "0" });
  // Yesterday is not today.
  await getDb().insert(extractionEvents).values({
    source: "text", cached: false, host: HOST, ok: true, userId: me, estCostUsd: "9.000000",
    at: new Date(startOfUtcDay(new Date()).getTime() - 60_000),
  });

  const now = await todaysUse(me);
  assert.equal(now.accountFresh, 2);
  // Other suites write to this table at the same time, so the shared numbers
  // are checked as lower bounds.
  assert.ok(now.signedOutFresh >= before.signedOutFresh + 1);
  assert.ok(now.usd >= before.usd + 0.6 - 1e-9);
  assert.equal((await todaysUse(null)).accountFresh, 0);
});

test("an account at its daily limit is refused before any model call, and nothing is recorded", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const me = await makeUser();
  await freshRow(me);
  await freshRow(me);
  setLimits({ account: "2" });

  const calls = modelCalls;
  const res = await post("extract", { text: uniqueText() }, me);
  assert.equal(res.status, 429);
  assert.equal(res.body.code, "account_daily_limit");
  assert.equal(modelCalls, calls);
  // Give the finish hook its turn: a row written for the refusal would land now.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await eventsFor(me), 2);

  // One under the limit goes through to the model (which the stub fails).
  setLimits({ account: "3" });
  const ok = await post("extract", { text: uniqueText() }, me);
  assert.notEqual(ok.status, 429);
  assert.ok(modelCalls > calls);
});

test("a signed-out visitor refused by the pool gets the trial back", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await freshRow(null);
  setLimits({ signedOut: "0.5" }); // any signed-out row today reaches it

  const calls = modelCalls;
  const res = await post("extract", { text: uniqueText() });
  assert.equal(res.status, 429);
  assert.equal(res.body.code, "signed_out_daily_limit");
  assert.equal(modelCalls, calls);

  const id = /trial=([^;]+)/.exec(res.cookie ?? "")?.[1];
  assert.ok(id, "a trial cookie was minted");
  trialIds.add(decodeURIComponent(id!));
  const [row] = await getDb().select().from(trials).where(eq(trials.id, decodeURIComponent(id!)));
  assert.equal(row?.usedAt ?? null, null, "the try was refunded");
});

test("past the budget a search makes no web call and says why", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await freshRow(null, "0.010000");
  setLimits({ budget: "0.000001" });

  const calls = modelCalls;
  const res = await post("search", { query: `zq${crypto.randomUUID().slice(0, 8)} nonexistent dish` });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "daily_budget");
  assert.equal(modelCalls, calls);

  const ex = await post("extract", { text: uniqueText() }, await makeUser());
  assert.equal(ex.status, 503);
  assert.equal(modelCalls, calls);
});

test("the brake reads every instance's rows: a row written elsewhere refuses here", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const me = await makeUser();
  setLimits({ account: "1" });
  // Nothing in this process has seen this account; the row is all there is.
  await getDb().execute(sql`insert into extraction_events (source, cached, via, host, ok, user_id, est_cost_usd)
    values ('url', false, 'self', ${HOST}, true, ${me}, 0.01)`);
  const res = await post("extract", { text: uniqueText() }, me);
  assert.equal(res.status, 429);
});
