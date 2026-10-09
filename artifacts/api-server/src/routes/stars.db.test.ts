/**
 * server/routes/stars.db.test.ts — the five-star rating, against a real
 * Postgres.
 *
 * What is under test: `stars` is a versioned PATCH that comes back on the
 * list; the legacy `rating` is DERIVED from it on every stars write (so the
 * reel's and search's "loved" counts, and any app build that predates stars,
 * keep seeing a coherent answer); a `rating` written alone (an old build)
 * clears `stars` rather than leaving two opinions; clearing is null for both;
 * anything but a whole number from 1 to 5 is refused with nothing written;
 * a row rated before stars has null stars and its rating untouched; and
 * nobody else can write it.
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
import { NOTE_STORED_MAX, STEP_NOTE_STORED_MAX } from "../shared/notes";
import { needsDatabase } from "../lib/testdb";
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
  await getDb().insert(users).values({ id, displayName: "Notes Test" });
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
      nodes: [
        { id: "n1", label: "toast it", inputs: ["a"], minutes: 5 },
        { id: "n2", label: "butter it", inputs: ["n1"] },
      ],
      root: "n2",
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


const rowOf = async (id: string) => (await getDb().select().from(recipes).where(eq(recipes.id, id)))[0];

test("stars: a versioned write that derives the old rating, on the list, cleared with null", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const r = await saveRecipe(u);
  let v = r.version;
  const expected: Array<[number, number]> = [[5, 1], [4, 1], [3, 0], [2, -1], [1, -1]];
  for (const [stars, rating] of expected) {
    const w = await api("PATCH", `/api/library/${r.id}`, u, { stars, ifVersion: v });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.entry.stars, stars);
    assert.equal(w.body.entry.rating, rating, `${stars}★ is rating ${rating}`);
    assert.equal(w.body.entry.version, v + 1, "an ordinary versioned write");
    v += 1;
  }
  const list = (await api("GET", "/api/library", u)).body.entries as Array<{ id: string; stars: number | null }>;
  assert.equal(list.find((e) => e.id === r.id)?.stars, 1);

  const c = await api("PATCH", `/api/library/${r.id}`, u, { stars: null, ifVersion: v });
  assert.equal(c.status, 200);
  assert.equal(c.body.entry.stars, null);
  assert.equal(c.body.entry.rating, null, "clearing the stars clears the derived rating with them");
});

test("stars: a rating written alone (an app build that predates stars) clears the stars", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const r = await saveRecipe(u);
  await api("PATCH", `/api/library/${r.id}`, u, { stars: 5 });
  const old = await api("PATCH", `/api/library/${r.id}`, u, { rating: -1 });
  assert.equal(old.status, 200);
  assert.equal(old.body.entry.rating, -1);
  assert.equal(old.body.entry.stars, null, "the newer thumbs-down replaced the five stars");
  // Both in one body (a new build): stars decide.
  const both = await api("PATCH", `/api/library/${r.id}`, u, { stars: 4, rating: -1 });
  assert.equal(both.body.entry.stars, 4);
  assert.equal(both.body.entry.rating, 1);
  // An unrelated write touches neither.
  const other = await api("PATCH", `/api/library/${r.id}`, u, { mode: "steps" });
  assert.equal(other.body.entry.stars, 4);
  assert.equal(other.body.entry.rating, 1);
});

test("stars: only a whole number from 1 to 5, or null, and a refusal writes nothing", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const r = await saveRecipe(u);
  for (const bad of [0, 6, -1, 2.5, "4", true, [], {}]) {
    const w = await api("PATCH", `/api/library/${r.id}`, u, { stars: bad, mode: "steps" });
    assert.equal(w.status, 400, JSON.stringify(bad));
  }
  const row = await rowOf(r.id);
  assert.equal(row.stars, null);
  assert.equal(row.mode, "diagram", "the refused write's other fields did not land either");
  assert.equal(row.version, r.version);
});

test("stars: a row rated before stars keeps its rating and has no stars; nobody else can write it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const other = await makeUser();
  const r = await saveRecipe(u);
  await getDb().update(recipes).set({ rating: 1 }).where(eq(recipes.id, r.id));
  const list = (await api("GET", "/api/library", u)).body.entries as Array<{ id: string; rating: number | null; stars: number | null }>;
  const mine = list.find((e) => e.id === r.id)!;
  assert.equal(mine.rating, 1);
  assert.equal(mine.stars, null, "nothing is backfilled; the client shows 5★ from the rating");
  const theirs = await api("PATCH", `/api/library/${r.id}`, other, { stars: 1 });
  assert.equal(theirs.status, 404);
  assert.equal((await rowOf(r.id)).stars, null);
});
