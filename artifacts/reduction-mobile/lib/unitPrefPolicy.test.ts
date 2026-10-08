import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveUnitPref, flipLabel, flipTarget, parseUnitPref } from './unitPrefPolicy';
import type { Recipe } from '../shared/layout';

const recipe = (ing: object) =>
  ({ title: 't', sections: [{ name: 's', ingredients: [ing], nodes: [], root: '' }] }) as unknown as Recipe;

test('parse falls back to as written', () => {
  assert.equal(parseUnitPref('g'), 'g');
  assert.equal(parseUnitPref('oz'), 'oz');
  assert.equal(parseUnitPref('cups'), 'written');
  assert.equal(parseUnitPref(null), 'written');
});

test('a flip beats the setting only while present', () => {
  assert.equal(effectiveUnitPref('g', null), 'g');
  assert.equal(effectiveUnitPref('g', 'oz'), 'oz');
});

test('flip target swaps systems and reads the lead unit from as written', () => {
  const oz = recipe({ id: 'a', qty: 4.4, unit: 'oz', name: 'flour', alt: { qty: 125, unit: 'g' } });
  const g = recipe({ id: 'a', qty: 125, unit: 'g', name: 'flour', alt: { qty: 4.4, unit: 'oz' } });
  assert.equal(flipTarget(oz, 'written'), 'g');
  assert.equal(flipTarget(g, 'written'), 'oz');
  assert.equal(flipTarget(oz, 'g'), 'oz');
  assert.equal(flipTarget(oz, 'oz'), 'g');
  assert.equal(flipLabel('g'), 'Show in grams');
});
