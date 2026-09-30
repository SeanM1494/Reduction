/**
 * routes/reel.db.test.ts — the starter reel against a real database (Sep 30).
 *
 * The privacy rules, each by a case that would break it: a page one account
 * cooked forty times; a page cooked by three accounts whose saves were then
 * removed; a drive link cooked by five; a paste cached under its content.
 * Then the route: signed in only, empty for a walled account, braked, no
 * account in the answer; and the owner's list: hidden pages never, curated
 * pages after the data, a pinned copy that puts a lost cache row back, and a
 * warm-up that reports without writing unless told, audited when it writes.
 *
 * Seeded rows use `reel-test-<uuid>` accounts and `reeltest-<uuid>.example`
 * hosts and are removed afterwards; the reel is a shared read, so tests look
 * for their own pages rather than for exact lists.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq, like, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, adminEvents, extractionCache, recipes, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { reelRouter, clearReelMemo, resetReelBrake } from "./reel";
import { adminRouter, resetAdminThrottle } from "./admin";
import { setWarmReaderForTests } from "./adminReel";
import { extractionEvents } from "@workspace/db";
import { emptyUsage } from "../lib/extractionConfig";
import { cacheGetUrlRow, cacheSetUrl, cacheDropUrl } from "./recipes";
import { HEADING_CURATED } from "../lib/reel";

const TABLES = ["users", "recipes", "extraction_cache", "account_access", "reel_entries", "admin_events"];
const SECRET = "test-admin-secret-reel-0123456789";
const RUN = crypto.randomUUID().slice(0, 8);
const HOST = `reeltest-${RUN}.example.com`;
const page = (p: string) => `https://${HOST}/${p}`;

let server: Server | null = null;
let base = "";
let seeded = false;
const accounts: string[] = [];

async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    req.session = u ? { userId: u } : null;
    next();
  });
  app.use("/api/reel", reelRouter);
  app.use("/api/admin", adminRouter);
  server = createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return base;
}

const tree = (url: string | undefined, title: string) => ({
  title,
  servings: 4,
  ...(url ? { sourceUrl: url, source: "Reel Test Kitchen" } : {}),
  mealTypes: ["dinner"],
  image: null,
  sections: [
    {
      name: "Main",
      ingredients: [
        { id: "a", qty: 1, unit: null, name: "egg" },
        { id: "b", qty: 1, unit: "tsp", name: "salt" },
      ],
      nodes: [{ id: "s", label: "whisk", inputs: ["a", "b"], src: 1 }],
      root: "s",
    },
  ],
});

async function account(): Promise<string> {
  const id = `reel-test-${crypto.randomUUID()}`;
  await getDb().insert(users).values({ id, displayName: "Reel Test", email: `${id}@reel.example.test` });
  accounts.push(id);
  return id;
}

async function save(userId: string, url: string, opts: { cooked?: number; rating?: number | null; removed?: boolean } = {}) {
  await getDb().insert(recipes).values({
    ownerKey: `user:${userId}`,
    userId,
    id: `r-${crypto.randomUUID()}`,
    recipe: tree(url, "Saved copy") as never,
    cooked: Array.from({ length: opts.cooked ?? 1 }, (_, i) => Date.now() - i * 1000) as never,
    rating: opts.rating ?? null,
    removedAt: opts.removed ? new Date() : null,
  } as never);
}

/** Seeds once for the whole file. */
async function seed() {
  if (seeded) return;
  seeded = true;
  const five = await Promise.all(Array.from({ length: 5 }, () => account()));
  // LOVED: cooked by five accounts, all rated 👍.
  for (const u of five) await save(u, page("loved"), { rating: 1 });
  await cacheSetUrl(page("loved"), tree(page("loved"), "Loved Omelette") as never);
  // One account, forty cooks: never qualifies.
  await save(five[0], page("one-account"), { cooked: 40 });
  await cacheSetUrl(page("one-account"), tree(page("one-account"), "Solo Soufflé") as never);
  // Three accounts, but two of the saves were taken out of the box.
  await save(five[0], page("removed"));
  await save(five[1], page("removed"), { removed: true });
  await save(five[2], page("removed"), { removed: true });
  await cacheSetUrl(page("removed"), tree(page("removed"), "Removed Risotto") as never);
  // A drive link five accounts cooked: never public-looking.
  const drive = `https://drive.google.com/file/d/${RUN}/view`;
  for (const u of five) await save(u, drive);
  await cacheSetUrl(drive, tree(drive, "Private Drive Pie") as never);
  // Cooked by three, unrated: qualifies, but cannot be called "loved".
  for (const u of five.slice(0, 3)) await save(u, page("unrated"));
  await cacheSetUrl(page("unrated"), tree(page("unrated"), "Unrated Stew") as never);
  // Cooked by four, NOT cached: qualifies on data and is left out.
  for (const u of five.slice(0, 4)) await save(u, page("uncached"));
  // A paste of the same dish, cached under its content with no sourceUrl.
  await getDb().insert(extractionCache).values({ hash: `reeltest-text-${RUN}`, recipe: tree(undefined, "Loved Omelette") as never });
}

