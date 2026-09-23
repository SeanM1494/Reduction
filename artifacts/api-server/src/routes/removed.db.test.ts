/**
 * server/routes/removed.db.test.ts — taking a recipe out of the recipe box,
 * against a real Postgres.
 *
 * What is under test: removal is a versioned PATCH like any other write; the
 * server stamps the time and keeps the first one; the library list leaves
 * removed rows out and GET /removed lists them; restoring puts one back with
 * its rating; an edit to a removed row from a device that had not heard of
 * the removal lands and does not restore it; delete-forever still works on a
 * removed row; a removed recipe's timer stops, queued notification included;
 * nobody else can see or touch it; and the free allowance is never refunded
 * by any of it — `recipes_used` is monotonic (CLAUDE.md, "The paywall").
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  accountAccess,
  recipes,
  timerNotifications,
  users,
} from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { checkSchema } from "../lib/schemaCheck";
import { libraryRouter } from "./library";

const TABLES = ["users", "recipes", "account_access", "timer_notifications"];

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
  app.use("/api/library", libraryRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const minted = new Set<string>();
async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Removed Test" });
  minted.add(id);
  return id;
}

after(async () => {
  // Only when something was made: with no DATABASE_URL every test skips and
  // getDb() would throw here, turning a clean skip into a failed hook.
  if (minted.size) {
    const db = getDb();
    for (const id of minted) {
      await db
        .delete(timerNotifications)
        .where(eq(timerNotifications.userId, id));
      await db.delete(recipes).where(eq(recipes.userId, id));
      await db.delete(accountAccess).where(eq(accountAccess.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  server?.close();
});

async function api(
  method: string,
  path: string,
  userId: string,
  body?: unknown,
) {
  const res = await fetch(`${await listen()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
      "X-Owner-Key": `owner-${userId}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as any,
  };
}

const RECIPE = {
  title: "Toast",
  servings: 1,
  sections: [
    {
      name: "Toast",
      ingredients: [{ id: "a", qty: 1, unit: null, name: "bread" }],
      nodes: [{ id: "n1", label: "toast it", inputs: ["a"], minutes: 5 }],
      root: "n1",
    },
  ],
};

async function saveRecipe(userId: string) {
  const id = `r-${crypto.randomUUID()}`;
  const r = await api("POST", "/api/library", userId, {
    id,
    recipe: RECIPE,
    done: [],
    servings: null,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id, version: r.body.entry.version as number };
}

const listIds = async (u: string, path = "/api/library") =>
  ((await api("GET", path, u)).body.entries as Array<{ id: string }>).map(
    (e) => e.id,
  );

const used = async (u: string) =>
  (
    await getDb()
      .select({ n: accountAccess.recipesUsed })
      .from(accountAccess)
      .where(eq(accountAccess.userId, u))
  )[0]?.n ?? 0;

// --------------------------------------------------------------- schema ---

test("schema: the database under test has every hand-run column and table the code needs", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const report = await checkSchema();
  assert.deepEqual(
    report,
    { ok: true, missing: [] },
    "test:db re-pushes the schema, so anything missing here is a real gap",
  );
  // And the report names what is absent, with where its DDL lives.
  const absent = await checkSchema([
    { table: "recipes", column: "no_such_column", readme: "README x" },
    { table: "no_such_table", readme: "README y" },
  ]);
  assert.equal(absent.ok, false);
  assert.deepEqual(absent.missing, [
    "recipes.no_such_column (README x)",
    "no_such_table (README y)",
  ]);
});

// -------------------------------------------------------------- removal ---

test("removal: a versioned PATCH, stamped by the server, out of the list and into /removed — not deleted", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const keep = await saveRecipe(u);
  const out = await saveRecipe(u);

  const before = Date.now();
  const r = await api("PATCH", `/api/library/${out.id}`, u, {
    removedAt: 1234,
    rating: -1,
    ifVersion: out.version,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(
    r.body.entry.removedAt,
    1234,
    "the client's number is intent, not the stored time",
  );
  assert.ok(
    r.body.entry.removedAt >= before - 1000 &&
      r.body.entry.removedAt <= Date.now() + 1000,
    "server-stamped, now",
  );
  assert.equal(r.body.entry.rating, -1);
  assert.equal(
    r.body.entry.version,
    out.version + 1,
    "it is an ordinary versioned write",
  );

  assert.deepEqual(await listIds(u), [keep.id], "the library leaves it out");
  const removed = (await api("GET", "/api/library/removed", u)).body.entries;
  assert.deepEqual(
    removed.map((e: any) => e.id),
    [out.id],
  );
  assert.equal(removed[0].removedAt, r.body.entry.removedAt);
  assert.equal(removed[0].rating, -1, "its rating travels with it");
  assert.ok(
    "photo" in removed[0],
    "same wire shape as the list, thumbnail meta included",
  );
  const row = await getDb()
    .select()
    .from(recipes)
    .where(eq(recipes.id, out.id));
  assert.equal(row.length, 1, "removed is not deleted");
});

test("removal: repeating it keeps the FIRST stamp (two devices, or a retried write)", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  const first = await api("PATCH", `/api/library/${id}`, u, { removedAt: 1 });
  await new Promise((r) => setTimeout(r, 20));
  const again = await api("PATCH", `/api/library/${id}`, u, { removedAt: 2 });
  assert.equal(again.status, 200);
  assert.equal(again.body.entry.removedAt, first.body.entry.removedAt);
});

test("restore: back in the box, out of /removed, and it keeps its thumbs-down", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  await api("PATCH", `/api/library/${id}`, u, { removedAt: 1, rating: -1 });
  const r = await api("PATCH", `/api/library/${id}`, u, { removedAt: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.removedAt, null);
  assert.equal(
    r.body.entry.rating,
    -1,
    "restored recipes go back to the back of their book, still rated",
  );
  assert.deepEqual(await listIds(u), [id]);
  assert.deepEqual(await listIds(u, "/api/library/removed"), []);
});

test("an edit to a removed row from a device that had not heard: it lands, and it does not restore anything", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  await api("PATCH", `/api/library/${id}`, u, { removedAt: 1 });
  // The other device's write says nothing about removedAt — an older build,
  // or one that simply had not refreshed.
  const r = await api("PATCH", `/api/library/${id}`, u, {
    rating: 1,
    done: ["a"],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.rating, 1);
  assert.notEqual(r.body.entry.removedAt, null, "still removed");
  assert.deepEqual(await listIds(u), []);
});

test("a stale removal 409s with the current row, like any other write", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id, version } = await saveRecipe(u);
  await api("PATCH", `/api/library/${id}`, u, { rating: 1 });
  const r = await api("PATCH", `/api/library/${id}`, u, {
    removedAt: 1,
    ifVersion: version,
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "version_conflict");
  assert.equal(
    r.body.entry.removedAt,
    null,
    "the conflict carries the field, so the client can merge it",
  );
  assert.deepEqual(await listIds(u), [id], "and nothing was removed");
});

test("delete forever still works on a removed recipe", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  await api("PATCH", `/api/library/${id}`, u, { removedAt: 1 });
  const r = await api("DELETE", `/api/library/${id}`, u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await listIds(u, "/api/library/removed"), []);
  assert.equal(
    (await getDb().select().from(recipes).where(eq(recipes.id, id))).length,
    0,
  );
});

test("a removed recipe's timer stops — the row's and the queued notification", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  const endsAt = Date.now() + 10 * 60_000;
  const timed = await api("PATCH", `/api/library/${id}`, u, {
    timer: { stepId: "n1", endsAt },
  });
  assert.equal(timed.status, 200, JSON.stringify(timed.body));
  const queued = () =>
    getDb()
      .select()
      .from(timerNotifications)
      .where(eq(timerNotifications.recipeId, id));
  assert.equal(
    (await queued()).length,
    1,
    "a notification is queued for the running timer",
  );
  // The removal says nothing about the timer: the server stops it anyway.
  const r = await api("PATCH", `/api/library/${id}`, u, { removedAt: 1 });
  assert.equal(
    r.body.entry.timer,
    null,
    "a removed recipe must never buzz a phone",
  );
  assert.equal(
    (await queued()).length,
    0,
    "and its queued notification is cancelled",
  );
});

test("another account can neither see nor touch it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const owner = await makeUser();
  const other = await makeUser();
  const { id } = await saveRecipe(owner);
  assert.equal(
    (await api("PATCH", `/api/library/${id}`, other, { removedAt: 1 })).status,
    404,
  );
  await api("PATCH", `/api/library/${id}`, owner, { removedAt: 1 });
  assert.deepEqual(await listIds(other, "/api/library/removed"), []);
  assert.equal(
    (await api("PATCH", `/api/library/${id}`, other, { removedAt: null }))
      .status,
    404,
    "nor restore it",
  );
});

test("removedAt must be a timestamp or null", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  // No NaN here: JSON has no NaN, so JSON.stringify sends it as null — a
  // perfectly valid restore, not a bad value.
  for (const bad of ["yes", true, -5, 0, {}, [1]]) {
    const r = await api("PATCH", `/api/library/${id}`, u, { removedAt: bad });
    assert.equal(r.status, 400, `rejected: ${JSON.stringify(bad)}`);
  }
});

// ------------------------------------------------------------ allowance ---

test("removing, restoring and deleting forever never refund the free recipe", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  const spent = await used(u);
  assert.equal(spent, 1, "the save counted");
  await api("PATCH", `/api/library/${id}`, u, { removedAt: 1 });
  assert.equal(await used(u), spent, "removal refunds nothing");
  await api("PATCH", `/api/library/${id}`, u, { removedAt: null });
  assert.equal(await used(u), spent, "restoring does not spend again");
  await api("PATCH", `/api/library/${id}`, u, { removedAt: 1 });
  await api("DELETE", `/api/library/${id}`, u);
  assert.equal(await used(u), spent, "delete forever refunds nothing either");
});
