import test from 'node:test';
import assert from 'node:assert/strict';
import { createCookVisit, type CookCounter } from './cookCounters';

const visit = () => {
  const sent: CookCounter[] = [];
  return { v: createCookVisit((n) => sent.push(n)), sent };
};

test('cook counters: each name once per visit, however many taps', () => {
  const { v, sent } = visit();
  v.opened();
  v.opened();
  v.activity({ kind: 'view', view: 'overview' });
  for (let i = 0; i < 5; i++) v.activity({ kind: 'tick', view: 'overview', finished: false });
  v.activity({ kind: 'view', view: 'cook' });
  v.activity({ kind: 'view', view: 'overview' });
  v.activity({ kind: 'view', view: 'cook' });
  for (let i = 0; i < 5; i++) v.activity({ kind: 'tick', view: 'cook', finished: false });
  assert.deepEqual(sent, ['recipe_opened', 'ticked_diagram', 'view_steps', 'ticked_steps']);
});

test('cook counters: a finish is counted where it happened, every time', () => {
  const { v, sent } = visit();
  v.activity({ kind: 'tick', view: 'cook', finished: true });
  v.activity({ kind: 'tick', view: 'overview', finished: true });
  assert.deepEqual(sent, ['ticked_steps', 'finished_steps', 'ticked_diagram', 'finished_diagram']);
});

test('cook counters: a new visit counts again', () => {
  const { sent, v } = visit();
  v.opened();
  const second = createCookVisit((n) => sent.push(n));
  second.opened();
  assert.deepEqual(sent, ['recipe_opened', 'recipe_opened']);
});