after(async () => {
  if (!seeded) return;
  const db = getDb();
  for (const id of accounts) {
    await db.delete(recipes).where(eq(recipes.userId, id));
    await db.delete(accountAccess).where(eq(accountAccess.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  await db.delete(extractionCache).where(like(extractionCache.hash, `reeltest-text-${RUN}`));
  for (const p of ["loved", "one-account", "removed", "unrated", "uncached", "curated", "pinned", "warm-cached", "warm-new", "warm-fails"]) await cacheDropUrl(page(p));
  await db.delete(extractionEvents).where(eq(extractionEvents.host, HOST));
  setWarmReaderForTests(null);
  await cacheDropUrl(`https://drive.google.com/file/d/${RUN}/view`);
  await db.execute(sql`delete from reel_entries where url like ${`%${HOST}%`}`);
  await db.delete(adminEvents).where(like(adminEvents.note, `%${HOST}%`));
  server?.close();
});

async function reel(user: string | null) {
  clearReelMemo();
  const res = await fetch(`${await listen()}/api/reel`, { headers: user ? { "x-test-user": user } : {} });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : {} };
}

async function admin(method: string, path: string, body?: unknown) {
  const prev = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = SECRET;
  resetAdminThrottle();
  try {
    const res = await fetch(`${await listen()}/api/admin${path}`, {
      method,
      headers: { "x-admin-secret": SECRET, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  } finally {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
  }
}

const urls = (body: { cards: Array<{ url: string }> }) => body.cards.map((c) => c.url);

test("reel: signed in only", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  assert.equal((await reel(null)).status, 401);
});

test("reel: every privacy rule, by the case that would break it", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await seed();
  const viewer = await account();
  resetReelBrake();
  const r = await reel(viewer);
  assert.equal(r.status, 200);
  const shown = urls(r.body);
  assert.ok(shown.includes(page("loved")), "cooked by five accounts, cached and clean");
  assert.ok(shown.includes(page("unrated")), "cooked by three, unrated: still qualifies");
  assert.ok(!shown.includes(page("one-account")), "one account cooking forty times is one account");
  assert.ok(!shown.includes(page("removed")), "removed saves do not count");
  assert.ok(!shown.some((u: string) => u.includes("drive.google.com")), "a drive link never surfaces");
  assert.ok(!shown.includes(page("uncached")), "not cached, not offered: a tap must be free");
  assert.equal(r.body.cards.filter((c: { title: string }) => c.title === "Loved Omelette").length, 1, "the paste of the same dish is not a second card");

  const loved = r.body.cards.find((c: { url: string }) => c.url === page("loved"));
  assert.deepEqual(Object.keys(loved).sort(), ["kind", "mealType", "site", "title", "totalMinutes", "url", "usage"]);
  assert.equal(loved.kind, "data");
  assert.equal(loved.usage, "Cooked by 5 people · 100% loved it");
  const unrated = r.body.cards.find((c: { url: string }) => c.url === page("unrated"));
  assert.equal(unrated.usage, "Cooked by 3 people", "no share without five ratings");
  assert.equal(r.body.heading, HEADING_CURATED, "an unrated card means the reel cannot say 'Loved'");

  for (const id of accounts) assert.ok(!r.text.includes(id), "no account id in the answer");
  assert.doesNotMatch(r.text, /@/, "no email in the answer");
  assert.ok(r.body.cards.length <= 10);
});

test("reel: empty for an account the wall has stopped", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await seed();
  const walled = await account();
  await getDb().insert(accountAccess).values({ userId: walled, recipeAllowance: 1, recipesUsed: 1, enforceOverride: true } as never);
  resetReelBrake();
  const r = await reel(walled);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { heading: null, cards: [] });
});

test("reel: its own brake, 30 an hour per account", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await account();
  resetReelBrake();
  for (let i = 0; i < 30; i++) assert.equal((await reel(u)).status, 200);
  assert.equal((await reel(u)).status, 429);
  resetReelBrake();
});

