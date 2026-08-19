/**
 * server/routes/recipes.ts
 *
 * POST /api/recipes/extract
 *   { url }                          — fetch and parse a recipe page
 *   { text }                         — pasted recipe text
 *   { file: { data, mediaType } }    — base64 photo or PDF of a page
 *
 * Returns { recipe, meta }. The recipe is guaranteed to satisfy
 * validateRecipe, which means the client renderer can draw it.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../db";
import { extractionCache } from "../../shared/schema";
import { fetchSource } from "../lib/fetchSource";
import { structureRecipe } from "../lib/structureRecipe";
import { structureRecipeFromUrl } from "../lib/fetchViaClaude";
import { searchRecipes, type SearchResult } from "../lib/searchRecipes";
import type { Recipe } from "../../shared/layout";
import { userIdOf } from "../middleware/session";
import { ensureTrialId, refundTrial, spendTrial, storeTrialRecipe } from "../lib/trial";
import { urlKeyOf } from "../lib/urlKey";
import { hostOf, recordExtraction, type ExtractionEvent } from "../lib/extractionLog";

export const recipesRouter = Router();

const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const MAX_TEXT = 30_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Search results DO expire. They are a list of live URLs, and a link that
 * 404s or a page that moved is worse than a fresh search — unlike an
 * extracted tree, which is a structured copy of a recipe that has already
 * been read and does not rot.
 *
 * This used to be one constant shared with the extraction cache. Removing the
 * extraction TTL without splitting it first would have made search results
 * immortal too, which is the opposite of what either wants.
 */
const SEARCH_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * EXTRACTED TREES DO NOT EXPIRE.
 *
 * There was a 30-day TTL here. It threw away an extraction already paid for,
 * on the theory that a page might have changed — but recipe pages do not
 * meaningfully change, and the real risk it was insuring against was a bad
 * parse becoming everyone's for a month. `/reextract` bounds that directly
 * and on demand, which is strictly better than a timer that also discards
 * every good tree alongside the bad ones.
 *
 * `created_at` is still written and still load-bearing: it is what the alias
 * lookup orders by, so a page re-read through `/reextract` wins over the tree
 * it replaced.
 */

// Extraction is slow and costs an API call, so never do it twice for the
// same input. Backed by the extraction_cache table so it survives restarts.
async function cacheGet(key: string): Promise<Recipe | null> {
  const db = getDb();
  const [hit] = await db.select().from(extractionCache).where(eq(extractionCache.hash, key));
  return hit ? hit.recipe : null;
}

async function cacheSet(key: string, recipe: Recipe): Promise<void> {
  const db = getDb();
  await db
    .insert(extractionCache)
    .values({ hash: key, recipe })
    .onConflictDoUpdate({ target: extractionCache.hash, set: { recipe, createdAt: new Date() } });
}

/**
 * A URL's cached tree — exact key first, normalised alias second.
 *
 * The order is the safety property. An exact match is what this cache has
 * always served and cannot have been widened by normalisation; the alias only
 * ever answers when nothing was stored under the string itself. So turning
 * normalisation off is deleting the second lookup, with nothing to migrate.
 */
export async function cacheGetUrl(rawUrl: string): Promise<Recipe | null> {
  const exact = await cacheGet(hash(`url:${rawUrl}`));
  if (exact) return exact;

  const alias = urlKeyOf(rawUrl);
  if (!alias) return null;

  // Several raw URLs can share one alias — that is the whole point — so this
  // has to choose, and the freshest is the only defensible choice: if one of
  // them was re-read through /reextract because the tree was wrong, that is
  // the one to serve. Ordering by anything else, or not ordering at all,
  // makes which tree you get depend on the order Postgres felt like.
  const db = getDb();
  const [hit] = await db
    .select()
    .from(extractionCache)
    .where(eq(extractionCache.urlKey, alias))
    .orderBy(desc(extractionCache.createdAt))
    .limit(1);
  return hit ? hit.recipe : null;
}

