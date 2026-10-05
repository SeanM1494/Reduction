/**
 * lib/rating.ts — asking for an App Store rating, and when (Oct 5). PURE,
 * so the rules below are tested; lib/ratingPrompt.ts does the storing and
 * the asking.
 *
 * Two ways in, and only these two, because Apple's 5.6.1 allows no others:
 * Apple's own prompt (SKStoreReviewController, through expo-store-review),
 * which Apple decides whether to show and caps at three a year; and a
 * "Rate Reduction" row in Settings that opens the App Store's review page
 * when someone goes looking. A popup of our own that sends people to the
 * store is exactly what the guideline forbids.
 *
 * WHEN: after a FINISHED cook (every step ticked — lib/cookCounters.ts's
 * finish, already once per cook), the second one or later, and only once
 * the person LEAVES the recipe screen. Never mid-cook, never on the first
 * cook, and at most once per app version — Apple may still decline to show
 * it, and asking again in the same version would only spend the year's
 * three on the same person.
 */

/** The App Store's numeric id for Reduction (App Store Connect › App
 *  Information › Apple ID). Null hides the Settings row: the review page
 *  does not exist until the app is live, and a wrong id would open
 *  somebody else's. */
export const APP_STORE_ID: string | null = null;

export function writeReviewUrl(id: string | null = APP_STORE_ID): string | null {
  if (!id || !/^\d+$/.test(id)) return null;
  return `https://apps.apple.com/app/id${id}?action=write-review`;
}

export interface RatingState {
  /** Finished cooks on this phone, ever. */
  cooks: number;
  /** The app version Apple's prompt was last requested in. */
  askedVersion: string | null;
}

export const EMPTY_RATING: RatingState = { cooks: 0, askedVersion: null };

/** How many finished cooks before the first ask. */
export const COOKS_BEFORE_ASKING = 2;

export function afterFinishedCook(s: RatingState): RatingState {
  return { ...s, cooks: s.cooks + 1 };
}

/** Whether to ask as the recipe screen is left. `finishedThisVisit` keeps
 *  the ask tied to a moment of success rather than to any later visit. */
export function shouldAsk(s: RatingState, version: string | null, finishedThisVisit: boolean): boolean {
  if (!finishedThisVisit || !version) return false;
  if (s.cooks < COOKS_BEFORE_ASKING) return false;
  return s.askedVersion !== version;
}

export function afterAsking(s: RatingState, version: string): RatingState {
  return { ...s, askedVersion: version };
}

/** Whatever storage held, as a state — anything unreadable is a fresh one. */
export function parseRating(raw: string | null): RatingState {
  if (!raw) return EMPTY_RATING;
  try {
    const v = JSON.parse(raw) as Partial<RatingState>;
    const cooks = typeof v.cooks === 'number' && Number.isFinite(v.cooks) && v.cooks >= 0 ? Math.floor(v.cooks) : 0;
    const askedVersion = typeof v.askedVersion === 'string' ? v.askedVersion : null;
    return { cooks, askedVersion };
  } catch {
    return EMPTY_RATING;
  }
}
