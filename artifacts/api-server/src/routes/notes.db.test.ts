/**
 * server/routes/notes.db.test.ts — the person's own notes on a recipe,
 * against a real Postgres.
 *
 * What is under test: a note is a versioned PATCH like a rating; it comes
 * back on the list; clearing it is null; anything but `{ text }` within the
 * stored cap is refused with nothing written; an unrelated write (a rating,
 * a new tree) leaves it alone; a stale write is a 409 carrying the current
 * note, which is what the client's merge keeps; it goes with the recipe;
 * and nobody else can read or write it.
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
import { NOTE_STORED_MAX } from "../shared/notes";
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

const notesOf = async (u: string, id: string) =>
  ((await api("GET", "/api/library", u)).body.entries as Array<{ id: string; notes: unknown }>).find((e) => e.id === id)
    ?.notes;

test("notes: a versioned write, on the list, cleared with null", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const r = await saveRecipe(u);
  assert.equal(await notesOf(u, r.id), null, "a new recipe has no note");

  const text = "Use 1 tsp salt, not 2.\n\nDouble the garlic.";
  const w = await api("PATCH", `/api/library/${r.id}`, u, { notes: { text }, ifVersion: r.version });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.deepEqual(w.body.entry.notes, { text });
  assert.equal(w.body.entry.version, r.version + 1, "an ordinary versioned write");
  assert.deepEqual(await notesOf(u, r.id), { text }, "newlines and all");

  const c = await api("PATCH", `/api/library/${r.id}`, u, { notes: null, ifVersion: r.version + 1 });
  assert.equal(c.status, 200);
  assert.equal(await notesOf(u, r.id), null);
});

test("notes: anything but {text} within the cap is refused, and nothing is written", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const r = await saveRecipe(u);
  for (const bad of [
    "a bare string",
    { text: "" },
    { text: "   " },
    { text: 42 },
    { text: "ok", steps: {} },
    { text: "x".repeat(NOTE_STORED_MAX + 1) },
    [],
  ]) {
    const w = await api("PATCH", `/api/library/${r.id}`, u, { notes: bad, rating: 1 });
    assert.equal(w.status, 400, JSON.stringify(bad).slice(0, 40));
  }
  const [row] = await getDb().select().from(recipes).where(eq(recipes.id, r.id));
  assert.equal(row.notes, null);
  assert.equal(row.rating, null, "the refused write's other fields did not land either");
  assert.equal(row.version, r.version);
  // The cap itself is fine.
  const max = await api("PATCH", `/api/library/${r.id}`, u, { notes: { text: "y".repeat(NOTE_STORED_MAX) } });
  assert.equal(max.status, 200);
});

test("notes: other writes leave the note alone; a stale write gets a 409 with the current note", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const r = await saveRecipe(u);
  const text = "Thighs, not breasts.";
  await api("PATCH", `/api/library/${r.id}`, u, { notes: { text }, ifVersion: r.version });

  // A rating, and a new tree from the editor, from the same device.
  await api("PATCH", `/api/library/${r.id}`, u, { rating: 1 });
  const tree = { ...RECIPE, title: "Better toast" };
  const e = await api("PATCH", `/api/library/${r.id}`, u, { recipe: tree });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual(e.body.entry.notes, { text });

  // A second device still at the first version.
  const stale = await api("PATCH", `/api/library/${r.id}`, u, { notes: { text: "Mine" }, ifVersion: r.version });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.entry.notes, { text }, "the current note, for the client's merge");
  assert.deepEqual(await notesOf(u, r.id), { text }, "and nothing was written");
});

test("notes: nobody else can read or write them, and they go with the recipe", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const other = await makeUser();
  const r = await saveRecipe(u);
  await api("PATCH", `/api/library/${r.id}`, u, { notes: { text: "Mine alone" } });

  const w = await api("PATCH", `/api/library/${r.id}`, other, { notes: { text: "Not yours" } });
  assert.equal(w.status, 404);
  const theirs = (await api("GET", "/api/library", other)).body.entries as Array<{ id: string }>;
  assert.equal(theirs.some((e) => e.id === r.id), false);
  assert.deepEqual(await notesOf(u, r.id), { text: "Mine alone" });

  const d = await api("DELETE", `/api/library/${r.id}`, u);
  assert.equal(d.status, 200);
  const rows = await getDb().select().from(recipes).where(eq(recipes.id, r.id));
  assert.equal(rows.length, 0, "the note was a column of the row, so it went with it");
});