export async function cacheSetUrl(rawUrl: string, recipe: Recipe): Promise<void> {
  const db = getDb();
  const key = hash(`url:${rawUrl}`);
  const alias = urlKeyOf(rawUrl);
  await db
    .insert(extractionCache)
    .values({ hash: key, urlKey: alias, recipe })
    .onConflictDoUpdate({
      target: extractionCache.hash,
      set: { recipe, urlKey: alias, createdAt: new Date() },
    });
}

/** Drops whatever is cached for a URL, under either key. */
async function cacheDropUrl(rawUrl: string): Promise<void> {
  const db = getDb();
  await db.delete(extractionCache).where(eq(extractionCache.hash, hash(`url:${rawUrl}`)));
  const alias = urlKeyOf(rawUrl);
  if (alias) await db.delete(extractionCache).where(eq(extractionCache.urlKey, alias));
}

/**
 * Which of these URLs already have a tree, as a set of the raw strings given.
 *
 * One query for the whole result list rather than one per row. Deliberately
 * takes the URLs the SERVER just produced rather than exposing a
 * "is this cached?" endpoint: the same answer over an arbitrary list would be
 * a bulk oracle for "has anyone ever extracted this page", and there is no
 * reason to hand that out when the only caller is the search response itself.
 */
export async function cachedAmong(rawUrls: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!rawUrls.length) return out;

  const byRaw = new Map<string, string>();
  const byAlias = new Map<string, string[]>();
  for (const u of rawUrls) {
    byRaw.set(hash(`url:${u}`), u);
    const alias = urlKeyOf(u);
    if (alias) byAlias.set(alias, [...(byAlias.get(alias) ?? []), u]);
  }

  const db = getDb();
  const rows = await db
    .select({ hash: extractionCache.hash, urlKey: extractionCache.urlKey })
    .from(extractionCache)
    .where(
      or(
        inArray(extractionCache.hash, [...byRaw.keys()]),
        byAlias.size ? inArray(extractionCache.urlKey, [...byAlias.keys()]) : undefined
      )
    );

  for (const row of rows) {
    const exact = byRaw.get(row.hash);
    if (exact) out.add(exact);
    if (row.urlKey) for (const u of byAlias.get(row.urlKey) ?? []) out.add(u);
  }
  return out;
}

// Search results are not worth a durable table — they go stale fast and a
// missed cache hit just costs one more API call, not a redo of user data.
// Keeping this one in memory (same TTL) is a deliberate, smaller-blast-radius
// choice than the extraction cache above.
const searchCache = new Map<string, { results: SearchResult[]; at: number }>();

function searchCacheGet(key: string): SearchResult[] | null {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return hit.results;
}

// Extraction is expensive enough to be worth a crude per-IP throttle.
const rate = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function overLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (rate.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rate.set(ip, hits);
  return hits.length > RATE_LIMIT;
}

/**
 * One free RECIPE per browser, enforced here rather than in the client.
 *
 * A CACHED HIT SPENDS IT TOO, AND THAT IS THE POINT.
 *
 * This was briefly built the other way, on the reasoning that a cache hit
 * costs no API call so charging for it charges for nothing. That reasoning
 * was about *our* cost, and the trial is not a meter on our cost — it exists
 * to convert. Someone who views unlimited free diagrams because they happened
 * to pick popular recipes never reaches the wall, and the wall is the product.
 * One free recipe means one, cached or not. See ROADMAP #3.
 *
 * So this is middleware again, running before the handler and before anything
 * looks in the cache. The allowance is taken *before* the work and
 * atomically, so two requests fired at once cannot both come back free; a
 * failure refunds it, because a broken URL should not cost someone their one
 * try.
 *
 * The count lives in an httpOnly cookie plus a row, not in localStorage. That
 * is not unbypassable — clearing cookies or a private window resets it — but
 * the check being server-side is what matters: a modified client still gets a
 * 402 here.
 */
async function requireExtractionAllowance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (userIdOf(req)) return next();

  try {
    const trialId = ensureTrialId(req, res);
    const spent = await spendTrial(trialId);
    if (!spent) {
      return res.status(402).json({
        error: "You have used your free recipe. Create an account to keep going.",
        code: "trial_spent",
      });
    }
    (req as Request & { trialId?: string }).trialId = trialId;
    return next();
  } catch (e) {
    console.error("[trial:gate]", e);
    return res.status(500).json({ error: "Could not start that extraction." });
  }
}

