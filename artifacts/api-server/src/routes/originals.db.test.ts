/**
 * server/routes/originals.db.test.ts — a recipe's original wording, against a
 * real Postgres, with no model call and no recipe site: the extraction is
 * served from the cache, and a page read is stubbed at library.ts's seam.
 *
 * What is under test: an extraction hands back the wording stored beside
 * its cached tree and the key that names it; a save naming that key copies
 * the wording under the recipe, and a key naming nothing costs the save
 * nothing; the read route is private; a recipe saved without a key is
 * filled in ONCE on its first open — from the cache's wording for its URL,
 * else from the page's JSON-LD — and "none" is remembered while "the page
 * could not be reached" is not; and no wording outlives its recipe or its
 * account, which is a promise made in code, not by a foreign key.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  accountAccess,
  extractionCache,
  extractionOriginals,
  recipeOriginals,
  recipes,
  users,
} from "@workspace/db";
import type { OriginalRecipe } from "@workspace/recipe-model";
import { needsDatabase } from "../lib/testdb";
import { cacheSetUrl, recipesRouter } from "./recipes";
import { libraryRouter, setPageOriginalFetcherForTests } from "./library";
import { accountRouter } from "./account";
import { rawKeyOf } from "../lib/urlKey";
import { saveExtractionOriginal } from "../lib/original";

const TABLES = ["users", "recipes", "account_access", "extraction_cache", "extraction_originals", "recipe_originals"];
const HOST = "https://originals-test.invalid";

let server: Server | null = null;
let base = "";
async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    req.session = u ? { userId: u } : null;
    next();
  });
  app.use("/api/recipes", recipesRouter);
  app.use("/api/library", libraryRouter);
  app.use("/api/account", accountRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const minted = new Set<string>();
const cachedUrls = new Set<string>();
async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Original Test" });
  minted.add(id);
  return id;
}

after(async () => {
  setPageOriginalFetcherForTests(null);
  server?.close();
  // Nothing was written unless a test ran against a database; touching one
  // here would turn the no-database skip into a failure.
  if (!minted.size && !cachedUrls.size) return;
  const db = getDb();
  for (const id of minted) {
    const rows = await db.select({ ownerKey: recipes.ownerKey, id: recipes.id }).from(recipes).where(eq(recipes.userId, id));
    if (rows.length) await db.delete(recipeOriginals).where(inArray(recipeOriginals.id, rows.map((r) => r.id)));
    await db.delete(recipes).where(eq(recipes.userId, id));
    await db.delete(accountAccess).where(eq(accountAccess.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  const keys = [...cachedUrls].map(rawKeyOf);
  if (keys.length) {
    await db.delete(extractionCache).where(inArray(extractionCache.hash, keys));
    await db.delete(extractionOriginals).where(inArray(extractionOriginals.hash, keys));
  }
});

async function api(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${await listen()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": userId, "X-Owner-Key": `owner-${userId}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const recipeAt = (sourceUrl: string | null) => ({
  title: "Lemon Loaf",
  servings: 8,
  ...(sourceUrl ? { sourceUrl, source: "originals-test.invalid" } : {}),
  sections: [
    {
      name: "Loaf",
      ingredients: [{ id: "a", qty: 2, unit: "cup", name: "flour" }],
      nodes: [{ id: "n1", label: "bake 350°F 50 min", inputs: ["a"] }],
      root: "n1",
    },
  ],
});

const WORDING: OriginalRecipe = {
  ingredients: [{ text: "2 cups all-purpose flour" }],
  steps: [{ text: "Bake at 350°F for 50 minutes, until a skewer comes out clean." }],
  truncated: false,
  from: "page",
};

/** A page somebody already extracted: its tree and wording in the cache. */
async function cachedPage(path: string, original: OriginalRecipe | null = WORDING) {
  const url = `${HOST}${path}-${crypto.randomUUID()}`;
  cachedUrls.add(url);
  await cacheSetUrl(url, recipeAt(url) as never);
  await saveExtractionOriginal(rawKeyOf(url), original);
  return url;
}

async function save(userId: string, recipe: unknown, sourceKey?: string) {
  const id = `r-${crypto.randomUUID()}`;
  const r = await api("POST", "/api/library", userId, { id, recipe, done: [], servings: null, sourceKey });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return id;
}

const storedRow = async (id: string) =>
  (await getDb().select().from(recipeOriginals).where(eq(recipeOriginals.id, id)))[0];

