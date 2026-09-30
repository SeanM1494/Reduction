import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_RECIPE_LINE, parseReel, reelA11yLabel, reelMeta, reelVisible, savedCounter, tapCounter, usesFreeRecipe } from './reelView';

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