test("reel: a hidden page is never offered; curated pages fill after the data", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await seed();
  const viewer = await account();
  resetReelBrake();
  // Hide the loved page: gone, whatever its data.
  assert.equal((await admin("PUT", "/reel", { url: page("loved"), status: "hidden", note: "test" })).status, 200);
  assert.ok(!urls((await reel(viewer)).body).includes(page("loved")));
  assert.equal((await admin("DELETE", `/reel?url=${encodeURIComponent(page("loved"))}`)).body.removed, true);
  assert.ok(urls((await reel(viewer)).body).includes(page("loved")), "unhidden, it is back");

  // Curate a cached page nobody has cooked: it appears after the data cards.
  await cacheSetUrl(page("curated"), tree(page("curated"), "Curated Crumble") as never);
  const put = await admin("PUT", "/reel", { url: page("curated"), status: "curated" });
  assert.equal(put.body.pinned, true, "a cached, clean page is pinned when curated");
  const r = await reel(viewer);
  const kinds = r.body.cards.map((c: { kind: string }) => c.kind);
  const at = urls(r.body).indexOf(page("curated"));
  assert.ok(at >= 0);
  assert.equal(kinds[at], "curated");
  assert.ok(kinds.slice(0, at).every((k: string) => k === "data"), "data cards come first");
  assert.equal(r.body.heading, HEADING_CURATED);

  // Curating a non-public address is refused.
  assert.equal((await admin("PUT", "/reel", { url: `https://${HOST}/x?p=1`, status: "curated" })).status, 422);
  // Every write is audited.
  const audited = await getDb().select().from(adminEvents).where(like(adminEvents.note, `%${HOST}%`));
  assert.ok(audited.length >= 3 && audited.every((a) => a.action === "reel" && a.targetUserId === "(reel)"));
});

test("reel: a curated page whose cache row was lost is put back from its pinned copy — no model call", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await seed();
  const viewer = await account();
  resetReelBrake();
  await cacheSetUrl(page("pinned"), tree(page("pinned"), "Pinned Pancakes") as never);
  await admin("PUT", "/reel", { url: page("pinned"), status: "curated" });
  // A failed re-read (/reextract) is what drops a row and leaves nothing.
  await cacheDropUrl(page("pinned"));
  assert.equal(await cacheGetUrlRow(page("pinned")), null);
  const r = await reel(viewer);
  assert.ok(urls(r.body).includes(page("pinned")), "still offered");
  assert.ok(await cacheGetUrlRow(page("pinned")), "and the cache row is back, so the tap is a free hit");
});

