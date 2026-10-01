/**
 * lib/reel.ts — the starter reel on Add New and the empty library: which
 * recipes to offer someone who has none yet, and in what order. PURE; the
 * database half is lib/reelStore.ts.
 *
 * TWO SOURCES, DATA FIRST. Pages other people saved AND COOKED, ranked by
 * how many distinct accounts cooked them and then by the share of thumbs-up
 * among their ratings; then the owner's curated list fills whatever slots
 * the data leaves (reel_entries, status 'curated').
 *
 * THE PRIVACY RULES ARE THE SEARCH SUGGESTIONS' RULES (lib/searchLibrary.ts),
 * and this file reuses them rather than restating them:
 *  - only pages read from a URL: a candidate must have a cache row found by
 *    URL whose tree carries a sourceUrl. A paste, a photo and a page the
 *    phone's browser handed over are cached under their CONTENT with no
 *    sourceUrl, so no URL lookup can reach them;
 *  - only public-looking addresses (`surfaceableUrl`);
 *  - usage is counted per ACCOUNT, signed-in accounts only, removed recipes
 *    excluded, and said aloud only above its floor;
 *  - nothing about any person leaves: a card carries a URL, a title, a
 *    site, a stated time, a meal type, the page's own summary (servings,
 *    steps, first ingredients), counts above their floors, the page's
 *    picture as the server stored it, and its kind.
 *
 * NEVER RAW EVENT COUNTS. An account that cooked a recipe forty times counts
 * once, so no one account can lift a page into everyone's reel.
 *
 * THE MINIMUMS ARE PROVISIONAL (ROADMAP, "Starter recipes reel"): chosen
 * before there was data to choose them from, to be revisited once there is.
 */

import { hasStepSources, keyIngredients, primaryMealType, recipeTotalMinutes, sanitizeMealTypes, stepCount, validateRecipe, type MealType, type Recipe } from "@workspace/recipe-model";
import { normalizeUrl } from "./urlKey";
import { surfaceableUrl } from "./searchLibrary";

export const REEL = {
  /** Distinct accounts that must have cooked a page before it is offered. */
  minCookedBy: 3,
  /** Ratings a page needs before its thumbs-up share is used, or shown. */
  minRatings: 5,
  /** With that many ratings, a page under this share of 👍 is not offered. */
  minLovedShare: 0.6,
  maxCards: 10,
  /** Fewer cards than this and there is no reel at all (decided Oct 1): one
   *  or two cards read as a broken row, and two never fill a phone's width,
   *  so the ticker would not even run. The phone hides on an empty list. */
  minCards: 3,
  /** Data candidates to look up in the cache, best first: enough to fill
   *  the reel when some turn out uncached or unclean. */
  candidateLimit: 30,
} as const;

export const HEADING_CURATED = "Try one of these";
export const HEADING_LOVED = "Loved by Reduction users";

/** One saved recipe, as the aggregation sees it: never more than this. */
export interface UsageRow {
  url: string;
  userId: string;
  cooked: boolean;
  /** 1 = 👍; anything else is a rating that is not 👍; null = not rated. */
  rating: number | null;
}

export interface PageUsage {
  /** The page's normalised address (what the cache's alias looks up). */
  url: string;
  cookedBy: number;
  rated: number;
  loved: number;
}

/**
 * Per page (by normalised URL), DISTINCT accounts that cooked it and that
 * rated it. One account's many rows of the same page count once; its
 * rating is its latest non-null one seen.
 */
export function usageByPage(rows: UsageRow[]): Map<string, PageUsage> {
  const pages = new Map<string, { url: string; cooked: Set<string>; ratings: Map<string, number> }>();
  for (const r of rows) {
    // Counted under the page's normalised address, as search counts it: a
    // copy saved from a link with tracking tokens is the same page. It is
    // the PAGE that must look public, not every spelling it was saved from.
    const key = normalizeUrl(r.url);
    if (!key || !surfaceableUrl(key)) continue;
    const p = pages.get(key) ?? { url: key, cooked: new Set<string>(), ratings: new Map<string, number>() };
    if (r.cooked) p.cooked.add(r.userId);
    if (r.rating !== null) p.ratings.set(r.userId, r.rating);
    pages.set(key, p);
  }
  const out = new Map<string, PageUsage>();
  for (const [key, p] of pages) {
    let loved = 0;
    for (const v of p.ratings.values()) if (v === 1) loved++;
    out.set(key, { url: p.url, cookedBy: p.cooked.size, rated: p.ratings.size, loved });
  }
  return out;
}

/** May this page be offered on the strength of its data? */
export function qualifies(u: PageUsage): boolean {
  if (u.cookedBy < REEL.minCookedBy) return false;
  if (u.rated >= REEL.minRatings && u.loved / u.rated < REEL.minLovedShare) return false;
  return true;
}

/** The share of 👍 when it may be used, else null. */
export const lovedShare = (u: PageUsage): number | null => (u.rated >= REEL.minRatings ? u.loved / u.rated : null);

/** Qualifying pages, best first: distinct cooks, then 👍 share (a page
 *  without enough ratings ranks after one with them at the same cooks),
 *  then the URL so the order never depends on the database's. */
export function rankPages(usage: Map<string, PageUsage>): PageUsage[] {
  return [...usage.values()].filter(qualifies).sort((a, b) => {
    if (b.cookedBy !== a.cookedBy) return b.cookedBy - a.cookedBy;
    const sa = lovedShare(a) ?? -1;
    const sb = lovedShare(b) ?? -1;
    if (sb !== sa) return sb - sa;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });
}

