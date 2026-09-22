/**
 * server/routes/photos.db.test.ts — a recipe's picture, against a real
 * Postgres, with the recipe site stubbed at lib/photos.ts's fetcher seam.
 *
 * What is under test: the list carries meta and never bytes; an upload is
 * re-encoded to the stored size and served with cache headers keyed on its
 * version; a page photo is fetched from the recipe's image URL, at save
 * (fire-and-forget) and on demand; a user photo is never overwritten by a
 * page photo; another owner sees nothing; and no photo outlives its recipe
 * — which is a promise made in code, not by a foreign key (see the schema).
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { Jimp } from "jimp";
import { getDb } from "../db";
import { accountAccess, recipePhotos, recipes, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { PHOTO_LONG_EDGE, setPagePhotoFetcherForTests } from "../lib/photos";
import { libraryRouter } from "./library";

const TABLES = ["users", "recipes", "recipe_photos", "account_access"];

let server: Server | null = null;
let base = "";
async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
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
  await getDb().insert(users).values({ id, displayName: "Photo Test" });
  minted.add(id);
  return id;
}

after(async () => {
  if (minted.size) {
    const db = getDb();
    for (const id of minted) {
      const rows = await db.select({ ownerKey: recipes.ownerKey, id: recipes.id }).from(recipes).where(eq(recipes.userId, id));
      for (const r of rows) await db.delete(recipePhotos).where(and(eq(recipePhotos.ownerKey, r.ownerKey), eq(recipePhotos.id, r.id)));
      await db.delete(recipes).where(eq(recipes.userId, id));
      await db.delete(accountAccess).where(eq(accountAccess.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  setPagePhotoFetcherForTests(null);
  server?.close();
});

async function api(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${await listen()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": userId, "X-Owner-Key": `owner-${userId}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  const payload = type.startsWith("image/") ? Buffer.from(await res.arrayBuffer()) : await res.json().catch(() => ({}));
  return { status: res.status, body: payload as any, headers: res.headers };
}

const RECIPE = {
  title: "Toast",
  servings: 1,
  sections: [
    {
      name: "Toast",
      ingredients: [{ id: "a", qty: 1, unit: null, name: "bread" }],
      nodes: [{ id: "n1", label: "toast it", inputs: ["a"] }],
      root: "n1",
    },
  ],
};
async function saveRecipe(userId: string, recipe: Record<string, unknown> = RECIPE) {
  const id = `r-${crypto.randomUUID()}`;
  const r = await api("POST", "/api/library", userId, { id, recipe, done: [], servings: null });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id, entry: r.body.entry };
}

/** A solid-colour image of the given size, as PNG bytes. */
async function png(width: number, height: number, color = 0xff8800ff): Promise<Buffer> {
  return new Jimp({ width, height, color }).getBuffer("image/png");
}
const b64 = (b: Buffer) => b.toString("base64");
const dims = async (jpeg: Buffer) => {
  const img = await Jimp.read(jpeg);
  return { width: img.width, height: img.height, mime: img.mime };
};

async function photoRows(id: string) {
  return getDb().select({ version: recipePhotos.version, source: recipePhotos.source }).from(recipePhotos).where(eq(recipePhotos.id, id));
}

// ------------------------------------------------------------- upload ---

test("photo: the list carries meta only; an upload is re-encoded to the stored size and served with a versioned cache", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id, entry } = await saveRecipe(u);
  assert.equal(entry.photo, null, "no photo yet");

  const put = await api("PUT", `/api/library/${id}/photo`, u, { data: b64(await png(1600, 1200)), mediaType: "image/png" });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.photo, { version: 1, source: "user" });

  const list = await api("GET", "/api/library", u);
  const mine = list.body.entries.find((e: any) => e.id === id);
  assert.deepEqual(mine.photo, { version: 1, source: "user" });
  assert.equal(JSON.stringify(list.body).includes("bytes"), false, "the list never carries bytes");

  const got = await api("GET", `/api/library/${id}/photo?v=1`, u);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/jpeg", "everything stored is JPEG");
  assert.match(got.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(got.headers.get("etag"), '"p1"');
  assert.equal(got.headers.get("x-photo-source"), "user");
  const d = await dims(got.body as Buffer);
  assert.equal(Math.max(d.width, d.height), PHOTO_LONG_EDGE, "long edge fitted");
  assert.equal(d.width, 1024);
  assert.equal(d.height, 768, "aspect kept");

  // A replacement bumps the version, so the old URL is a different photo.
  const again = await api("PUT", `/api/library/${id}/photo`, u, { data: `data:image/png;base64,${b64(await png(300, 300, 0x0000ffff))}`, mediaType: "image/png" });
  assert.deepEqual(again.body.photo, { version: 2, source: "user" });
  const small = await api("GET", `/api/library/${id}/photo?v=2`, u);
  assert.equal(small.headers.get("etag"), '"p2"');
  const d2 = await dims(small.body as Buffer);
  assert.deepEqual([d2.width, d2.height], [300, 300], "never upscaled");
});

test("photo: uploads that are not images, too large, or of a type outside the list are refused before anything is stored", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const { id } = await saveRecipe(u);
  assert.equal((await api("PUT", `/api/library/${id}/photo`, u, { data: b64(Buffer.from("not an image at all")), mediaType: "image/png" })).status, 422);
  assert.equal((await api("PUT", `/api/library/${id}/photo`, u, { data: b64(await png(10, 10)), mediaType: "application/pdf" })).status, 415);
  assert.equal((await api("PUT", `/api/library/${id}/photo`, u, { data: "A".repeat(9 * 1024 * 1024), mediaType: "image/jpeg" })).status, 413);
  assert.equal((await api("PUT", `/api/library/${id}/photo`, u, { mediaType: "image/jpeg" })).status, 422);
  assert.equal((await photoRows(id)).length, 0);
  assert.equal((await api("GET", `/api/library/${id}/photo`, u)).status, 404);
});

