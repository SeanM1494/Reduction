import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_METRICS,
  FREE_RECIPE_LINE,
  TICKER,
  cardWidth,
  parseReel,
  reelA11yLabel,
  reelCardSize,
  reelMeta,
  reelVisible,
  savedCounter,
  tapCounter,
  tickerLoops,
  tickerOn,
  tickerStep,
  cookedLine,
  likesBadge,
  usageSpoken,
  usesFreeRecipe,
  siteLink,
  openSiteActionLabel,
} from './reelView';

const card = { url: 'https://a.example.com/r', title: 'Weeknight Chili', site: 'Example Recipes', totalMinutes: 45, mealType: 'dinner', usage: null, kind: 'curated' };

test('parseReel keeps the promised shape and drops anything else', () => {
  const r = parseReel({ heading: 'Try one of these', cards: [card, { url: 'x' }, { ...card, title: '  ' }, { ...card, userId: 'u-1', kind: 'data' }] });
  assert.equal(r.cards.length, 2);
  assert.equal(r.heading, 'Try one of these');
  assert.equal('userId' in r.cards[1], false, 'nothing extra is carried through');
  assert.deepEqual(parseReel(null), { heading: null, cards: [] });
  assert.deepEqual(parseReel({ heading: 'X', cards: [] }), { heading: null, cards: [] }, 'no cards, no heading');
});

test('VoiceOver reads "Title, site" and the role adds "button"', () => {
  assert.equal(reelA11yLabel(parseReel({ cards: [card] }).cards[0]), 'Weeknight Chili, Example Recipes');
});

test('the site credit links to the page itself, and only to a web address', () => {
  const [c] = parseReel({ cards: [card] }).cards;
  assert.equal(siteLink(c), 'https://a.example.com/r');
  assert.equal(siteLink({ ...c, url: 'javascript:alert(1)' }), null);
  assert.equal(siteLink({ ...c, url: 'not a url' }), null);
  assert.equal(openSiteActionLabel(c), 'Open Example Recipes');
  assert.equal(openSiteActionLabel({ ...c, site: '' }), 'Open the recipe’s page');
});

test('a card shows its site and a time only when one was stated', () => {
  const [withTime, noTime] = parseReel({ cards: [card, { ...card, totalMinutes: null }] }).cards;
  assert.match(reelMeta(withTime), /^Example Recipes · 45/);
  assert.equal(reelMeta(noTime), 'Example Recipes');
});

test('the reel hides with no cards, while the keyboard is up, and during an extraction', () => {
  const reel = parseReel({ heading: 'H', cards: [card] });
  assert.equal(reelVisible(reel, { keyboardUp: false, busy: false }), true);
  assert.equal(reelVisible(reel, { keyboardUp: true, busy: false }), false);
  assert.equal(reelVisible(reel, { keyboardUp: false, busy: true }), false);
  assert.equal(reelVisible(parseReel({ cards: [] }), { keyboardUp: false, busy: false }), false);
});

test('"Saving this uses your free recipe" only for an account with a free recipe to spend', () => {
  assert.equal(FREE_RECIPE_LINE, 'Saving this uses your free recipe.');
  assert.equal(usesFreeRecipe({ subscribed: false, allowance: 1, used: 0 }), true);
  assert.equal(usesFreeRecipe({ subscribed: true, allowance: 1, used: 0 }), false);
  assert.equal(usesFreeRecipe({ subscribed: false, allowance: 1, used: 1 }), false);
  assert.equal(usesFreeRecipe(null), false);
});

test('the counters name the kind of card, from the server allow-list', () => {
  assert.deepEqual([tapCounter('data'), tapCounter('curated'), savedCounter('data'), savedCounter('curated')], [
    'reel_tap_data',
    'reel_tap_curated',
    'reel_saved_data',
    'reel_saved_curated',
  ]);
});

test('parseReel carries the page summary, the counts and our own picture path — never a site\'s address', () => {
  const [c] = parseReel({
    cards: [{ ...card, servings: 12, steps: 8, ingredients: ['butter', 'eggs', 7, 'vanilla', 'x'], moreIngredients: 5, cookedBy: 10, likes: 25, photo: '/api/reel/photo/abc?v=2' }],
  }).cards;
  assert.deepEqual([c.servings, c.steps, c.ingredients, c.moreIngredients, c.cookedBy, c.likes, c.photo], [12, 8, ['butter', 'eggs', 'vanilla'], 5, 10, 25, '/api/reel/photo/abc?v=2']);
  const [site] = parseReel({ cards: [{ ...card, photo: 'https://tracker.example.com/pixel.jpg', servings: -2, likes: 1.5 }] }).cards;
  assert.deepEqual([site.photo, site.servings, site.likes], [null, null, null]);
  const [old] = parseReel({ cards: [card] }).cards;
  assert.deepEqual([old.steps, old.ingredients, old.photo], [null, [], null], 'a server from before Sep 30');
});

