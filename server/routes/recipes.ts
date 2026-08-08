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

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { fetchSource } from "../lib/fetchSource";
import { structureRecipe } from "../lib/structureRecipe";
import { structureRecipeFromUrl } from "../lib/fetchViaClaude";
import { searchRecipes, type SearchResult } from "../lib/searchRecipes";
import type { Recipe } from "../../shared/layout";

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
 * Extraction is slow and costs an API call, so never do it twice for the same
 * input. Swap this for a Drizzle table keyed on the same hash when you want it
 * to survive restarts:
 *   recipe_cache(hash text primary key, recipe jsonb, created_at timestamptz)
 */
const cache = new Map<string, { recipe: Recipe; at: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function cacheGet(key: string): Recipe | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.recipe;
}

// Same idea as the extraction cache above, keyed and expired the same way,
// just holding a list of candidates instead of a structured recipe.
const searchCache = new Map<string, { results: SearchResult[]; at: number }>();

function searchCacheGet(key: string): SearchResult[] | null {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
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

recipesRouter.post("/extract", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (overLimit(ip))
    return res
      .status(429)
      .json({ error: "Too many extractions this hour. Try again later." });

  const { url, text, file } = req.body ?? {};

  if (!url && !text && !file)
    return res.status(400).json({ error: "Send a url, pasted text, or a file." });

  try {
    // ---- URL ----------------------------------------------------------
    if (url) {
      if (typeof url !== "string")
        return res.status(400).json({ error: "url must be a string." });

      const key = hash(`url:${url}`);
      const cached = cacheGet(key);
      if (cached)
        return res.json({ recipe: cached, meta: { cached: true, source: "url" } });

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
        console.warn("[extract] self-fetch failed, using web_fetch:", (selfErr as Error).message);
        const out = await structureRecipeFromUrl(url);
        recipe = out.recipe;
        attempts = out.attempts;
        repaired = out.repaired;
        via = "claude";
      }

      cache.set(key, { recipe, at: Date.now() });
      return res.json({
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
      const cached = cacheGet(key);
      if (cached)
        return res.json({ recipe: cached, meta: { cached: true, source: "text" } });

      const { recipe, attempts, repaired } = await structureRecipe({ text: clipped });
      cache.set(key, { recipe, at: Date.now() });
      return res.json({
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
    const cached = cacheGet(key);
    if (cached)
      return res.json({ recipe: cached, meta: { cached: true, source: "file" } });

    const { recipe, attempts, repaired } = await structureRecipe({
      file: { data: clean, mediaType },
    });
    cache.set(key, { recipe, at: Date.now() });
    return res.json({
      recipe,
      meta: { cached: false, source: "file", attempts, repaired },
    });
  } catch (e) {
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
  if (cached) return res.json({ results: cached });

  try {
    const results = await searchRecipes(trimmed);
    searchCache.set(key, { results, at: Date.now() });
    return res.json({ results });
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