/**
 * Sends a successful extraction, parking the recipe against the trial first
 * when the visitor has no account. That parked row is the one recipe a
 * signed-out browser persists — see the long note in server/lib/trial.ts for
 * why that does not contradict "no anonymous library".
 */
async function sendRecipe(
  req: Request,
  res: Response,
  body: { recipe: unknown; meta: unknown }
) {
  const trialId = (req as Request & { trialId?: string }).trialId;
  if (!trialId) return res.json(body);
  try {
    const servings =
      typeof (body.recipe as { servings?: unknown })?.servings === "number"
        ? ((body.recipe as { servings: number }).servings)
        : null;
    const trialRecipeId = await storeTrialRecipe(trialId, body.recipe, servings);
    return res.json({ ...body, trialRecipeId });
  } catch (e) {
    // The extraction worked; only the parking failed. Send it anyway — the
    // visitor still sees their diagram — and refund so they are not charged
    // for a recipe we could not keep for them.
    console.error("[trial:store]", e);
    await refundTrial(trialId).catch(() => {});
    return res.json(body);
  }
}

/**
 * Starts collecting facts about this extraction, written once the response is
 * finished.
 *
 * ON `res.on("finish")` RATHER THAN A CALL AT EACH RETURN. The handler has
 * seven exits that matter — three cache hits, three successes and the catch —
 * and a per-exit call would have to be added to the eighth the day somebody
 * adds one. The finish hook cannot be forgotten, gets `ok` and `ms` for free,
 * and runs after the bytes are out so it can never add latency.
 *
 * NOTHING IS RECORDED UNTIL `mark` IS CALLED. A 400 for a missing body, a 413
 * for an oversized file or a 429 from the throttle never reached the model,
 * and counting them would quietly wreck the denominator of every "what
 * fraction" query this table exists to answer. A 402 cannot get here at all —
 * the allowance middleware answers those before the handler runs.
 */
function extractionRecorder(req: Request, res: Response) {
  const startedAt = Date.now();
  let facts: Partial<ExtractionEvent> | null = null;

  res.on("finish", () => {
    if (!facts) return;
    recordExtraction({
      source: facts.source ?? "url",
      cached: facts.cached ?? false,
      via: facts.via ?? null,
      attempts: facts.attempts ?? null,
      repaired: facts.repaired ?? null,
      host: facts.host ?? null,
      ok: res.statusCode < 400,
      ms: Date.now() - startedAt,
    });
  });

  return (next: Partial<ExtractionEvent>) => {
    facts = { ...(facts ?? {}), ...next };
  };
}

