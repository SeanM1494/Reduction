/**
 * lib/reelView.ts — the starter reel as the phone shows it. PURE, tested.
 *
 * The server decides WHAT is in the reel (api-server lib/reel.ts: data
 * first, the owner's list to fill, the search suggestions' privacy rules)
 * and says nothing about anyone. This decides only how a card reads, when
 * the reel is on screen at all, and the one sentence a starter's preview
 * adds: that saving it uses the free recipe, which it does (ROADMAP,
 * "Starter recipes reel" — an open product question, not changed).
 */

import { formatMinutes, type MealType } from '@workspace/recipe-model';

export interface ReelCard {
  url: string;
  title: string;
  site: string;
  /** Stated by the source, never computed; null shows no time. */
  totalMinutes: number | null;
  mealType: MealType | null;
  /** The Recipe Box page's summary lines (recipe-model summary.ts, on the
   *  server). Absent from a server older than Sep 30: no serves line, no
   *  ingredients. */
  servings: number | null;
  steps: number | null;
  ingredients: string[];
  moreIngredients: number;
  /** "Cooked by 5 people · 4 likes", only above its floors. */
  usage: string | null;
  cookedBy: number | null;
  likes: number | null;
  /** The page's picture as the server stored it, a path on our server, or
   *  null for the meal-type art. */
  photo: string | null;
  kind: 'data' | 'curated';
}

export interface ReelResponse {
  heading: string | null;
  cards: ReelCard[];
}

export const EMPTY_REEL: ReelResponse = { heading: null, cards: [] };

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/** The shape the server promises, and nothing else, whatever arrives. */
export function parseReel(raw: unknown): ReelResponse {
  const body = raw as { heading?: unknown; cards?: unknown } | null;
  if (!body || !Array.isArray(body.cards)) return EMPTY_REEL;
  const cards: ReelCard[] = [];
  for (const c of body.cards as Array<Record<string, unknown>>) {
    if (typeof c?.url !== 'string' || typeof c.title !== 'string' || !c.title.trim()) continue;
    cards.push({
      url: c.url,
      title: c.title,
      site: typeof c.site === 'string' ? c.site : '',
      totalMinutes: typeof c.totalMinutes === 'number' && c.totalMinutes > 0 ? c.totalMinutes : null,
      mealType: (typeof c.mealType === 'string' ? c.mealType : null) as MealType | null,
      servings: posInt(c.servings),
      steps: posInt(c.steps),
      ingredients: Array.isArray(c.ingredients) ? c.ingredients.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 3) : [],
      moreIngredients: posInt(c.moreIngredients) ?? 0,
      usage: typeof c.usage === 'string' && c.usage ? c.usage : null,
      cookedBy: posInt(c.cookedBy),
      likes: posInt(c.likes),
      // Only a path on our own server: the phone never fetches a site.
      photo: typeof c.photo === 'string' && c.photo.startsWith('/api/reel/photo/') ? c.photo : null,
      kind: c.kind === 'data' ? 'data' : 'curated',
    });
  }
  return { heading: cards.length && typeof body.heading === 'string' ? body.heading : null, cards };
}

/** VoiceOver: "Title, site" — the role adds "button" — then the use, when
 *  there is any. */
export const reelA11yLabel = (c: ReelCard): string => {
  const use = usageSpoken(c);
  return [c.title, c.site || null, use].filter(Boolean).join(', ');
};

/** The small line under a card's title: the site, and a time only when the
 *  source stated one. */
export function reelMeta(c: ReelCard): string {
  const time = c.totalMinutes ? formatMinutes(c.totalMinutes) : null;
  return [c.site, time].filter(Boolean).join(' · ');
}

/** On screen only with cards, and never while the keyboard is up or an
 *  extraction is running — it would sit under a finger that is typing, or
 *  offer a second extraction during the first. */
export function reelVisible(reel: ReelResponse, state: { keyboardUp: boolean; busy: boolean }): boolean {
  return reel.cards.length > 0 && !state.keyboardUp && !state.busy;
}

export const FREE_RECIPE_LINE = 'Saving this uses your free recipe.';

/** Is this account on the free allowance, with a recipe still to spend? A
 *  subscriber spends nothing; an account with none left is walled (or, in
 *  shadow mode, spends nothing that can be taken back). */
export function usesFreeRecipe(ent: { subscribed: boolean; allowance: number; used: number } | null | undefined): boolean {
  return !!ent && !ent.subscribed && ent.used < ent.allowance;
}

export type ReelCounter = 'reel_shown' | 'reel_tap_data' | 'reel_tap_curated' | 'reel_saved_data' | 'reel_saved_curated';

export const tapCounter = (kind: ReelCard['kind']): ReelCounter => (kind === 'data' ? 'reel_tap_data' : 'reel_tap_curated');
export const savedCounter = (kind: ReelCard['kind']): ReelCounter => (kind === 'data' ? 'reel_saved_data' : 'reel_saved_curated');

// ------------------------------------------------------------------ usage --

/**
 * What a card says about use, each only when the server sent it (which it
 * does only above its floor). The likes go on the picture as a badge, the
 * way a Recipe Box page shows its rating; the cooks are the footer's line.
 * Joined in one pill they did not fit a phone's card ("Cooked by 10
 * people ·…", measured Sep 30).
 */
export const likesBadge = (c: Pick<ReelCard, 'likes'>): string | null => (c.likes ? `👍 ${c.likes}` : null);