test('use: likes as a badge on the picture, cooks as the footer line, the old joined line from an older server', () => {
  assert.equal(likesBadge({ likes: 25 }), '👍 25');
  assert.equal(likesBadge({ likes: null }), null);
  assert.equal(cookedLine({ cookedBy: 10, likes: 25, usage: 'x' }), 'Cooked by 10 people');
  assert.equal(cookedLine({ cookedBy: null, likes: 5, usage: 'x' }), null, 'the likes are on the badge already');
  assert.equal(cookedLine({ cookedBy: null, likes: null, usage: 'Cooked by 3 people' }), 'Cooked by 3 people');
  assert.equal(cookedLine({ cookedBy: null, likes: null, usage: null }), null);
  assert.equal(usageSpoken({ cookedBy: 10, likes: 1, usage: null }), 'Cooked by 10 people, 1 like');
  const [c] = parseReel({ cards: [{ ...card, kind: 'data', cookedBy: 10, likes: 25 }] }).cards;
  assert.equal(reelA11yLabel(c), 'Weeknight Chili, Example Recipes, Cooked by 10 people, 25 likes', 'VoiceOver hears what the badge shows');
});

test('a card is as tall as the room it is given, between a floor and the height that shows everything', () => {
  const rows = { time: true, usage: false };
  const at = (available: number, w = 390) => reelCardSize(available, w, rows);
  const floor = at(0);
  const full = at(10_000);
  assert.equal(floor.fits, false, 'no room: the smallest card, and the page scrolls');
  assert.equal(floor.photoHeight, CARD_METRICS.minPhoto);
  assert.deepEqual([floor.showServes, floor.ingredientLines], [false, 0]);
  assert.equal(at(floor.height).fits, true);
  assert.deepEqual([full.showServes, full.ingredientLines], [true, 2]);
  assert.equal(full.photoHeight, Math.round(full.width * 0.75), 'the picture stops at 4:3');
  assert.equal(at(full.height + 200).height, full.height, 'never taller than what it shows');
  for (let h = floor.height; h <= full.height; h += 3) {
    const s = at(h);
    assert.ok(s.height <= h, `fits the room it was given (${h})`);
    assert.ok(s.photoHeight >= CARD_METRICS.minPhoto);
  }
  // Rows arrive in order as the room grows: serves before any ingredients.
  const seen = [];
  for (let h = floor.height; h <= full.height; h++) seen.push(`${at(h).showServes}/${at(h).ingredientLines}`);
  const order = [...new Set(seen)];
  assert.deepEqual(order, ['false/0', 'true/0', 'true/1', 'true/2']);
  // A card with a usage pill and no time line budgets for what it shows.
  assert.equal(reelCardSize(10_000, 390, { time: false, usage: true }).height - full.height, CARD_METRICS.usageLine - CARD_METRICS.time);
});

test('about 2.3 cards across: an SE gets the narrow card, a big phone a capped one', () => {
  assert.equal(cardWidth(320), 136);
  assert.equal(cardWidth(390), 164);
  assert.equal(cardWidth(430), 181);
  assert.equal(cardWidth(1024), 190);
});

test('the ticker: off under Reduce Motion or VoiceOver, off screen, and with too few cards to loop', () => {
  const on = { reduceMotion: false, screenReader: false, focused: true, loops: true };
  assert.equal(tickerOn(on), true);
  assert.equal(tickerOn({ ...on, reduceMotion: true }), false);
  assert.equal(tickerOn({ ...on, screenReader: true }), false);
  assert.equal(tickerOn({ ...on, focused: false }), false);
  assert.equal(tickerOn({ ...on, loops: false }), false);
  assert.equal(tickerLoops(4, 164, 390), true);
  assert.equal(tickerLoops(2, 164, 390), false, 'two cards fit on screen: nothing to drift to');
  assert.equal(tickerLoops(1, 400, 390), false);
});