recipesRouter.post("/extract", requireExtractionAllowance, async (req: Request, res: Response) => {
  const mark = extractionRecorder(req, res);
  const { url, text, file } = req.body ?? {};

  if (!url && !text && !file)
    return res.status(400).json({ error: "Send a url, pasted text, or a file." });

  try {
    // ---- URL ----------------------------------------------------------
    if (url) {
      if (typeof url !== "string")
        return res.status(400).json({ error: "url must be a string." });

      // The cache is consulted before the THROTTLE, which is the one gate
      // that genuinely is about cost: a hit makes no API call, so there is
      // nothing for a rate limit to protect. The trial allowance is a
      // different thing and has already been taken above — see the middleware.
      // via defaults to "self" and is overwritten with "claude" if the
      // fallback fires, so a failure on either path is attributable rather
      // than landing in a null bucket.
      mark({ source: "url", host: hostOf(url), via: "self" });
      const cached = await cacheGetUrl(url);
      if (cached) {
        mark({ cached: true });
        return sendRecipe(req, res, { recipe: cached, meta: { cached: true, source: "url" } });
      }

      if (overLimit(req.ip ?? "unknown"))
        return res
          .status(429)
          .json({ error: "Too many extractions this hour. Try again later." });

      let recipe;
      let attempts = 1;
      let repaired: string[] = [];
      let via: "self" | "claude" = "self";
      let extraction: "jsonld" | "text" | undefined;

      try {
        // Our own fetch is cheaper and gives us JSON-LD when the site has it.
        const src = await fetchSource(url);
        const out = await structureRecipe({
          title: src.title,
          yieldText: src.yieldText,
          ingredients: src.ingredients,
          instructions: src.instructions,
          text: src.quality === "text" ? src.text : undefined,
          sourceUrl: url,
        });
        recipe = out.recipe;
        attempts = out.attempts;
        repaired = out.repaired;
        recipe.source = src.siteName;
        extraction = src.quality;
      } catch (selfErr) {
        // Blocked, JS-rendered, or unreadable. Let Claude fetch it instead —
        // the request comes from Anthropic's infrastructure, not this Repl.
        // Marked here rather than only on success, so a failure on the
        // expensive path still shows up as one — otherwise the fraction this
        // table exists to measure would count only the calls that worked.
        mark({ via: "claude" });
        console.warn("[extract] self-fetch failed, using web_fetch:", (selfErr as Error).message);
        const out = await structureRecipeFromUrl(url);
        recipe = out.recipe;
        attempts = out.attempts;
        repaired = out.repaired;
        via = "claude";
      }

      await cacheSetUrl(url, recipe);
      mark({ cached: false, via, attempts, repaired: repaired.length });
      return sendRecipe(req, res, {
        recipe,
        meta: {
          cached: false,
          source: "url",
          // "text" means we parsed prose rather than structured data — a
          // useful signal that the result deserves a closer look.
          extraction,
          via,
          attempts,
          repaired,
        },
      });
    }

    // ---- Pasted text --------------------------------------------------
    if (text) {
      if (typeof text !== "string")
        return res.status(400).json({ error: "text must be a string." });
      if (text.trim().length < 40)
        return res.status(400).json({ error: "That is too short to be a recipe." });

      const clipped = text.slice(0, MAX_TEXT);
      const key = hash(`text:${clipped}`);
      // via up front, not on success. The text and file paths have no
      // fallback — they are always structureRecipe, i.e. "self" — so marking
      // it only when the call returns means a FAILED extraction records a
      // null via and lands in a bucket that says nothing. The URL path
      // already gets this right by marking "claude" as the fallback is
      // entered; this is the same rule.
      mark({ source: "text", via: "self" });
      const cached = await cacheGet(key);
      if (cached) {
        mark({ cached: true });
        return sendRecipe(req, res, { recipe: cached, meta: { cached: true, source: "text" } });
      }

      if (overLimit(req.ip ?? "unknown"))
        return res
          .status(429)
          .json({ error: "Too many extractions this hour. Try again later." });

      const { recipe, attempts, repaired } = await structureRecipe({ text: clipped });
      await cacheSet(key, recipe);
      mark({ cached: false, via: "self", attempts, repaired: repaired.length });
      return sendRecipe(req, res, {
        recipe,
        meta: { cached: false, source: "text", attempts, repaired },
      });
    }

    // ---- Image or PDF -------------------------------------------------
    const { data, mediaType } = file ?? {};
    if (typeof data !== "string" || typeof mediaType !== "string")
      return res
        .status(400)
        .json({ error: "file needs base64 data and a mediaType." });
    if (!ALLOWED_MEDIA.has(mediaType))
      return res.status(415).json({ error: "Upload a JPEG, PNG, GIF, WebP, or PDF." });

    const clean = data.replace(/^data:[^;]+;base64,/, "");
    if (Buffer.byteLength(clean, "base64") > MAX_FILE_BYTES)
      return res.status(413).json({ error: "That file is larger than 8 MB." });

    const key = hash(`file:${clean.slice(0, 4096)}:${clean.length}`);
    mark({ source: "file", via: "self" });
    const cached = await cacheGet(key);
    if (cached) {
      mark({ cached: true });
      return sendRecipe(req, res, { recipe: cached, meta: { cached: true, source: "file" } });
    }

    if (overLimit(req.ip ?? "unknown"))
      return res
        .status(429)
        .json({ error: "Too many extractions this hour. Try again later." });

    const { recipe, attempts, repaired } = await structureRecipe({
      file: { data: clean, mediaType },
    });
    await cacheSet(key, recipe);
    mark({ cached: false, via: "self", attempts, repaired: repaired.length });
    return sendRecipe(req, res, {
      recipe,
      meta: { cached: false, source: "file", attempts, repaired },
    });
  } catch (e) {
    // The allowance was taken before the work started, so a failure here has
    // to give it back — a dead link or a model timeout must not cost someone
    // their one free extraction.
    const trialId = (req as Request & { trialId?: string }).trialId;
    if (trialId) await refundTrial(trialId).catch(() => {});

    const err = e as Error & { details?: string[] };
    const isUserFacing =
      /URL|host|page|refused|too large|too short|recipe from that page|valid diagram/i.test(
        err.message
      );
    if (!isUserFacing) console.error("[recipes/extract]", err);
    return res.status(isUserFacing ? 422 : 500).json({
      error: isUserFacing ? err.message : "Something went wrong reading that recipe.",
      details: err.details,
    });
  }
});

