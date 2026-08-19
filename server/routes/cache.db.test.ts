/**
 * server/routes/cache.db.test.ts — the alias lookup, against a real database.
 *
 * urlKey.test.ts proves which URLs normalise together. This proves the cache
 * actually answers to both keys, that a row past its TTL is not a hit, and
 * that a search result is only badged when tapping it really would be free.
 *
 * The badge is the reason this needs a database rather than a fake. It is a
 * promise — "Instant", no extraction — and the thing that would break it is a
 * query detail: a missed TTL filter, or an `or` that matches on a null
 * `url_key` and marks every uncached row. Both are invisible against a stub.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { extractionCache } from "../../shared/schema";
import { needsDatabase } from "../lib/testdb";
import { rawKeyOf, urlKeyOf } from "../lib/urlKey";
import { cacheGetUrl, cacheSetUrl, cachedAmong, withCacheFlags } from "./recipes";
import type { Recipe } from "../../shared/layout";

const TABLES = ["extraction_cache"];

const HOST = "https://cache-test.invalid";
const url = (p: string) => `${HOST}${p}`;

const recipeFor = (title: string, sourceUrl: string): Recipe => ({
  title,
  servings: 2,
  sourceUrl,
  sections: [
    {
      name: title,
      ingredients: [{ id: "a", qty: 1, unit: null, name: "thing" }],
      nodes: [{ id: "n1", label: "do it", inputs: ["a"] }],
      root: "n1",
    },
  ],
});

/** Everything this suite writes lives under one host, so cleanup is exact
 *  and it can never delete a row some other run put there. */
async function wipe(paths: string[]) {
  const db = getDb();
  const keys = paths.flatMap((p) => {
    const u = url(p);
    return [rawKeyOf(u), ...(urlKeyOf(u) ? [] : [])];
  });
  if (keys.length) await db.delete(extractionCache).where(inArray(extractionCache.hash, keys));
  for (const p of paths) {
    const alias = urlKeyOf(url(p));
    if (alias) await db.delete(extractionCache).where(eq(extractionCache.urlKey, alias));
  }
}

test("an exact URL hits, as it always has", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/exact"]);
  const u = url("/exact");
  await cacheSetUrl(u, recipeFor("Exact", u));
  assert.equal((await cacheGetUrl(u))?.title, "Exact");
  await wipe(["/exact"]);
});

test("a variant hits through the alias, and the stored row is untouched", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/alias"]);
  const stored = url("/alias");
  await cacheSetUrl(stored, recipeFor("Alias", stored));

  for (const variant of [
    `${HOST}/alias/`,
    `${HOST}/alias?utm_source=x&fbclid=y`,
    `${HOST}/alias#top`,
    stored.replace("https://", "http://www."),
  ]) {
    assert.equal((await cacheGetUrl(variant))?.title, "Alias", variant);
  }

  // One row, keyed on the raw string it arrived as. The alias is a lookup,
  // not a second identity — that is what makes it revertible.
  const db = getDb();
  const rows = await db
    .select()
    .from(extractionCache)
    .where(eq(extractionCache.urlKey, urlKeyOf(stored)!));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hash, rawKeyOf(stored));
  await wipe(["/alias"]);
});

test("a content-selecting parameter does NOT hit", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/page", "/page?page=2"]);
  const one = url("/page");
  await cacheSetUrl(one, recipeFor("Page one", one));
  // The failure this guards: serving page 1 to somebody who asked for page 2.
  assert.equal(await cacheGetUrl(url("/page?page=2")), null);
  assert.equal(await cacheGetUrl(url("/page?servings=8")), null);
  await wipe(["/page", "/page?page=2"]);
});

