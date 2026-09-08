/**
 * server/lib/fetchSource.ts — turn a URL into the cleanest text we can get.
 *
 * Best case: the page carries schema.org Recipe JSON-LD and we hand the model
 * a tidy ingredient list. Worst case: stripped body text. Either way the next
 * stage sees plain text, never HTML.
 */

import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MAX_BYTES = 3_000_000;
const MAX_CHARS = 24_000;
const TIMEOUT_MS = 12_000;

export interface FetchedSource {
  /** "jsonld" means the fields came from structured data, not guesswork. */
  quality: "jsonld" | "text";
  title: string | null;
  yieldText: string | null;
  ingredients: string[];
  instructions: string[];
  /** Fallback body text. Populated only when quality is "text". */
  text: string;
  siteName: string | null;
}

/** Blocks the obvious SSRF targets. Keep this in front of every fetch. */
function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("Only http and https URLs are supported.");

  const h = u.hostname.toLowerCase();
  const blocked =
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "[::1]" ||
    h === "::1";
  if (blocked) throw new Error("That host is not reachable from the server.");
  return u;
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(" ");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.name === "string") return o.name.trim();
  }
  return "";
}

function flattenInstructions(v: unknown): string[] {
  if (!v) return [];
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "string") {
      const s = node.trim();
      if (s) out.push(s);
      return;
    }
    const o = node as Record<string, unknown>;
    // HowToSection nests its own steps.
    if (o.itemListElement) {
      walk(o.itemListElement);
      return;
    }
    const s = textOf(o);
    if (s) out.push(s);
  };
  walk(v);
  return out;
}

/** Walks JSON-LD, including @graph wrappers, looking for a Recipe node. */
function findRecipeNode(json: unknown): Record<string, unknown> | null {
  const stack: unknown[] = [json];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (Array.isArray(cur)) {
      stack.push(...cur);
      continue;
    }
    if (typeof cur !== "object") continue;
    const o = cur as Record<string, unknown>;
    const t = o["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types.some((x) => typeof x === "string" && x.toLowerCase() === "recipe"))
      return o;
    if (o["@graph"]) stack.push(o["@graph"]);
  }
  return null;
}

function stripToText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, nav, header, footer, form, iframe, svg").remove();
  $("[aria-hidden='true']").remove();
  const body = $("main").text() || $("article").text() || $("body").text();
  return body
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}

export async function fetchSource(rawUrl: string): Promise<FetchedSource> {
  const url = assertPublicUrl(rawUrl);

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok)
    throw new Error(
      res.status === 403 || res.status === 429
        ? "That site refused the request. Paste the recipe text instead."
        : `The page returned ${res.status}.`
    );

  const type = res.headers.get("content-type") || "";
  if (!type.includes("html") && !type.includes("text"))
    throw new Error("That URL is not a web page.");

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error("That page is too large.");
  const html = new TextDecoder("utf-8").decode(buf);

  const $ = cheerio.load(html);
  const siteName =
    $('meta[property="og:site_name"]').attr("content")?.trim() || url.hostname;
  const pageTitle =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").first().text().trim() ||
    null;

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(el).contents().text();
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // Plenty of sites ship malformed JSON-LD. Move on.
    }
    const node = findRecipeNode(parsed);
    if (!node) continue;

    const ingredients = (
      Array.isArray(node.recipeIngredient) ? node.recipeIngredient : []
    )
      .map(textOf)
      .filter(Boolean);
    const instructions = flattenInstructions(node.recipeInstructions);

    if (ingredients.length && instructions.length) {
      return {
        quality: "jsonld",
        title: textOf(node.name) || pageTitle,
        yieldText: textOf(node.recipeYield) || null,
        ingredients,
        instructions,
        text: "",
        siteName,
      };
    }
  }

  const text = stripToText($);
  if (text.length < 200)
    throw new Error(
      "Could not read a recipe from that page. Paste the text instead."
    );

  return {
    quality: "text",
    title: pageTitle,
    yieldText: null,
    ingredients: [],
    instructions: [],
    text,
    siteName,
  };
}
