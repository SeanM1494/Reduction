/**
 * server/routes/page.db.test.ts — `POST /api/recipes/extract { page }`, the
 * page the phone's in-app browser hands over, against a real Postgres and a
 * loopback stand-in for the Messages API (no model, no recipe site).
 *
 * What is under test is the one rule that makes this route safe to add:
 * the SENDER chose what is in `html`, so what it produces is cached by
 * CONTENT, never by URL, and the cached copy carries no sourceUrl. Were it
 * otherwise, a recipe read behind someone's login — or any page claimed to
 * be from a URL it is not — would answer the next person's paste of that
 * URL, and search offers cached rows to everyone by their sourceUrl
 * (lib/searchLibrary.ts). Also: the structured-data path is the one taken
 * (one call, the card's own wording), a cache hit spends no call, and a
 * site that refuses every server says so with a code the phone can key on.
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accountAccess, extractionCache, extractionOriginals, users } from "@workspace/db";
import { needsDatabase } from "../lib/testdb";
import { cacheGetUrl, pageKey, recipesRouter } from "./recipes";
import { sourceFromHtml } from "../lib/fetchSource";

const TABLES = ["users", "account_access", "extraction_cache", "extraction_originals"];

const TREE = {
  title: "Page Test Meatloaf",
  servings: 6,
  sections: [
    {
      name: "Meatloaf",
      ingredients: [
        { id: "beef", qty: 1.5, unit: "lb", name: "ground beef" },
        { id: "egg", qty: 1, unit: null, name: "egg" },
      ],
      nodes: [
        { id: "mix", label: "mix beef and egg", inputs: ["beef", "egg"], src: 1 },
        { id: "bake", label: "bake 350°F 1 hr", inputs: ["mix"], src: 2 },
      ],
      root: "bake",
    },
  ],
};

// ---------------------------------------------------- the stand-in model --
let model: Server;
const bodies: any[] = [];
let reply: () => string = () => JSON.stringify(TREE);
const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };

before(async () => {
  model = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `msg_${bodies.length}`,
          type: "message",
          role: "assistant",
          model: "stub",
          content: [{ type: "text", text: reply() }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      );
    });
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  const a = model.address();
  process.env.ANTHROPIC_API_KEY = "stub-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});

// -------------------------------------------------------------- the app --
let server: Server | null = null;
let base = "";
async function listen(): Promise<string> {
  if (base) return base;
  const app = express();
  app.use(express.json({ limit: "12mb" }));
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

const minted = new Set<string>();
const keys = new Set<string>();
async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({ id, displayName: "Page Test" });
  minted.add(id);
  return id;
}

after(async () => {
  server?.close();
  model.close();
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["ANTHROPIC_BASE_URL", saved.base]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (!minted.size && !keys.size) return; // no database: touch nothing
  const db = getDb();
  if (keys.size) {
    await db.delete(extractionCache).where(inArray(extractionCache.hash, [...keys]));
    await db.delete(extractionOriginals).where(inArray(extractionOriginals.hash, [...keys]));
  }
  for (const id of minted) {
    await db.delete(accountAccess).where(eq(accountAccess.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

async function extract(userId: string, body: unknown) {
  const res = await fetch(`${await listen()}/api/recipes/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": userId },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

/** A recipe page as a browser has it: structured data in the head, a
 *  story around the card. `nonce` makes each test's recipe its own. */
function pageHtml(nonce: string, extraStep = "") {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: `Page Test Meatloaf ${nonce}`,
    recipeYield: "6",
    recipeIngredient: ["1 1/2 pounds ground beef", "1 large egg"],
    recipeInstructions: [
      { "@type": "HowToStep", text: "In a large bowl, mix the beef and the egg with your hands." },
      { "@type": "HowToStep", text: `Bake at 350 degrees F for 1 hour.${extraStep}` },
    ],
  };
  return `<!doctype html><html><head><title>Meatloaf</title>
<meta property="og:site_name" content="Page Test Kitchen">
<script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body><p>My grandmother made this every Sunday…</p></body></html>`;
}

const HOST = "https://page-test.invalid";