test("a row past its TTL is not a hit, and is swept", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/stale"]);
  const u = url("/stale");
  await cacheSetUrl(u, recipeFor("Stale", u));

  const db = getDb();
  const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 40);
  await db
    .update(extractionCache)
    .set({ createdAt: longAgo })
    .where(eq(extractionCache.hash, rawKeyOf(u)));

  assert.equal(await cacheGetUrl(u), null);
  // Also through the alias, which is its own code path and its own TTL check.
  await cacheSetUrl(u, recipeFor("Stale", u));
  await db
    .update(extractionCache)
    .set({ createdAt: longAgo })
    .where(eq(extractionCache.hash, rawKeyOf(u)));
  assert.equal(await cacheGetUrl(`${u}?utm_source=x`), null);
  await wipe(["/stale"]);
});

test("cachedAmong answers for exact and aliased URLs in one query", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/one", "/two", "/three"]);
  await cacheSetUrl(url("/one"), recipeFor("One", url("/one")));
  await cacheSetUrl(url("/two"), recipeFor("Two", url("/two")));

  const asked = [
    url("/one"),
    `${url("/two")}?utm_medium=social`,
    url("/three"),
    url("/one?page=4"),
  ];
  const hits = await cachedAmong(asked);
  assert.ok(hits.has(asked[0]));
  assert.ok(hits.has(asked[1]));
  assert.ok(!hits.has(asked[2]));
  // A page-selecting parameter is a different page and must not be badged.
  assert.ok(!hits.has(asked[3]));
  await wipe(["/one", "/two", "/three"]);
});

test("an uncached URL is never marked, even when other rows have a null url_key", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/nullkey"]);
  const db = getDb();
  // Exactly what a row written before this column existed looks like, and
  // exactly what an `or` on url_key could match against by accident.
  const u = url("/nullkey");
  await db.insert(extractionCache).values({
    hash: rawKeyOf(u),
    urlKey: null,
    recipe: recipeFor("Legacy", u),
  });
  const hits = await cachedAmong([url("/definitely-not-cached")]);
  assert.equal(hits.size, 0);
  // The legacy row still answers to its own exact key, which is the promise
  // the alias design makes: nothing written before this stops working.
  assert.equal((await cacheGetUrl(u))?.title, "Legacy");
  await wipe(["/nullkey"]);
});

test("withCacheFlags floats cached results and keeps relevance order inside each group", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/b", "/d"]);
  await cacheSetUrl(url("/b"), recipeFor("B", url("/b")));
  await cacheSetUrl(url("/d"), recipeFor("D", url("/d")));

  const results = ["a", "b", "c", "d", "e"].map((k) => ({
    title: k.toUpperCase(),
    url: url(`/${k}`),
    site: "cache-test.invalid",
    note: "",
  }));
  const out = await withCacheFlags(results);

  // A stable partition, not a re-sort: cached first, and within each group the
  // order the search engine returned. Re-sorting would throw away relevance,
  // which is the only ordering signal a search result has.
  assert.deepEqual(out.map((r) => r.title), ["B", "D", "A", "C", "E"]);
  assert.deepEqual(out.map((r) => !!r.cached), [true, true, false, false, false]);
  await wipe(["/b", "/d"]);
});

test("when several raw URLs share an alias, the freshest tree wins", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await wipe(["/shared"]);
  const db = getDb();
  const older = url("/shared");
  const newer = `${url("/shared")}?utm_source=x`;

  await cacheSetUrl(older, recipeFor("Older", older));
  await db
    .update(extractionCache)
    .set({ createdAt: new Date(Date.now() - 1000 * 60 * 60) })
    .where(eq(extractionCache.hash, rawKeyOf(older)));
  await cacheSetUrl(newer, recipeFor("Newer", newer));

  // Both rows exist and both carry the same alias — that is the backfill's
  // normal outcome for a page somebody pasted twice, spelled differently.
  const rows = await db
    .select()
    .from(extractionCache)
    .where(eq(extractionCache.urlKey, urlKeyOf(older)!));
  assert.equal(rows.length, 2);

  // A third spelling has no exact key of its own, so it goes to the alias and
  // must land on the newer tree — which is what /reextract writes.
  assert.equal((await cacheGetUrl(`${url("/shared")}/#top`))?.title, "Newer");
  // An exact key still beats the alias outright.
  assert.equal((await cacheGetUrl(older))?.title, "Older");
  await wipe(["/shared"]);
});
