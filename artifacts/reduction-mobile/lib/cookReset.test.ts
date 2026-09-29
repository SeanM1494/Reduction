import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearProgressPatch, firstOpenCard, freshCookState } from './cookReset';

test('Clear writes the checks and the timer, and nothing else', () => {
  const patch = clearProgressPatch();
  assert.deepEqual(patch, { done: [], timer: null });
  // The cooked history and the rating are the recipe's record: a field not
  // in the PATCH is a field the server leaves alone.
  assert.deepEqual(Object.keys(patch).sort(), ['done', 'timer']);
  assert.equal('cooked' in patch, false);
  assert.equal('rating' in patch, false);
});

test('after a Clear, Step-by-Step is at the very first card with nothing remembered', () => {
  const s = freshCookState();
  assert.equal(s.cardIndex, 0);
  assert.equal(s.passed.size, 0, 'a "Before you start" card passed earlier shows again');
  assert.equal(s.returnIndex, null);
  assert.equal(s.finishedStep, null);
  assert.equal(s.expandedFor, null);
  // A fresh state each time: one screen's passes never leak into another's.
  s.passed.add('h1');
  assert.equal(freshCookState().passed.size, 0);
});

test('a reload or another device lands where the cleared entry says: the first card', () => {
  const ids = ['s1', 's2', 's3'];
  assert.equal(firstOpenCard(ids, new Set(clearProgressPatch().done)), 0);
  // ...and, before the clear, wherever the checks had got to.
  assert.equal(firstOpenCard(ids, new Set(['s1', 's2'])), 2);
  assert.equal(firstOpenCard(ids, new Set(ids)), 3);
});
