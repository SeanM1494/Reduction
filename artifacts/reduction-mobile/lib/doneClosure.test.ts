import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleDone } from './doneClosure';
import { DEMO_RECIPE } from '../data/demoRecipe';

const sorted = (a: string[]) => [...a].sort();

test('checking a step checks everything upstream of it', () => {
  const next = toggleDone(DEMO_RECIPE, ['avocados'], 'd5');
  const all = [...DEMO_RECIPE.sections[0].ingredients.map((i) => i.id), ...DEMO_RECIPE.sections[0].nodes.map((n) => n.id)];
  assert.deepEqual(sorted(next), sorted(all));
});

test('checking an ingredient checks only that ingredient', () => {
  assert.deepEqual(sorted(toggleDone(DEMO_RECIPE, ['avocados'], 'lime')), ['avocados', 'lime']);
});

test('unchecking clears everything downstream', () => {
  const all = toggleDone(DEMO_RECIPE, [], 'd5');
  const next = toggleDone(DEMO_RECIPE, all, 'd1');
  assert.equal(next.includes('d1'), false);
  assert.equal(next.includes('d2'), false);
  assert.equal(next.includes('d4'), false);
  assert.equal(next.includes('d5'), false);
  assert.equal(next.includes('d3'), true, 'the other branch stays');
  assert.equal(next.includes('avocados'), true);
});
