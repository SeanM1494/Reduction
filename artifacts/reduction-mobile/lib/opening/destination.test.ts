import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchLanding, restoreBookIndex } from './destination';

const base = { enabled: true, signedIn: true, coldStart: true, source: 'normal' as const };

test('a signed-in cold start lands on the Recipe Box', () => {
  assert.equal(launchLanding(base), 'recipe-box');
});

test('signed out stays on the demo', () => {
  assert.equal(launchLanding({ ...base, signedIn: false }), 'stay');
});

test('a notification tap or a link goes where it points', () => {
  assert.equal(launchLanding({ ...base, source: 'notification' }), 'stay');
  assert.equal(launchLanding({ ...base, source: 'link' }), 'stay');
  assert.equal(launchLanding({ ...base, source: 'share' }), 'stay');
});

test('a return from the background keeps the screen that was open', () => {
  assert.equal(launchLanding({ ...base, coldStart: false }), 'stay');
});

test('the switch restores Find', () => {
  assert.equal(launchLanding({ ...base, enabled: false }), 'stay');
});

test('the last-open book is found by id wherever it has moved', () => {
  assert.equal(restoreBookIndex(['a', 'b', 'c'], 'c'), 2);
  assert.equal(restoreBookIndex(['c', 'a', 'b'], 'c'), 0);
});

test('a book that no longer exists, or none stored: the first book', () => {
  assert.equal(restoreBookIndex(['a', 'b'], 'gone'), 0);
  assert.equal(restoreBookIndex(['a', 'b'], null), 0);
  assert.equal(restoreBookIndex([], 'a'), 0);
});

test('links into the app are told apart from launches that only carry a URL', async () => {
  const { isAppLink } = await import('./destination');
  const S = 'reduction-mobile';
  assert.equal(isAppLink(null, S), false);
  assert.equal(isAppLink('reduction-mobile://', S), false);
  assert.equal(isAppLink('reduction-mobile:///', S), false);
  assert.equal(isAppLink('reduction-mobile://auth?code=x', S), false, 'the sign-in return');
  assert.equal(isAppLink('exp+reduction-mobile://expo-development-client/?url=http%3A%2F%2F10.0.0.2', S), false, 'the dev client');
  assert.equal(isAppLink('reduction-mobile://recipe/abc', S), true);
  assert.equal(isAppLink('reduction-mobile://library', S), true);
  assert.equal(isAppLink('https://recipe-reduction.replit.app/recipe/abc', S), true);
  assert.equal(isAppLink('otherapp://recipe/abc', S), false);
});
