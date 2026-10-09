/**
 * stars.ts — a recipe's five-star rating, and how it relates to the three-way
 * rating (👎 -1, 👌 0, 👍 1) that every earlier build wrote.
 *
 * TWO FIELDS, ONE OPINION. `stars` (1-5, or null) is what the person set.
 * `rating` is the older -1/0/1 column, kept for two readers that predate
 * stars and must not break: an app build that has not updated, and the
 * server's "loved" counts (starter reel, search). The server writes `rating`
 * FROM `stars` on every stars write (`ratingFromStars`), so those readers
 * keep seeing a coherent answer; an old build writing `rating` alone
 * clears `stars`, because it just said something newer.
 *
 * NOTHING IS REWRITTEN. A recipe rated before stars has `stars = null` and a
 * `rating`; `starsOf` SHOWS it as stars (👍 5, 👌 3, 👎 1). It gets a real
 * `stars` value only when its owner taps one. No migration, no backfill.
 *
 * Whole stars on purpose: ten half-star targets across a phone are under
 * 44px each, and half-star distinctions are noise in a personal box.
 */

export const STARS_MAX = 5;

/** At or above this a recipe is "top rated": the filter, the card badge, and
 *  a 👍 in the server's counts. */
export const STARS_TOP = 4;

/** At or below this a recipe sorts to the back of its book and a fresh rating
 *  this low asks "take it out of your box?" (it used to be exactly 👎). */
export const STARS_BACK = 2;

export const isValidStars = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= STARS_MAX);

/** The legacy value that stands for a star count, for the readers above. */
export function ratingFromStars(stars: number | null): -1 | 0 | 1 | null {
  if (stars === null) return null;
  return stars >= STARS_TOP ? 1 : stars <= STARS_BACK ? -1 : 0;
}

/** How a pre-stars rating is shown. */
export function starsFromRating(rating: number | null | undefined): number | null {
  return rating === 1 ? 5 : rating === 0 ? 3 : rating === -1 ? 1 : null;
}

/** The stars to show and sort by: the person's own, else the old rating's. */
export function starsOf(e: { stars?: number | null; rating?: number | null }): number | null {
  return typeof e.stars === "number" && isValidStars(e.stars) ? e.stars : starsFromRating(e.rating);
}

export const isTopRated = (e: { stars?: number | null; rating?: number | null }): boolean =>
  (starsOf(e) ?? 0) >= STARS_TOP;

export const isBackOfBook = (e: { stars?: number | null; rating?: number | null }): boolean => {
  const s = starsOf(e);
  return s !== null && s <= STARS_BACK;
};

export const STAR_WORDS: Record<number, string> = {
  1: "Not for me",
  2: "Meh",
  3: "It was fine",
  4: "Really good",
  5: "Loved it",
};

/** "★★★★☆", for places that cannot draw stars (accessibility labels use
 *  `starsLabel`). */
export const starsGlyphs = (stars: number | null): string =>
  stars === null ? "" : "★".repeat(stars) + "☆".repeat(STARS_MAX - stars);

export const starsLabel = (stars: number | null): string =>
  stars === null ? "not rated" : `rated ${stars} ${stars === 1 ? "star" : "stars"}`;

/**
 * What a PATCH body's rating fields write, in one place for both routes.
 * `stars` wins when present and derives `rating`; a `rating` alone (an app
 * build that predates stars) is newer than any stars the row holds, so it
 * clears them. Neither present: nothing to write.
 */
export function ratingWrite(body: {
  stars?: number | null;
  rating?: number | null;
}): { stars?: number | null; rating?: number | null } {
  if (body.stars !== undefined) return { stars: body.stars, rating: ratingFromStars(body.stars) };
  if (body.rating !== undefined) return { rating: body.rating, stars: null };
  return {};
}

/** The two fields a client writes together when the person sets stars, so the
 *  local entry never shows a `rating` that disagrees with its `stars`. */
export const starsPatch = (stars: number | null): { stars: number | null; rating: -1 | 0 | 1 | null } => ({
  stars,
  rating: ratingFromStars(stars),
});
