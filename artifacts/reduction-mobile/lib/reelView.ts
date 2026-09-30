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
  /** "Cooked by 5 people · 90% loved it", only above its floors. */
  usage: string | null;
  kind: 'data' | 'curated';
}

export interface ReelResponse {
  heading: string | null;
  cards: ReelCard[];
}

export const EMPTY_REEL: ReelResponse = { heading: null, cards: [] };

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
      usage: typeof c.usage === 'string' && c.usage ? c.usage : null,
      kind: c.kind === 'data' ? 'data' : 'curated',
    });
  }
  return { heading: cards.length && typeof body.heading === 'string' ? body.heading : null, cards };
}

/** VoiceOver: "Title, site" — the role adds "button". */
export const reelA11yLabel = (c: ReelCard): string => (c.site ? `${c.title}, ${c.site}` : c.title);

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