export function cookedLine(c: Pick<ReelCard, 'cookedBy' | 'likes' | 'usage'>): string | null {
  if (c.cookedBy) return `Cooked by ${c.cookedBy} ${c.cookedBy === 1 ? 'person' : 'people'}`;
  // A server older than the counts sent only the joined line.
  if (!c.likes && c.usage) return c.usage;
  return null;
}

/** For VoiceOver, which cannot see the badge: "Cooked by 10 people, 25 likes". */
export function usageSpoken(c: Pick<ReelCard, 'cookedBy' | 'likes' | 'usage'>): string | null {
  const parts = [cookedLine(c), c.likes ? `${c.likes} ${c.likes === 1 ? 'like' : 'likes'}` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// ------------------------------------------------------------------ size --

/**
 * The card is as tall as the room left between the top of the cards and
 * the bottom of what the screen shows, so the reel fits WITHOUT the page
 * scrolling (decided Sep 30) — between a floor below which a card is not a
 * card, and the height at which everything is shown and the picture is at
 * its largest. Rows go in order of what they tell someone choosing a
 * recipe: title, time and the footer always; then serves and steps; then
 * the ingredients, two lines, then one; whatever is left is picture.
 *
 * The heights are the face's own (PageFace.tsx), so this is the layout the
 * face will draw, not a guess about it.
 */
export const CARD_METRICS = {
  padTop: 12,
  padBottom: 12,
  title: 8 + 2 * 18,
  time: 5 + 14,
  serves: 7 + 6 + 1 + 14,
  ingredientLine: 15.5,
  ingredientTop: 3,
  /** The footer's gap above, the cooked line (with its gap), the site line. */
  footerGap: 8,
  usageLine: 15 + 4,
  site: 15,
  minPhoto: 48,
  /** A picture wider than 4:3 of the card stops growing. */
  maxPhotoOfWidth: 0.75,
  gap: 10,
} as const;

export interface CardSize {
  width: number;
  height: number;
  photoHeight: number;
  showServes: boolean;
  ingredientLines: 0 | 1 | 2;
  /** false when even the smallest card does not fit: the page scrolls. */
  fits: boolean;
}

/** About 2.3 cards across a phone, so the row plainly continues. */
export const cardWidth = (screenWidth: number): number => Math.round(Math.min(190, Math.max(136, screenWidth * 0.42)));

export function reelCardSize(available: number, screenWidth: number, rows: { time: boolean; usage: boolean }): CardSize {
  const m = CARD_METRICS;
  const width = cardWidth(screenWidth);
  const fixed = m.padTop + m.title + (rows.time ? m.time : 0) + m.footerGap + (rows.usage ? m.usageLine : 0) + m.site + m.padBottom;
  const maxPhoto = Math.round(width * m.maxPhotoOfWidth);
  const ingredients = (n: number) => (n ? m.ingredientTop + n * m.ingredientLine : 0);
  const natural = Math.ceil(fixed + m.serves + ingredients(2) + maxPhoto);
  const floor = fixed + m.minPhoto;
  const height = Math.floor(Math.min(natural, Math.max(floor, Number.isFinite(available) ? available : floor)));
  let room = height - fixed - m.minPhoto;
  const showServes = room >= m.serves;
  if (showServes) room -= m.serves;
  // Ingredients only once the serves line is in: the rows arrive in order.
  const ingredientLines: 0 | 1 | 2 = !showServes ? 0 : room >= ingredients(2) ? 2 : room >= ingredients(1) ? 1 : 0;
  room -= ingredients(ingredientLines);
  return {
    width,
    height,
    photoHeight: Math.floor(Math.min(maxPhoto, m.minPhoto + room)),
    showServes,
    ingredientLines,
    fits: available >= floor,
  };
}

// ---------------------------------------------------------------- ticker --

/**
 * The reel drifts sideways on its own, like a ticker (decided Sep 30). Any
 * touch stops it at once; it drifts again 5s after the last touch ends,
 * from wherever it was left. It never moves under Reduce Motion or
 * VoiceOver, off screen, or with too few cards to need to.
 */
export const TICKER = {
  /** Points a second: about one card every eight seconds. */
  speed: 22,
  resumeAfterMs: 5000,
} as const;

/** Should it drift at all right now? (Not "is a finger on it": that is the
 *  pause, which the component keeps.) */
export function tickerOn(s: { reduceMotion: boolean; screenReader: boolean; focused: boolean; loops: boolean }): boolean {
  return !s.reduceMotion && !s.screenReader && s.focused && s.loops;
}

/** A loop needs one set of cards wider than the screen: then a second copy
 *  can follow it and the seam is never on screen at once. */
export const tickerLoops = (cards: number, width: number, viewport: number): boolean =>
  cards > 1 && viewport > 0 && cards * (width + CARD_METRICS.gap) > viewport;

/** One frame of drift. `period` is one set's width: at the end of the first
 *  set the second is in exactly the same place, so the offset wraps by one
 *  period and nothing on screen moves. Runs on the UI thread.
 *
 *  `speed` is REQUIRED, and must stay so: it was `speed = TICKER.speed`
 *  until Oct 1, and a worklet's default is evaluated before its closure is
 *  unpacked, so on the phone that default named a variable that did not
 *  exist and closed the app the moment Find showed the reel
 *  (workletRules.test.ts). */
export function tickerStep(offset: number, dtMs: number, period: number, speed: number): number {
  'worklet';
  if (!(period > 0)) return offset;
  const dt = Math.min(Math.max(dtMs, 0), 100);
  let next = offset + (speed * dt) / 1000;
  next %= period;
  return next < 0 ? next + period : next;
}