/**
 * Marks the results we already have a tree for, and floats them to the top.
 *
 * WHY THIS RUNS ON EVERY RESPONSE, INCLUDING A SEARCH-CACHE HIT.
 *
 * `searchCache` holds a query's results for 30 days. The extraction cache
 * moves underneath it constantly — every extraction anyone runs adds to it,
 * and TTL expiry takes rows away — so a flag computed once and stored beside
 * the results would be stale almost immediately, in both directions: a badge
 * promising an instant open that then quietly paid for an extraction, and a
 * cached tree nobody was told about. It is one indexed query per response.
 *
 * The sort is a STABLE PARTITION, not a re-sort. The order inside each group
 * is the relevance order the search returned; all this does is move the free
 * ones in front of the paid ones, because they are faster for the user and
 * cost nothing to serve.
 *
 * What this exposes is one bit — "somebody, at some point, extracted this
 * page" — and it is a bit the product already gives away: `meta.cached` comes
 * back on the paste path today, and ranking cached results first leaks it
 * whether or not there is a badge. It says nothing about who, and nothing
 * about saving; the saved count is stage two.
 */
export async function withCacheFlags(results: SearchResult[]): Promise<SearchResult[]> {
  let hits: Set<string>;
  try {
    hits = await cachedAmong(results.map((r) => r.url));
  } catch (e) {
    // A cache lookup failing must not fail the search. Everything is simply
    // unmarked, which is exactly the behaviour before this existed.
    console.error("[search:cacheFlags]", e);
    return results;
  }
  const flagged = results.map((r) => ({ ...r, cached: hits.has(r.url) }));
  return [...flagged.filter((r) => r.cached), ...flagged.filter((r) => !r.cached)];
}

/**
 * Re-reading a page, evicting whatever was cached for it.
 *
 * WHAT THIS IS FOR. Normalising URLs multiplies cache hits, which is margin —
 * and multiplies the reach of a bad parse along with them, because
 * corrections do not propagate between users yet (ROADMAP #3). This is what
 * bounds that: anyone who lands on a tree that is plainly wrong can make the
 * extractor read the page again, for themselves and for everyone after them.
 *
 * WHAT IT IS NOT. It does not propagate a user's EDITS. It re-runs the
 * extractor, so the worst a single person can do is spend one API call and
 * replace a machine-generated tree with another machine-generated tree. The
 * consensus requirement in ROADMAP #3 — several independent people making the
 * same correction before it becomes everyone's — is about propagating edits,
 * and this does not pre-empt it.
 *
 * TIGHTLY LIMITED, BECAUSE IT SPENDS MARGIN. Under a subscription this is not
 * a free safety valve: every call is an extraction billed against revenue
 * already collected, and it is the one route a user can invoke repeatedly on
 * purpose. Signed in only — an account is answerable in a way a cookie is
 * not — and capped per user per day.
 */
const REEXTRACT_PER_DAY = 5;
const REEXTRACT_WINDOW_MS = 24 * 60 * 60 * 1000;
const reextracts = new Map<string, number[]>();

