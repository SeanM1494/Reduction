/**
 * lib/libraryView.test.ts — the library's filter and sort, under plain node.
 *
 * PURE NODE, NO REACT NATIVE: this file and lib/libraryView.ts import only
 * the model package, which is what lets scripts/run-tests.mjs run them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeLibrary,
  hasFavourites,
  hasUntagged,
  presentMealTypes,
  progressOf,
  totalMinutes,
  type LibraryItem,
} from './libraryView';

const item = (over: Partial<LibraryItem> & { id: string }): LibraryItem & { id: string } => ({
  savedAt: 0,
  recipe: {},
  ...over,
});

const timed = (...minutes: Array<unknown>) => ({
  sections: [{ nodes: minutes.map((m) => ({ minutes: m })) }],
});

test('totalMinutes sums step minutes and is null when nothing is timed', () => {
  assert.equal(totalMinutes(item({ id: 'a', recipe: timed(10, 25) })), 35);
  assert.equal(totalMinutes(item({ id: 'b', recipe: timed(undefined, null) })), null);
  // A string minute is not a number and contributes nothing — stepMinutes
  // owns that guard, so "12 min" can never reach the sum as NaN.
  assert.equal(totalMinutes(item({ id: 'c', recipe: timed('12', 3) })), 3);
});

test('recently added is the default order and untimed sorts last by time', () => {
  const lib = [
    item({ id: 'old', savedAt: 1, recipe: timed(5) }),
    item({ id: 'new', savedAt: 3, recipe: {} }),
    item({ id: 'mid', savedAt: 2, recipe: timed(50) }),
  ];
  assert.deepEqual(arrangeLibrary(lib, 'all', 'added').map((e) => e.id), ['new', 'mid', 'old']);
  assert.deepEqual(arrangeLibrary(lib, 'all', 'time').map((e) => e.id), ['old', 'mid', 'new']);
  // Never mutates the input.
  assert.deepEqual(lib.map((e) => e.id), ['old', 'new', 'mid']);
});

test('favourites first ranks 👍 then unrated then 👎, newest within each', () => {
  const lib = [
    item({ id: 'reject', savedAt: 9, rating: -1 }),
    item({ id: 'fav-old', savedAt: 1, rating: 1 }),
    item({ id: 'plain', savedAt: 5 }),
    item({ id: 'fav-new', savedAt: 2, rating: 1 }),
  ];
  assert.deepEqual(arrangeLibrary(lib, 'all', 'rating').map((e) => e.id), [
    'fav-new',
    'fav-old',
    'plain',
    'reject',
  ]);
  // A reject is ranked last, not hidden.
  assert.equal(arrangeLibrary(lib, 'all', 'rating').length, 4);
});

test('filters: meal type matches any tag, untagged and favourites are exact', () => {
  const lib = [
    item({ id: 'dinner', recipe: { mealTypes: ['dinner', 'lunch'] } }),
    item({ id: 'bare', recipe: {} }),
    item({ id: 'fav', rating: 1, recipe: { mealTypes: ['dessert'] } }),
    item({ id: 'junk', recipe: { mealTypes: ['not-a-type'] } }),
  ];
  const ids = (f: Parameters<typeof arrangeLibrary>[1]) =>
    arrangeLibrary(lib, f, 'added').map((e) => e.id).sort();
  assert.deepEqual(ids('lunch'), ['dinner']);
  assert.deepEqual(ids('untagged'), ['bare', 'junk']);
  assert.deepEqual(ids('favourites'), ['fav']);
  assert.deepEqual(presentMealTypes(lib), ['lunch', 'dinner', 'dessert']);
  assert.equal(hasFavourites(lib), true);
  assert.equal(hasUntagged(lib), true);
  assert.equal(hasUntagged([lib[0]]), false);
});

test('progress label: not started, a percentage, done', () => {
  assert.deepEqual(progressOf(0, 8), { pct: 0, label: 'Not started' });
  assert.deepEqual(progressOf(3, 8), { pct: 38, label: '38%' });
  assert.deepEqual(progressOf(8, 8), { pct: 100, label: 'Done' });
  assert.deepEqual(progressOf(0, 0), { pct: 0, label: 'Not started' });
});