// -------------------------------------------------------- the page's photo ---

function stubSite(images: Record<string, { bytes: Buffer; contentType?: string; status?: number }>) {
  const asked: string[] = [];
  setPagePhotoFetcherForTests(async (url) => {
    asked.push(url);
    const hit = images[url];
    if (!hit) return { ok: false, status: 404, contentType: null, bytes: Buffer.alloc(0) };
    return { ok: (hit.status ?? 200) < 400, status: hit.status ?? 200, contentType: hit.contentType ?? "image/png", bytes: hit.bytes };
  });
  return asked;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 4000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

test("photo: saving a recipe with an image URL fetches and stores the page's picture, after the save has answered", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const asked = stubSite({ "https://site.example/hero.png": { bytes: await png(2400, 1600) } });
  const { id, entry } = await saveRecipe(u, { ...RECIPE, image: "https://site.example/hero.png" });
  assert.equal(entry.photo, null, "the save does not wait for the site");
  const meta = await waitFor(async () => (await photoRows(id))[0]);
  assert.deepEqual(meta, { version: 1, source: "page" });
  assert.deepEqual(asked, ["https://site.example/hero.png"]);
  const got = await api("GET", `/api/library/${id}/photo?v=1`, u);
  assert.equal(got.headers.get("x-photo-source"), "page");
  const d = await dims(got.body as Buffer);
  assert.deepEqual([d.width, d.height], [1024, 683]);
  // Re-POSTing the same row (a lost response) fetches nothing again.
  const again = await api("POST", "/api/library", u, { id, recipe: { ...RECIPE, image: "https://site.example/hero.png" }, done: [], servings: null });
  assert.equal(again.status, 201);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(asked.length, 1, "only the row this POST created is fetched for");
});

test("photo: on demand — from-source fetches once, refuses a recipe with no picture, and never overwrites a user photo", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const asked = stubSite({
    "https://site.example/a.png": { bytes: await png(800, 600) },
    "https://site.example/not-image": { bytes: Buffer.from("<html>"), contentType: "text/html" },
  });
  // No image URL: a code the card can stop on.
  const plain = await saveRecipe(u);
  const none = await api("POST", `/api/library/${plain.id}/photo/from-source`, u);
  assert.equal(none.status, 404);
  assert.equal(none.body.code, "no_source_image");

  // A site that answers HTML is not kept, and the route says so with null.
  const html = await saveRecipe(u, { ...RECIPE, image: "https://site.example/not-image" });
  await new Promise((r) => setTimeout(r, 200));
  const bad = await api("POST", `/api/library/${html.id}/photo/from-source`, u);
  assert.equal(bad.status, 200);
  assert.equal(bad.body.photo, null);
  assert.equal((await photoRows(html.id)).length, 0);

  // The user's photo wins for ever.
  const mine = await saveRecipe(u, { ...RECIPE, image: "https://site.example/a.png" });
  await waitFor(async () => (await photoRows(mine.id))[0]);
  const put = await api("PUT", `/api/library/${mine.id}/photo`, u, { data: b64(await png(500, 500)), mediaType: "image/png" });
  assert.deepEqual(put.body.photo, { version: 2, source: "user" });
  const before = asked.length;
  const fs = await api("POST", `/api/library/${mine.id}/photo/from-source`, u);
  assert.deepEqual(fs.body.photo, { version: 2, source: "user" }, "the existing user photo comes back untouched");
  assert.equal(asked.length, before, "the site was not even asked");
  const got = await api("GET", `/api/library/${mine.id}/photo?v=2`, u);
  const d = await dims(got.body as Buffer);
  assert.deepEqual([d.width, d.height], [500, 500], "still the user's 500px square, not the page's 800x600");
});

// ------------------------------------------------------ ownership + lifetime ---

test("photo: another owner sees nothing, and no photo outlives its recipe", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const other = await makeUser();
  const { id } = await saveRecipe(u);
  await api("PUT", `/api/library/${id}/photo`, u, { data: b64(await png(64, 64)), mediaType: "image/png" });
  assert.equal((await api("GET", `/api/library/${id}/photo?v=1`, other)).status, 404, "a photo is exactly as private as its recipe");
  assert.equal((await api("PUT", `/api/library/${id}/photo`, other, { data: b64(await png(8, 8)), mediaType: "image/png" })).status, 404);
  assert.equal((await api("DELETE", `/api/library/${id}/photo`, other)).status, 404);

  // Remove: back to the fallback.
  const del = await api("DELETE", `/api/library/${id}/photo`, u);
  assert.deepEqual(del.body, { photo: null });
  assert.equal((await api("GET", `/api/library/${id}/photo`, u)).status, 404);

  // Deleting the recipe deletes the photo — in code, since there is no FK.
  await api("PUT", `/api/library/${id}/photo`, u, { data: b64(await png(64, 64)), mediaType: "image/png" });
  assert.equal((await photoRows(id)).length, 1);
  assert.equal((await api("DELETE", `/api/library/${id}`, u)).status, 200);
  assert.equal((await photoRows(id)).length, 0, "no orphan");
});