test("original: an extraction hands back the wording and its key; a save naming the key keeps it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const url = await cachedPage("/loaf");

  const x = await api("POST", "/api/recipes/extract", u, { url });
  assert.equal(x.status, 200, JSON.stringify(x.body));
  assert.equal(x.body.meta.cached, true);
  assert.deepEqual(x.body.original, WORDING, "the preview can show it before anything is saved");
  assert.equal(x.body.sourceKey, rawKeyOf(url));
  assert.equal(x.body.recipe.original, undefined, "never inside the recipe JSON");

  const id = await save(u, x.body.recipe, x.body.sourceKey);
  const list = await api("GET", "/api/library", u);
  const entry = list.body.entries.find((e: { id: string }) => e.id === id);
  assert.equal(JSON.stringify(entry).includes("skewer"), false, "the library list does not carry it");

  const got = await api("GET", `/api/library/${id}/original`, u);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { original: WORDING, sourceUrl: url, source: "originals-test.invalid" });
});

test("original: a key naming nothing costs the save nothing, and a wrong key never copies", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const id = await save(u, recipeAt(null), "0".repeat(64));
  assert.equal(await storedRow(id), undefined);
  const got = await api("GET", `/api/library/${id}/original`, u);
  assert.deepEqual(got.body, { original: null, sourceUrl: null, source: null }, "a paste saved without its key has none");
});

test("original: nobody else can read it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const owner = await makeUser();
  const other = await makeUser();
  const url = await cachedPage("/private");
  const id = await save(owner, recipeAt(url), rawKeyOf(url));
  assert.equal((await api("GET", `/api/library/${id}/original`, other)).status, 404);
});

test("original: a recipe saved without a key is filled from the cache's wording on first open, once", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const url = await cachedPage("/late");
  let pageReads = 0;
  setPageOriginalFetcherForTests(async () => {
    pageReads++;
    return null;
  });
  const id = await save(u, recipeAt(url)); // an older client: no sourceKey
  assert.equal(await storedRow(id), undefined);

  const got = await api("GET", `/api/library/${id}/original`, u);
  assert.deepEqual(got.body.original, WORDING);
  assert.equal(pageReads, 0, "the cache answered; the page was never read");
  assert.deepEqual((await storedRow(id))?.original, WORDING, "and it is the recipe's own copy now");
});

test("original: with nothing cached, the page's JSON-LD is read once; none is remembered, unreachable is not", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const page = (p: string) => `${HOST}${p}-${crypto.randomUUID()}`;
  let reads = 0;

  // A structured-data page: read once, kept.
  setPageOriginalFetcherForTests(async () => {
    reads++;
    return WORDING;
  });
  const withCard = await save(u, recipeAt(page("/card")));
  assert.deepEqual((await api("GET", `/api/library/${withCard}/original`, u)).body.original, WORDING);
  assert.deepEqual((await api("GET", `/api/library/${withCard}/original`, u)).body.original, WORDING);
  assert.equal(reads, 1);

  // A page without one: "none" is remembered, so the phone does not fetch
  // the site on every open.
  reads = 0;
  setPageOriginalFetcherForTests(async () => {
    reads++;
    return null;
  });
  const noCard = await save(u, recipeAt(page("/prose")));
  assert.equal((await api("GET", `/api/library/${noCard}/original`, u)).body.original, null);
  assert.equal((await api("GET", `/api/library/${noCard}/original`, u)).body.original, null);
  assert.equal(reads, 1);
  assert.ok(await storedRow(noCard), "remembered as none");

  // A page that could not be reached is asked again next time.
  setPageOriginalFetcherForTests(async () => {
    throw new Error("That site refused the request.");
  });
  const down = await save(u, recipeAt(page("/down")));
  assert.equal((await api("GET", `/api/library/${down}/original`, u)).body.original, null);
  assert.equal(await storedRow(down), undefined, "not remembered");
  setPageOriginalFetcherForTests(async () => WORDING);
  assert.deepEqual((await api("GET", `/api/library/${down}/original`, u)).body.original, WORDING);
});

test("original: no wording outlives its recipe, or its account", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const url = await cachedPage("/gone");
  const a = await save(u, recipeAt(url), rawKeyOf(url));
  const b = await save(u, recipeAt(url), rawKeyOf(url));
  assert.ok(await storedRow(a));
  assert.ok(await storedRow(b));

  assert.equal((await api("DELETE", `/api/library/${a}`, u)).status, 200);
  assert.equal(await storedRow(a), undefined, "deleted with the recipe");

  const del = await api("DELETE", "/api/account", u);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(await storedRow(b), undefined, "deleted with the account");
  assert.ok(
    (await getDb().select().from(extractionOriginals).where(eq(extractionOriginals.hash, rawKeyOf(url)))).length,
    "the cache's copy is the page's, not the account's, and stays"
  );
});