/** What a data-backed card may say, each number only above its floor:
 *  distinct accounts that cooked it, and distinct accounts whose latest
 *  rating is 👍 once enough have rated it to mean something. */
export function reelUsage(u: PageUsage | undefined): { cookedBy: number | null; likes: number | null } {
  if (!u) return { cookedBy: null, likes: null };
  return {
    cookedBy: u.cookedBy >= REEL.minCookedBy ? u.cookedBy : null,
    likes: lovedShare(u) !== null ? u.loved : null,
  };
}

/** The same, as one line ("Cooked by 10 people · 25 likes"), or null below
 *  every floor. Kept for the app versions that show only this line. */
export function reelUsageLine(u: PageUsage | undefined): string | null {
  const { cookedBy, likes } = reelUsage(u);
  const parts: string[] = [];
  if (cookedBy !== null) parts.push(`Cooked by ${cookedBy} ${cookedBy === 1 ? "person" : "people"}`);
  if (likes !== null) parts.push(`${likes} ${likes === 1 ? "like" : "likes"}`);
  return parts.length ? parts.join(" · ") : null;
}

export interface ReelCard {
  url: string;
  title: string;
  site: string;
  /** Stated by the source, never computed; null shows no time. */
  totalMinutes: number | null;
  mealType: MealType | null;
  /** The book page's summary lines (recipe-model summary.ts). */
  servings: number | null;
  steps: number;
  ingredients: string[];
  moreIngredients: number;
  usage: string | null;
  cookedBy: number | null;
  likes: number | null;
  /** The page's picture as the SERVER stored it (`/api/reel/photo/…`), or
   *  null — set by lib/reelStore.ts, never from anyone's recipe_photos. */
  photo: string | null;
  kind: "data" | "curated";
}

const siteOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * A card from a cached tree, or null when it is not clean: no sourceUrl
 * (not a URL extraction), a non-public address, a tree that fails
 * validateRecipe, or no title. The URL offered is the one the tree was read
 * from, so the tap is the same cache hit.
 */
export function cardFrom(recipe: Recipe | null, kind: ReelCard["kind"], usage: PageUsage | undefined): ReelCard | null {
  if (!recipe) return null;
  const r = recipe as Recipe & { sourceUrl?: string | null; source?: string | null; mealTypes?: unknown };
  const url = r.sourceUrl;
  if (!url || !surfaceableUrl(url)) return null;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;
  if (validateRecipe(recipe).length) return null;
  const { names, more } = keyIngredients(recipe);
  const counts = kind === "data" ? reelUsage(usage) : { cookedBy: null, likes: null };
  return {
    url,
    title,
    site: (typeof r.source === "string" && r.source.trim()) || siteOf(url),
    totalMinutes: recipeTotalMinutes(recipe),
    mealType: primaryMealType(sanitizeMealTypes(r.mealTypes)),
    servings: typeof r.servings === "number" && r.servings > 0 ? r.servings : null,
    steps: stepCount(recipe),
    ingredients: names,
    moreIngredients: more,
    usage: kind === "data" ? reelUsageLine(usage) : null,
    ...counts,
    photo: null,
    kind,
  };
}

export interface Reel {
  heading: string;
  cards: ReelCard[];
}

/**
 * Data cards first, curated to fill, one card per page, hidden pages never,
 * at most `REEL.maxCards`. The heading claims "Loved" only when every card
 * is data-backed AND clears the ratings floor — a page three people cooked
 * and nobody rated has not been shown to be loved.
 */
export function assembleReel(
  data: Array<{ card: ReelCard; usage: PageUsage }>,
  curated: ReelCard[],
  hidden: ReadonlySet<string>
): Reel {
  const cards: ReelCard[] = [];
  const seen = new Set<string>();
  const loved: boolean[] = [];
  const add = (card: ReelCard, isLoved: boolean) => {
    const key = normalizeUrl(card.url) ?? card.url;
    if (seen.has(key) || hidden.has(key) || cards.length >= REEL.maxCards) return;
    seen.add(key);
    cards.push(card);
    loved.push(isLoved);
  };
  for (const d of data) add(d.card, lovedShare(d.usage) !== null);
  for (const c of curated) add(c, false);
  const allLoved = cards.length > 0 && cards.every((c) => c.kind === "data") && loved.every(Boolean);
  return { heading: allLoved ? HEADING_LOVED : HEADING_CURATED, cards };
}

let minCardsOverride: number | null = null;
/** The minimum in force: REEL.minCards, or what a test set. */
export const reelMinCards = (): number => minCardsOverride ?? REEL.minCards;
/** Test seam: most database tests build reels of two cards on purpose. */
export function setReelMinCardsForTests(n: number | null): void {
  minCardsOverride = n;
}

/** Below the minimum the reel is withheld whole — the cards come back as
 *  `withheld`, for the admin preview to say what is waiting. */
export function withMinimum(reel: Reel, min: number = reelMinCards()): { reel: Reel; withheld: ReelCard[] } {
  if (reel.cards.length >= min) return { reel, withheld: [] };
  return { reel: { heading: reel.heading, cards: [] }, withheld: reel.cards };
}

/** What a warm-up flags on a cached tree: the features it predates. */
export function staleFlags(recipe: Recipe, hasOriginal: boolean): string[] {
  const flags: string[] = [];
  if (!hasStepSources(recipe)) flags.push("no_step_order");
  if (!("image" in (recipe as object))) flags.push("no_picture");
  if (!hasOriginal) flags.push("no_original_wording");
  return flags;
}