test('the ticker drifts at its speed, wraps by exactly one set, and tolerates a stalled frame', () => {
  assert.equal(TICKER.resumeAfterMs, 5000);
  assert.ok(Math.abs(tickerStep(0, 50, 700, TICKER.speed) - TICKER.speed / 20) < 1e-9, 'speed is points a second');
  assert.ok(Math.abs(tickerStep(699, 100, 700, TICKER.speed) - (699 + TICKER.speed / 10 - 700)) < 1e-9, 'past the first set, the second is in the same place');
  assert.equal(tickerStep(1450, 16, 700, TICKER.speed), (1450 + (TICKER.speed * 16) / 1000) % 700, 'a hand-scroll into the second set wraps too');
  assert.equal(tickerStep(10, 5000, 700, TICKER.speed), 10 + (TICKER.speed * 100) / 1000, 'a frame after a stall moves at most 100ms worth');
  assert.equal(tickerStep(10, -5, 700, TICKER.speed), 10);
  assert.equal(tickerStep(10, 16, 0, TICKER.speed), 10, 'no period, no drift');
});

// ---- Oct 1: the reel must never take Find down, whatever the server sends.

const OLD_SHAPE = {
  heading: 'Try one of these',
  cards: [
    { url: 'https://a.example/x', title: 'Gumbo', site: 'a.example', totalMinutes: 90, mealType: 'dinner', usage: 'Cooked by 3 people', kind: 'data' },
    { url: 'https://b.example/y', title: 'Pot Pies', site: 'b.example', totalMinutes: null, mealType: null, usage: null, kind: 'curated' },
  ],
};

test('an older server (no summary, counts or picture) still gives whole cards with safe defaults', () => {
  const r = parseReel(OLD_SHAPE);
  assert.equal(r.cards.length, 2);
  for (const c of r.cards) {
    assert.equal(c.servings, null);
    assert.equal(c.steps, null);
    assert.deepEqual(c.ingredients, []);
    assert.equal(c.moreIngredients, 0);
    assert.equal(c.cookedBy, null);
    assert.equal(c.likes, null);
    assert.equal(c.photo, null);
  }
  assert.equal(cookedLine(r.cards[0]), 'Cooked by 3 people', 'the old joined line still shows');
});

test('malformed and partial responses never throw and never produce a half card', () => {
  const bodies: unknown[] = [
    undefined, null, 0, 'oops', [], {}, { cards: null }, { cards: 'x' }, { cards: {} }, { heading: 7, cards: [] },
    { cards: [null, undefined, 0, 'card', [], {}, { url: 5, title: 'x' }, { url: 'u', title: '' }, { url: 'u', title: '   ' }, { url: 'u' }] },
  ];
  for (const b of bodies) {
    const r = parseReel(b);
    assert.ok(Array.isArray(r.cards) && r.cards.length === 0, `no cards from ${JSON.stringify(b)}`);
    assert.equal(r.heading, null);
  }
  const wild = parseReel({
    heading: 'Try one of these',
    cards: [{
      url: 'https://c.example/z', title: 'Wild', site: 42, totalMinutes: 'soon', mealType: 9, servings: -4, steps: 2.5,
      ingredients: ['a', 3, null, '', '  ', 'b', 'c', 'd'], moreIngredients: NaN, usage: 12, cookedBy: '10', likes: Infinity,
      photo: 'https://evil.example/p.jpg', kind: 'other',
    }],
  });
  const c = wild.cards[0];
  assert.deepEqual(
    { site: c.site, totalMinutes: c.totalMinutes, mealType: c.mealType, servings: c.servings, steps: c.steps, ingredients: c.ingredients, more: c.moreIngredients, usage: c.usage, cookedBy: c.cookedBy, likes: c.likes, photo: c.photo, kind: c.kind },
    { site: '', totalMinutes: null, mealType: null, servings: null, steps: null, ingredients: ['a', 'b', 'c'], more: 0, usage: null, cookedBy: null, likes: null, photo: null, kind: 'curated' }
  );
  // Every helper a card is drawn through accepts the defaulted card.
  assert.equal(reelMeta(c), '');
  assert.equal(likesBadge(c), null);
  assert.equal(cookedLine(c), null);
  assert.equal(usageSpoken(c), null);
  assert.equal(reelA11yLabel(c), 'Wild');
});

test('a card size is finite for any room it is given, including none and nonsense', () => {
  for (const room of [Number.POSITIVE_INFINITY, Number.NaN, -100, 0, 1e9]) {
    for (const w of [0, 320, 430]) {
      const s = reelCardSize(room, w, { time: true, usage: true });
      for (const v of [s.width, s.height, s.photoHeight]) assert.ok(Number.isFinite(v) && v > 0, `${room}/${w}: ${JSON.stringify(s)}`);
    }
  }
});
