/**
 * The cached half of a search and the counts, against a real database.
 *
 * Every row this suite writes carries a nonsense word no real title has
 * ("Zorbquix"), under a host of its own, so a match can only be one of ours
 * and cleanup is exact.
 */
import test, { after } from "node:test";
import express from "express";
import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, extractionCache, recipes, users } from "@workspace/db";
import { needsDatabase } from "./testdb";
import { urlKeyOf } from "./urlKey";
import { SUGGESTION_LIMIT, libraryMatches, usageFor } from "./searchLibrary";
import { recipesRouter } from "../routes/recipes";

const TABLES = ["extraction_cache", "recipes", "users", "account_access"];
const HOST = "https://zorbquix-test.invalid";
const WORD = "Zorbquix";

const tree = (title: string, sourceUrl?: string) => ({
  title,
  servings: 2,
  ...(sourceUrl ? { sourceUrl } : {}),
  sections: [
    {
      name: title,
      ingredients: [{ id: "a", qty: 1, unit: null, name: "thing" }],
      nodes: [{ id: "n1", label: "do it", inputs: ["a"] }],
      root: "n1",
    },
  ],
});

async function cacheRow(key: string, title: string, sourceUrl?: string, createdAt = new Date()) {
  await getDb()
    .insert(extractionCache)
    .values({ hash: crypto.createHash("sha256").update(`test:${key}:${crypto.randomUUID()}`).digest("hex"), urlKey: sourceUrl ? urlKeyOf(sourceUrl) : null, recipe: tree(title, sourceUrl) as never, createdAt });
}

const people = new Set<string>();
async function person(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Search Test" });
  people.add(id);
  return id;
}
async function save(userId: string | null, sourceUrl: string, extra: { cooked?: number[]; rating?: number | null; removedAt?: Date } = {}) {
  await getDb().insert(recipes).values({
    id: crypto.randomUUID(),
    ownerKey: userId ? `owner-${userId}` : `trial-${crypto.randomUUID()}`,
    userId,
    recipe: tree(`${WORD} saved`, sourceUrl) as never,
    cooked: extra.cooked ?? [],
    rating: extra.rating ?? null,
    removedAt: extra.removedAt ?? null,
  });
}

after(async () => {
  server?.close();
  if (!people.size && !touched) return;
  const db = getDb();
  if (people.size) await db.delete(accountAccess).where(inArray(accountAccess.userId, [...people]));
  await db.delete(recipes).where(like(recipes.ownerKey, "trial-%")).catch(() => {});
  for (const id of people) {
    await db.delete(recipes).where(eq(recipes.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  if (people.size) await db.delete(users).where(inArray(users.id, [...people]));
  await wipeCache();
});
let touched = false;
async function wipeCache() {
  const db = getDb();
  const rows = await db.select({ hash: extractionCache.hash, recipe: extractionCache.recipe }).from(extractionCache);
  const ours = rows.filter((r) => (r.recipe as { title?: string }).title?.includes(WORD)).map((r) => r.hash);
  if (ours.length) await db.delete(extractionCache).where(inArray(extractionCache.hash, ours));
}

test("ours matches on the title, best match first, and only pages read from a URL", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  touched = true;
  await wipeCache();
  await cacheRow("a", `${WORD} Brownies`, `${HOST}/brownies`);
  await cacheRow("b", `Best ${WORD} Fudgy Brownies`, `${HOST}/best-brownies`);
  await cacheRow("c", `${WORD} Lemon Loaf`, `${HOST}/lemon-loaf`);
  // A pasted recipe is cached under a text hash and has no sourceUrl: it is
  // somebody's own, and must never surface for anyone else.
  await cacheRow("d", `${WORD} Brownies from my notebook`);

  const out = await libraryMatches(`${WORD} brownie`);
  assert.deepEqual(out.map((r) => r.url).sort(), [`${HOST}/best-brownies`, `${HOST}/brownies`], "stemmed: brownie finds Brownies");
  assert.ok(out.every((r) => r.cached === true));
  assert.equal(out[0].site, "zorbquix-test.invalid", "no site name stored -> the host");
  assert.equal((await libraryMatches(`${WORD} lemon`)).length, 1);
  assert.equal((await libraryMatches(`${WORD} pancakes`)).length, 0, "every word is required");
  await wipeCache();
});

test("a private-looking link never surfaces, and a page cached twice is offered once", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  touched = true;
  await wipeCache();
  await cacheRow("p1", `${WORD} Pie`, "https://docs.google.com/document/d/zorbquix/edit");
  await cacheRow("p2", `${WORD} Pie`, `${HOST}/pie?token=secret`);
  await cacheRow("p3", `${WORD} Pie`, `${HOST}/pie`, new Date(Date.now() - 60_000));
  await cacheRow("p4", `${WORD} Pie`, `${HOST}/pie/`);
  const out = await libraryMatches(`${WORD} pie`, 3);
  assert.equal(out.length, 1, "one page, however many rows and spellings");
  assert.ok(!out[0].url.includes("docs.google.com") && !out[0].url.includes("token"));
  await wipeCache();
});

test("usage counts accounts, cooks and loves across the box, and only the box", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const page = `${HOST}/stats-${crypto.randomUUID()}`;
  const [a, b, c, d] = [await person(), await person(), await person(), await person()];
  await save(a, page, { cooked: [1, 2, 3], rating: 1 });
  await save(b, page, { cooked: [4], rating: 1 });
  await save(c, `${page}?utm_source=newsletter`, { cooked: [5], rating: -1 }); // a variant spelling
  await save(d, page, { cooked: [6, 7], rating: 1, removedAt: new Date() }); // taken out of the box
  await save(null, page, { cooked: [8] }); // a trial parked under a cookie

  const stats = (await usageFor([page])).get(page);
  assert.deepEqual(stats, { saves: 3, cooks: 5, loved: 2, rated: 3 });
  assert.equal((await usageFor([`${HOST}/nobody-saved-this`])).size, 0);
});

