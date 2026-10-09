import test from "node:test";
import assert from "node:assert/strict";
import {
  STARS_BACK,
  STARS_TOP,
  isBackOfBook,
  isTopRated,
  isValidStars,
  ratingFromStars,
  ratingWrite,
  starsFromRating,
  starsGlyphs,
  starsLabel,
  starsOf,
  starsPatch,
} from "./stars";
import { mergeEntry, type SyncableEntry } from "./sync";

test("isValidStars: whole 1-5 or null, nothing else", () => {
  for (const ok of [null, 1, 2, 3, 4, 5]) assert.equal(isValidStars(ok), true, String(ok));
  for (const bad of [0, 6, -1, 2.5, "4", true, undefined, NaN, Infinity, [], {}]) assert.equal(isValidStars(bad), false, String(bad));
});

test("the derived rating: 4-5 loved, 3 fine, 1-2 not for me; null stays null", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(ratingFromStars), [-1, -1, 0, 1, 1]);
  assert.equal(ratingFromStars(null), null);
  assert.equal(STARS_TOP, 4);
  assert.equal(STARS_BACK, 2);
});

test("an old rating is SHOWN as stars (5/3/1) and a real value wins", () => {
  assert.equal(starsFromRating(1), 5);
  assert.equal(starsFromRating(0), 3);
  assert.equal(starsFromRating(-1), 1);
  assert.equal(starsFromRating(null), null);
  assert.equal(starsFromRating(7), null);
  assert.equal(starsOf({ rating: 1 }), 5);
  assert.equal(starsOf({ rating: 1, stars: 4 }), 4, "the person's own count beats the mapped one");
  assert.equal(starsOf({ rating: null, stars: null }), null);
  assert.equal(starsOf({ stars: 9, rating: 0 }), 3, "a junk stars value is ignored, not trusted");
  assert.equal(starsOf({}), null);
});

test("top rated and back of the book follow the shown stars", () => {
  assert.equal(isTopRated({ rating: 1 }), true, "an old 👍");
  assert.equal(isTopRated({ stars: 4, rating: 1 }), true);
  assert.equal(isTopRated({ stars: 3, rating: 0 }), false);
  assert.equal(isTopRated({}), false);
  assert.equal(isBackOfBook({ rating: -1 }), true, "an old 👎");
  assert.equal(isBackOfBook({ stars: 2, rating: -1 }), true);
  assert.equal(isBackOfBook({ stars: 3, rating: 0 }), false);
  assert.equal(isBackOfBook({}), false, "unrated is not the back");
});

test("ratingWrite: stars decide and derive; a lone rating clears stars; nothing, nothing", () => {
  assert.deepEqual(ratingWrite({ stars: 5 }), { stars: 5, rating: 1 });
  assert.deepEqual(ratingWrite({ stars: null }), { stars: null, rating: null });
  assert.deepEqual(ratingWrite({ stars: 2, rating: 1 }), { stars: 2, rating: -1 });
  assert.deepEqual(ratingWrite({ rating: 0 }), { rating: 0, stars: null });
  assert.deepEqual(ratingWrite({}), {});
  assert.deepEqual(starsPatch(3), { stars: 3, rating: 0 });
});

test("labels", () => {
  assert.equal(starsGlyphs(4), "★★★★☆");
  assert.equal(starsGlyphs(null), "");
  assert.equal(starsLabel(1), "rated 1 star");
  assert.equal(starsLabel(5), "rated 5 stars");
  assert.equal(starsLabel(null), "not rated");
});

// ------------------------------------------------------------------ merge --

const recipe = {
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
} as unknown as SyncableEntry["recipe"];

const entry = (stars: number | null, rating: number | null = ratingFromStars(stars)): SyncableEntry => ({
  recipe,
  done: [],
  servings: null,
  mode: "diagram",
  timer: null,
  rating,
  stars,
});

test("merge: stars follow the same rule as rating, and rating never disagrees with them", () => {
  const base = entry(3);
  // Only theirs changed.
  let m = mergeEntry(base, base, entry(5)).merged;
  assert.equal(m.stars, 5);
  assert.equal(m.rating, 1);
  // Only mine changed (cleared).
  m = mergeEntry(base, entry(null), base).merged;
  assert.equal(m.stars, null);
  assert.equal(m.rating, null);
  // Both changed: mine wins, and rating is derived from the winner.
  m = mergeEntry(base, entry(1), entry(5)).merged;
  assert.equal(m.stars, 1);
  assert.equal(m.rating, -1);
});

test("merge: an old build's lone rating (which cleared stars) beats an unchanged side", () => {
  const base = entry(5);
  const theirs = entry(null, -1); // the server's row after an old build wrote 👎
  const m = mergeEntry(base, base, theirs).merged;
  assert.equal(m.stars, null);
  assert.equal(m.rating, -1);
});

test("merge: a device that has never heard of stars (no key at all) never erases them", () => {
  const old = { ...entry(null) } as Partial<SyncableEntry>;
  delete old.stars;
  const m = mergeEntry(old as SyncableEntry, old as SyncableEntry, entry(4)).merged;
  assert.equal(m.stars, 4);
  assert.equal(m.rating, 1);
});