test("reel warm: reports by default, writes only when told, refreshes only a named row", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  await seed();
  // Not cached, report only: nothing is extracted or written.
  const dry = await admin("POST", "/reel/warm", { url: page("never-cached") });
  assert.equal(dry.body.status, "would_extract");
  assert.equal(await cacheGetUrlRow(page("never-cached")), null);
  // A non-public address is refused before anything else.
  assert.equal((await admin("POST", "/reel/warm", { url: "https://docs.google.com/document/d/x" })).body.status, "not_public");

  // Cached with old features: free, flagged, and NOT refreshed unless named.
  const old = tree(page("warm-cached"), "Old Oatmeal") as Record<string, unknown>;
  delete old.image;
  (old.sections as Array<{ nodes: Array<{ src?: number }> }>)[0].nodes[0].src = undefined;
  await cacheSetUrl(page("warm-cached"), old as never);
  const report = await admin("POST", "/reel/warm", { url: page("warm-cached"), refresh: true });
  assert.equal(report.body.status, "cached", "refresh without write changes nothing");
  assert.equal(report.body.estCostUsd, 0);
  assert.deepEqual(report.body.flags, ["no_step_order", "no_picture", "no_original_wording"]);
  assert.equal(report.body.needsRefresh, true);
  assert.equal(report.body.title, "Old Oatmeal");

  // write without refresh: curated and pinned as it is, no model call, audited.
  const wrote = await admin("POST", "/reel/warm", { url: page("warm-cached"), write: true });
  assert.equal(wrote.body.status, "cached");
  assert.equal(wrote.body.curated, true);
  const list = await admin("GET", "/reel");
  const entry = list.body.entries.find((e: { url: string }) => e.url === page("warm-cached"));
  assert.deepEqual([entry.status, entry.pinned], ["curated", true]);
  assert.ok(list.body.preview.cards.some((c: { url: string }) => c.url === page("warm-cached")), "the dry-run preview shows it");
  assert.equal(typeof list.body.preview.excluded.notCached, "number");
  for (const id of accounts) assert.ok(!JSON.stringify(list.body).includes(id), "no account in the preview either");
});

test("reel warm: write extracts an uncached page once, caches, pins, logs its cost and audits; a named refresh re-reads", async (t) => {
  if (!(await needsDatabase(t, ...TABLES, "extraction_events"))) return;
  await seed();
  let calls = 0;
  const usage = { ...emptyUsage(), inputTokens: 6000, outputTokens: 2000 };
  setWarmReaderForTests((async (url: string) => {
    calls++;
    if (url.endsWith("warm-fails")) throw Object.assign(new Error("Could not read a recipe from that page."), { usage });
    return { recipe: tree(url, calls > 1 ? "Fresh Frittata, re-read" : "Fresh Frittata"), attempts: 1, repaired: [], via: "self", extraction: "jsonld", original: null, usage };
  }) as never);

  const made = await admin("POST", "/reel/warm", { url: page("warm-new"), write: true });
  assert.equal(made.body.status, "extracted");
  assert.equal(made.body.estCostUsd, 0.032);
  assert.equal(made.body.curated, true);
  assert.equal(calls, 1);
  assert.equal((await cacheGetUrlRow(page("warm-new")))?.recipe.title, "Fresh Frittata", "in the cache: a tap is now free");

  // Again: already cached, so free and no model call.
  const again = await admin("POST", "/reel/warm", { url: page("warm-new"), write: true });
  assert.deepEqual([again.body.status, again.body.estCostUsd, calls], ["cached", 0, 1]);

  // Named refresh: re-read once.
  const refreshed = await admin("POST", "/reel/warm", { url: page("warm-new"), write: true, refresh: true });
  assert.deepEqual([refreshed.body.status, calls], ["refreshed", 2]);
  assert.equal((await cacheGetUrlRow(page("warm-new")))?.recipe.title, "Fresh Frittata, re-read");

  // A failure spends and says so, and curates nothing.
  const failed = await admin("POST", "/reel/warm", { url: page("warm-fails"), write: true });
  assert.equal(failed.body.status, "failed");
  assert.equal(failed.body.estCostUsd, 0.032);
  const entries = (await admin("GET", "/reel")).body.entries.map((e: { url: string }) => e.url);
  assert.ok(entries.includes(page("warm-new")) && !entries.includes(page("warm-fails")));

  await new Promise((r) => setTimeout(r, 300));
  const logged = await getDb().select().from(extractionEvents).where(eq(extractionEvents.host, HOST));
  assert.equal(logged.filter((e) => e.source === "warmup").length, 3, "extract, refresh and the failure: every model call is in the cost log");
  assert.ok(logged.every((e) => e.userId === null), "a warm-up is nobody's extraction");
  const audited = await getDb().select().from(adminEvents).where(like(adminEvents.note, `%${page("warm-new")}%`));
  assert.ok(audited.some((a) => /extracted/.test(a.note ?? "")) && audited.some((a) => /refreshed/.test(a.note ?? "")));
  setWarmReaderForTests(null);
});
