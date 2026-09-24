/**
 * The cached half of a search and the counts, against a real database.
 *
 * Every row this suite writes carries a nonsense word no real title has
 * ("Zorbquix"), under a host of its own, so a match can only be one of ours
 * and cleanup is exact.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../db";
import { extractionCache, recipes, users } from "@workspace/db";
import { needsDatabase } from "./testdb";
import { urlKeyOf } from "./urlKey";
import { libraryMatches, usageFor } from "./searchLibrary";

const TABLES = ["extraction_cache", "recipes", "users"];
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
  if (!people.size && !touched) return;
  const db = getDb();
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