function overReextractLimit(userId: string): boolean {
  const now = Date.now();
  const hits = (reextracts.get(userId) ?? []).filter(
    (t) => now - t < REEXTRACT_WINDOW_MS
  );
  hits.push(now);
  reextracts.set(userId, hits);
  return hits.length > REEXTRACT_PER_DAY;
}

recipesRouter.post("/reextract", async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  if (!userId)
    return res
      .status(401)
      .json({ error: "Sign in to re-read a page.", code: "auth_required" });

  const { url } = req.body ?? {};
  if (typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "url must be a string." });
  if (!urlKeyOf(url))
    return res.status(400).json({ error: "That is not a web address we can read." });

  if (overReextractLimit(userId))
    return res.status(429).json({
      error: `You can re-read ${REEXTRACT_PER_DAY} pages a day. Try again tomorrow.`,
      code: "reextract_limit",
    });

  // Its own source value, so re-reads never contaminate the fraction of
  // ordinary extractions that take the expensive path — and so the cost of
  // the hatch itself is visible separately, which is the number that decides
  // whether 5/day is the right cap.
  const mark = extractionRecorder(req, res);
  mark({ source: "reextract", cached: false, host: hostOf(url), via: "self" });

  try {
    // Evict FIRST. If the extraction below fails, the next person pays for a
    // fresh one rather than inheriting the tree somebody just told us is
    // wrong — the cheaper mistake of the two.
    await cacheDropUrl(url);

    let recipe: Recipe;
    let attempts = 1;
    let repaired: string[] = [];
    try {
      const src = await fetchSource(url);
      const out = await structureRecipe({
        title: src.title,
        yieldText: src.yieldText,
        ingredients: src.ingredients,
        instructions: src.instructions,
        text: src.quality === "text" ? src.text : undefined,
        sourceUrl: url,
      });
      recipe = out.recipe;
      attempts = out.attempts;
      repaired = out.repaired;
      recipe.source = src.siteName;
    } catch {
      mark({ via: "claude" });
      const out = await structureRecipeFromUrl(url);
      recipe = out.recipe;
      attempts = out.attempts;
      repaired = out.repaired;
    }

    await cacheSetUrl(url, recipe);
    mark({ attempts, repaired: repaired.length });
    return res.json({ recipe, meta: { cached: false, source: "url", attempts, repaired } });
  } catch (e) {
    const err = e as Error & { details?: string[] };
    const isUserFacing =
      /URL|host|page|refused|too large|too short|recipe from that page|valid diagram/i.test(
        err.message
      );
    if (!isUserFacing) console.error("[recipes/reextract]", err);
    return res.status(isUserFacing ? 422 : 500).json({
      error: isUserFacing ? err.message : "Could not read that page again.",
      details: err.details,
    });
  }
});

recipesRouter.post("/search", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  // Same throttle as extraction — a search also costs an API call.
  if (overLimit(ip))
    return res
      .status(429)
      .json({ error: "Too many searches this hour. Try again later." });

  const { query } = req.body ?? {};
  if (typeof query !== "string")
    return res.status(400).json({ error: "query must be a string." });

  const trimmed = query.trim();
  if (trimmed.length < 3)
    return res.status(400).json({ error: "Search for at least 3 characters." });
  if (trimmed.length > 200)
    return res.status(400).json({ error: "That search is too long." });

  const key = hash(`search:${trimmed}`);
  const cached = searchCacheGet(key);
  if (cached) return res.json({ results: await withCacheFlags(cached) });

  try {
    const results = await searchRecipes(trimmed);
    searchCache.set(key, { results, at: Date.now() });
    return res.json({ results: await withCacheFlags(results) });
  } catch (e) {
    const err = e as Error;
    const isUserFacing = /too short|too long|different search/i.test(err.message);
    if (!isUserFacing) console.error("[recipes/search]", err);
    return res.status(isUserFacing ? 422 : 500).json({
      error: isUserFacing
        ? err.message
        : "Something went wrong searching for recipes.",
    });
  }
});
