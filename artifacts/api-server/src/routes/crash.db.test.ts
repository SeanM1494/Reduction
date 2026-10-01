/**
 * routes/crash.db.test.ts — crash reports (Oct 1).
 *
 * What must hold: the table has no column that could name anyone, and the
 * route records none even for a signed-in caller; what is stored is the
 * scrubbed report, never the raw body; a body that is not a report is
 * refused; one client is braked; the daily cap holds in the insert itself;
 * and the admin read groups repeats and needs the secret.
 *
 * Every row this suite writes carries a route under ROUTE, and only those
 * rows are read or deleted.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { needsDatabase } from "../lib/testdb";
import { recordCrash, resetCrashStateForTests } from "../lib/crashReports";
import { sanitizeCrashReport } from "@workspace/recipe-model/crashReport";
import { crashRouter, resetCrashBrake, CRASH_PER_HOUR } from "./crash";
import { adminRouter, resetAdminThrottle } from "./admin";

const SECRET = "test-admin-secret-crash-0123456789";
// Letters only: the route scrub replaces digit runs and hex ids, so a uuid
// slice would not survive it.
const ROUTE = `/crashtest-${Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("")}`;
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
  app.use("/api/crash", crashRouter);
  app.use("/api/admin", adminRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

after(async () => {
  server?.close();
  try {
    await getDb().execute(sql`delete from crash_reports where route like ${ROUTE + "%"}`);
  } catch {
    /* no database: nothing was written */
  }
});

const settle = () => new Promise((r) => setTimeout(r, 200));

const report = (over: Record<string, unknown> = {}) => ({
  kind: "fatal",
  platform: "ios",
  name: "TypeError",
  message: "undefined is not an object (evaluating 'recipe.title')",
  stack: ["at RecipeScreen (/var/containers/Bundle/Application/3F2A1B4C-1D2E-4F50-8A9B-0C1D2E3F4A5B/R.app/main.jsbundle:1:42)"],
  route: `${ROUTE}/recipe/[id]`,
  appVersion: "1.1.0",
  runtime: "1.1.0",
  updateId: "3f2a1b4c-1d2e-4f50-8a9b-0c1d2e3f4a5b",
  channel: "production",
  osVersion: "26.0",
  ...over,
});

const post = async (body: unknown, user: string | null = null) =>
  (
    await fetch(`${await listen()}/api/crash`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: JSON.stringify(body),
    })
  ).status;

async function rows(): Promise<Array<Record<string, unknown>>> {
  return ((await getDb().execute(sql`select * from crash_reports where route like ${ROUTE + "%"} order by at`)) as unknown as {
    rows: Array<Record<string, unknown>>;
  }).rows;
}

test("crash: the table has no column that could name anyone", async (t) => {
  if (!(await needsDatabase(t, "crash_reports"))) return;
  const cols = ((await getDb().execute(sql`
    select column_name from information_schema.columns where table_name = 'crash_reports' order by column_name`)) as unknown as {
    rows: Array<{ column_name: string }>;
  }).rows.map((r) => r.column_name);
  assert.deepEqual(cols, [
    "app_version", "at", "channel", "fingerprint", "id", "kind", "message", "name", "os_version", "platform", "route", "runtime", "stack", "update_id",
  ]);
});

test("crash: a report is stored scrubbed, signed in or not, and the account is nowhere in it", async (t) => {
  if (!(await needsDatabase(t, "crash_reports"))) return;
  resetCrashBrake();
  resetCrashStateForTests();
  const user = `crash-user-${randomUUID()}`;
  assert.equal(await post(report({ message: "could not load https://example.com/r for sean@example.com", userId: user }), user), 204);
  assert.equal(await post(report({ kind: "render", platform: "web" })), 204);
  await settle();
  const got = await rows();
  assert.equal(got.length, 2);
  assert.equal(got[0]!.message, "could not load <url> for <email>");
  assert.equal(got[0]!.stack, "RecipeScreen (main.jsbundle:1:42)");
  assert.equal(got[1]!.kind, "render");
  assert.equal(JSON.stringify(got).includes(user), false);
  assert.equal(JSON.stringify(got).includes("3F2A1B4C"), false);
});

test("crash: a body that is not a report is refused", async (t) => {
  if (!(await needsDatabase(t, "crash_reports"))) return;
  resetCrashBrake();
  assert.equal(await post({ hello: "world" }), 400);
  assert.equal(await post(report({ kind: "explosion" })), 400);
  assert.equal(await post(report({ platform: "windows" })), 400);
});

test("crash: one client is braked after the hourly allowance", async (t) => {
  if (!(await needsDatabase(t, "crash_reports"))) return;
  resetCrashBrake();
  for (let i = 0; i < CRASH_PER_HOUR; i++) assert.equal(await post(report({ route: `${ROUTE}/brake` })), 204);
  assert.equal(await post(report({ route: `${ROUTE}/brake` })), 429);
  resetCrashBrake();
});

test("crash: the daily cap holds in the insert itself", async (t) => {
  if (!(await needsDatabase(t, "crash_reports"))) return;
  const today = Number(
    ((await getDb().execute(sql`select count(*)::int as n from crash_reports where at >= date_trunc('day', now())`)) as unknown as {
      rows: Array<{ n: number }>;
    }).rows[0]!.n
  );
  const r = sanitizeCrashReport(report({ route: `${ROUTE}/cap` }))!;
  assert.equal(await recordCrash(r, today), false);
  assert.equal(await recordCrash(r, today + 1), true);
});

test("crash: the admin read groups repeats, newest report whole, behind the secret", async (t) => {
  if (!(await needsDatabase(t, "crash_reports"))) return;
  const prev = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = SECRET;
  resetAdminThrottle();
  try {
    const stack = [`at Grouped${randomUUID().slice(0, 6)} (main.jsbundle:9:9)`];
    for (const message of ["first", "second", "third"])
      await recordCrash(sanitizeCrashReport(report({ route: `${ROUTE}/group`, stack, message }))!);
    const res = await fetch(`${await listen()}/api/admin/crashes?days=7`, { headers: { "x-admin-secret": SECRET } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { groups: Array<{ count: number; routes: string[]; latest: { message: string; stack: string[] } }> };
    const g = body.groups.find((x) => x.routes.includes(`${ROUTE}/group`));
    assert.ok(g, "the group is listed");
    assert.equal(g.count, 3);
    assert.equal(g.latest.message, "third");
    assert.deepEqual(g.latest.stack, [stack[0]!.replace(/^at /, "")]);
    const wrong = await fetch(`${await listen()}/api/admin/crashes`, { headers: { "x-admin-secret": "nope" } });
    assert.equal(wrong.status, 401);
  } finally {
    resetAdminThrottle();
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
});