test("a page the phone sends: read from its structured data, and cached by content with no URL", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  const nonce = crypto.randomUUID();
  const url = `${HOST}/meatloaf-${nonce}`;
  const html = pageHtml(nonce);
  const key = pageKey(sourceFromHtml(html, new URL(url)));
  keys.add(key);

  bodies.length = 0;
  const r = await extract(u, { page: { url, html } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(bodies.length, 1, "one model call: the structured-data path");
  const asked = bodies[0].messages[0].content.map((c: any) => c.text ?? "").join("\n");
  assert.match(asked, /INSTRUCTIONS\n1\. In a large bowl, mix the beef/, "the model was shown the card, numbered");
  assert.equal("tools" in bodies[0], false, "no fetch tool: the page is already here");

  assert.equal(r.body.recipe.sourceUrl, url, "the sender's recipe knows where it came from");
  assert.equal(r.body.recipe.source, "Page Test Kitchen");
  assert.equal(r.body.sourceKey, key);
  assert.equal(r.body.original.steps[0].text, "In a large bowl, mix the beef and the egg with your hands.", "the card's own wording");
  assert.equal(r.body.meta.source, "page");

  const [row] = await getDb().select().from(extractionCache).where(eq(extractionCache.hash, key));
  assert.ok(row, "cached under the content key");
  assert.equal(row.urlKey, null, "no URL alias");
  assert.equal((row.recipe as { sourceUrl?: string }).sourceUrl, undefined, "no sourceUrl in the shared copy");
  assert.equal(await cacheGetUrl(url), null, "a paste of that URL does not get this page's tree");
  const [{ n }] = (
    await getDb().execute(sql`select count(*)::int as n from extraction_cache where hash = ${key} and recipe->>'sourceUrl' is not null`)
  ).rows as { n: number }[];
  assert.equal(n, 0, "invisible to search, which offers cached rows by sourceUrl");
});

test("the same recipe from anyone is a hit, with no call — and whatever URL they claim is only theirs", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const [a, b] = [await makeUser(), await makeUser()];
  const nonce = crypto.randomUUID();
  const html = pageHtml(nonce);
  keys.add(pageKey(sourceFromHtml(html, new URL(`${HOST}/x`))));

  const first = await extract(a, { page: { url: `${HOST}/meatloaf-${nonce}`, html } });
  assert.equal(first.status, 200);
  bodies.length = 0;
  const claimed = `${HOST}/somewhere-else-${nonce}`;
  const second = await extract(b, { page: { url: claimed, html } });
  assert.equal(second.status, 200);
  assert.equal(bodies.length, 0, "a hit spends nothing");
  assert.equal(second.body.meta.cached, true);
  assert.equal(second.body.recipe.sourceUrl, claimed, "the hit carries the requester's URL, not the first sender's");
  assert.equal(second.body.original.steps[1].text, "Bake at 350 degrees F for 1 hour.", "and the wording kept beside it");

  // The same URL with different content (a logged-in page, an edited card)
  // is a different recipe and a different key: it never gets the first one.
  bodies.length = 0;
  const other = pageHtml(nonce, " Rest 10 minutes.");
  keys.add(pageKey(sourceFromHtml(other, new URL(`${HOST}/x`))));
  const third = await extract(a, { page: { url: `${HOST}/meatloaf-${nonce}`, html: other } });
  assert.equal(third.status, 200);
  assert.equal(bodies.length, 1, "different content, a fresh read");
});

test("a malformed page is refused before anything runs", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  bodies.length = 0;
  assert.equal((await extract(u, { page: { url: `${HOST}/a` } })).status, 400, "no html");
  assert.equal((await extract(u, { page: { url: "ftp://page-test.invalid/a", html: pageHtml("x") } })).status, 400, "not a web page");
  assert.equal((await extract(u, { page: { url: "not a url", html: pageHtml("x") } })).status, 400);
  const big = await extract(u, { page: { url: `${HOST}/big`, html: "x".repeat(3_000_001) } });
  assert.equal(big.status, 413);
  const bare = await extract(u, { page: { url: `${HOST}/bare`, html: "<html><body>Sign in to continue.</body></html>" } });
  assert.equal(bare.status, 422);
  assert.match(bare.body.error, /Could not read a recipe from that page/);
  assert.equal(bodies.length, 0, "none of that reached the model");
});

test("a site that refuses every server says so with a code, so the phone can offer its browser", async (t) => {
  if (!(await needsDatabase(t, ...TABLES))) return;
  const u = await makeUser();
  // A loopback URL: our own fetch refuses it, and the stand-in model answers
  // the way it does for allrecipes.com — no recipe, the page was refused.
  reply = () => '{"unreadable": "permission denied for this domain"}';
  try {
    const r = await extract(u, { url: `http://127.0.0.1:9/recipe-${crypto.randomUUID()}` });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, "site_blocked");
    assert.match(r.body.error, /blocked us/);
  } finally {
    reply = () => JSON.stringify(TREE);
  }
});