// ------------------------------------------- POST /api/recipes/suggestions --
// The phone's My Recipes tab, when nothing in the person's own box matches.

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
  app.use("/api/recipes", recipesRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}
async function suggest(userId: string | null, query: unknown) {
  const res = await fetch(`${await listen()}/api/recipes/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userId ? { "x-test-user": userId } : {}) },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

test("suggestions: at most two, only public pages read from a URL, with the usage line above its floors", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  touched = true;
  await wipeCache();
  const pages = [1, 2, 3].map((i) => `${HOST}/gravy-${i}-${crypto.randomUUID()}`);
  for (const [i, url] of pages.entries()) await cacheRow(`g${i}`, `${WORD} Sunday Gravy ${i}`, url);
  // What must never surface, however well it matches: a pasted recipe or a
  // photo (no sourceUrl), a page the phone's browser handed over (cached by
  // its content, also without one — routes/recipes.ts), and a private link.
  await cacheRow("paste", `${WORD} Sunday Gravy from my notebook`);
  await cacheRow("browser", `${WORD} Sunday Gravy read in the app's browser`);
  await cacheRow("doc", `${WORD} Sunday Gravy`, "https://docs.google.com/document/d/zorbquix-gravy/edit");
  await cacheRow("token", `${WORD} Sunday Gravy`, `${HOST}/gravy?share=secret`);
  // Every one of the three kept by three accounts, and cooked once each:
  // saves clear their floor (3), cooks do not (5 needed).
  for (const url of pages) for (let k = 0; k < 3; k++) await save(await person(), url, { cooked: [k] });

  const me = await person();
  const { status, body } = await suggest(me, `${WORD} gravy`);
  assert.equal(status, 200);
  assert.equal(body.results.length, SUGGESTION_LIMIT, "capped at two");
  for (const r of body.results) {
    assert.ok(pages.includes(r.url), `only the public URL pages: ${r.url}`);
    assert.equal(r.proof, "Saved by 3 people", "the usage line, above its floor only");
    assert.equal(r.site, "zorbquix-test.invalid");
    assert.match(r.title, /Sunday Gravy \d$/);
  }

  // Below the floor, nothing is said.
  const lone = `${HOST}/lone-${crypto.randomUUID()}`;
  await cacheRow("lone", `${WORD} Lonely Pie`, lone);
  await save(await person(), lone, { cooked: [1] });
  const pie = await suggest(me, `${WORD} lonely pie`);
  assert.deepEqual(pie.body.results.map((r: any) => [r.url, r.proof]), [[lone, null]]);
  await wipeCache();
});

test("suggestions: signed in only, never walled, and a malformed query is refused", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  touched = true;
  assert.equal((await suggest(null, `${WORD} gravy`)).status, 401);
  // An account whose free recipe is spent, with the wall forced ON for it:
  // a lookup costs nothing, so it still answers.
  const walled = await person();
  await getDb().insert(accountAccess).values({ userId: walled, recipeAllowance: 1, recipesUsed: 1, enforceOverride: true });
  const ok = await suggest(walled, `${WORD} nothing matches this`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.results, []);
  assert.equal((await suggest(walled, "ab")).status, 400);
  assert.equal((await suggest(walled, "x".repeat(201))).status, 400);
  assert.equal((await suggest(walled, 42)).status, 400);
});
