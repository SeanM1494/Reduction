import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_RATING,
  afterAsking,
  afterFinishedCook,
  parseRating,
  shouldAsk,
  writeReviewUrl,
} from './rating';

test('never on the first finished cook, then on the second', () => {
  const one = afterFinishedCook(EMPTY_RATING);
  assert.equal(shouldAsk(one, '1.3.0', true), false);
  const two = afterFinishedCook(one);
  assert.equal(shouldAsk(two, '1.3.0', true), true);
});

test('only when this visit finished a cook', () => {
  const s = { cooks: 5, askedVersion: null };
  assert.equal(shouldAsk(s, '1.3.0', false), false);
});

test('once per app version, and again in the next one', () => {
  const asked = afterAsking({ cooks: 3, askedVersion: null }, '1.3.0');
  assert.equal(shouldAsk(afterFinishedCook(asked), '1.3.0', true), false);
  assert.equal(shouldAsk(afterFinishedCook(asked), '1.4.0', true), true);
});

test('no version known, no ask', () => {
  assert.equal(shouldAsk({ cooks: 9, askedVersion: null }, null, true), false);
});

test('unreadable storage is a fresh start, never a crash', () => {
  assert.deepEqual(parseRating(null), EMPTY_RATING);
  assert.deepEqual(parseRating('not json'), EMPTY_RATING);
  assert.deepEqual(parseRating('{"cooks":-3,"askedVersion":7}'), EMPTY_RATING);
  assert.deepEqual(parseRating('{"cooks":2.7,"askedVersion":"1.3.0"}'), { cooks: 2, askedVersion: '1.3.0' });
});

test('the review link needs a numeric id, and is hidden without one', () => {
  assert.equal(writeReviewUrl(null), null);
  assert.equal(writeReviewUrl('abc'), null);
  assert.equal(writeReviewUrl('6700000000'), 'https://apps.apple.com/app/id6700000000?action=write-review');
});
