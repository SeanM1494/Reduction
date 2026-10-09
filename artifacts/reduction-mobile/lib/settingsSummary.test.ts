import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxSummary, planSummary, timerSummary } from './settingsSummary';

test('timer summary names every alert state and blanks the unknown', () => {
  assert.equal(timerSummary('on'), 'Notifications');
  assert.equal(timerSummary('alarm'), 'Alarm');
  assert.equal(timerSummary('denied'), 'Blocked');
  assert.equal(timerSummary('off'), 'Off');
  assert.equal(timerSummary('unsupported'), 'Not available');
  assert.equal(timerSummary(null), '');
});

test('box summary counts books and drops the count for the grid', () => {
  assert.equal(boxSummary('books', 7), 'Books · 7');
  assert.equal(boxSummary('books', 1), 'Books · 1');
  assert.equal(boxSummary('grid', 7), 'Grid');
});

test('plan summary matches the sentences Settings used before', () => {
  assert.equal(planSummary(null), '—');
  assert.equal(planSummary({ subscribed: true, allowance: 3, used: 9 }), 'Unlimited recipes');
  assert.equal(planSummary({ reason: 'within_allowance', allowance: 3, used: 2 }), '1 free recipe left');
  assert.equal(planSummary({ reason: 'within_allowance', allowance: 3, used: 0 }), '3 free recipes left');
  assert.equal(planSummary({ reason: 'exhausted', allowance: 3, used: 3 }), 'Free recipes used');
  assert.equal(planSummary({ reason: 'other', allowance: 3, used: 3 }), '—');
});
