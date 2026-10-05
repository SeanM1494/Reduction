import test from 'node:test';
import assert from 'node:assert/strict';
import type { Ingredient, Recipe } from '@workspace/recipe-model';
import {
  addedLabel,
  deriveList,
  emptyList,
  listRecipe,
  parseList,
  popupLines,
  pruneChecked,
  putRecipe,
  removeItem,
  removeRecipe,
  scaleFor,
  servingsStep,
  shareText,
  toggleChecked,
  togglePopupLine,
} from './shoppingList';

const ing = (id: string, name: string, qty: number | null, unit: Ingredient['unit'] = null, text?: string): Ingredient => ({
  id,
  name,
  qty,
  unit,
  ...(text ? { text } : {}),
});

const recipe = (title: string, servings: number | null, ingredients: Ingredient[]): Recipe => ({
  title,
  servings,
  sections: [{ name: 'Main', ingredients, nodes: [{ id: 's', label: 'mix', inputs: ingredients.map((i) => i.id) }], root: 's' }],
});

const stuffing = {
  id: 'e1',
  recipe: recipe('Sausage stuffing', 6, [
    ing('a', 'yellow onion', 1),
    ing('b', 'butter', 0.5, 'cup'),
    ing('c', 'chicken broth', 1.5, 'cup'),
    ing('d', 'celery stalks', 3),
    ing('e', 'salt', null, null, 'to taste'),
  ]),
};
const gravy = {
  id: 'e2',
  recipe: recipe('Turkey gravy', 8, [ing('a', 'Yellow onions', 1), ing('b', 'flour', 0.25, 'cup'), ing('c', 'chicken broth', 2, 'cup')]),
};
const entries = [stuffing, gravy];

test('a recipe added with one ingredient unticked shows 4/5 and lists four lines', () => {
  const s = putRecipe(emptyList(), { entryId: 'e1', servings: null, skip: ['e'] });
  const v = deriveList(s, entries);
  assert.deepEqual(v.recipes, [{ entryId: 'e1', title: 'Sausage stuffing', servings: 6, added: 4, total: 5 }]);
  assert.equal(addedLabel(v.recipes[0]), '4/5 ingredients added to list');
  assert.deepEqual(v.items.map((i) => i.name), ['yellow onion', 'butter', 'chicken broth', 'celery stalks']);
});

test('two recipes merge, each at its own servings', () => {
  let s = putRecipe(emptyList(), { entryId: 'e1', servings: 12, skip: [] });
  s = putRecipe(s, { entryId: 'e2', servings: null, skip: [] });
  const v = deriveList(s, entries);
  const broth = v.items.find((i) => i.key === 'chicken broth')!;
  // 1.5 cup doubled is 3, plus the gravy's 2.
  assert.equal(broth.amount, '5 cup');
  assert.deepEqual(broth.from, ['e1', 'e2']);
  assert.equal(v.items.find((i) => i.key === 'yellow onion')!.amount, '3');
});

test('adding a recipe again replaces its choices in place', () => {
  let s = putRecipe(emptyList(), { entryId: 'e1', servings: null, skip: [] });
  s = putRecipe(s, { entryId: 'e2', servings: null, skip: [] });
  s = putRecipe(s, { entryId: 'e1', servings: 3, skip: ['a'] });
  assert.deepEqual(s.recipes.map((r) => r.entryId), ['e1', 'e2']);
  assert.deepEqual(listRecipe(s, 'e1'), { entryId: 'e1', servings: 3, skip: ['a'] });
  assert.deepEqual(removeRecipe(s, 'e1').recipes.map((r) => r.entryId), ['e2']);
});

test('removing a merged line skips it in every recipe it came from', () => {
  let s = putRecipe(emptyList(), { entryId: 'e1', servings: null, skip: [] });
  s = putRecipe(s, { entryId: 'e2', servings: null, skip: [] });
  const onion = deriveList(s, entries).items.find((i) => i.key === 'yellow onion')!;
  s = toggleChecked(s, onion.key);
  s = removeItem(s, onion, entries);
  const v = deriveList(s, entries);
  assert.ok(!v.items.some((i) => i.key === 'yellow onion'));
  assert.deepEqual(v.recipes.map((r) => [r.entryId, r.added, r.total]), [['e1', 4, 5], ['e2', 2, 3]]);
  assert.deepEqual(s.checked, []);
  // Reopening the gravy's popup shows the onion unticked.
  const lines = popupLines(gravy.recipe, null, new Set(listRecipe(s, 'e2')!.skip));
  assert.equal(lines.find((l) => l.key === 'yellow onion')!.ticked, false);
});

test('a recipe with nothing left on the list leaves it', () => {
  let s = putRecipe(emptyList(), { entryId: 'e2', servings: null, skip: ['a', 'b'] });
  const broth = deriveList(s, entries).items[0];
  s = removeItem(s, broth, entries);
  assert.deepEqual(s.recipes, []);
});

test('a recipe gone from the library is not shown, and is kept until written', () => {
  const s = putRecipe(emptyList(), { entryId: 'gone', servings: null, skip: [] });
  assert.deepEqual(deriveList(s, entries), { recipes: [], items: [] });
  // A library still loading must not wipe the list on the first removal.
  const t = putRecipe(s, { entryId: 'e2', servings: null, skip: ['a', 'b'] });
  const after = removeItem(t, deriveList(t, entries).items[0], entries);
  assert.deepEqual(after.recipes.map((r) => r.entryId), ['gone']);
});

test('popup lines tick and untick together', () => {
  let skip = new Set<string>();
  let lines = popupLines(stuffing.recipe, null, skip);
  assert.equal(lines.length, 5);
  assert.ok(lines.every((l) => l.ticked));
  skip = togglePopupLine(skip, lines[1]);
  lines = popupLines(stuffing.recipe, null, skip);
  assert.equal(lines[1].ticked, false);
  skip = togglePopupLine(skip, lines[1]);
  assert.equal(skip.size, 0);
});

test('popup amounts follow the chosen servings; unscaled is the identity', () => {
  assert.equal(popupLines(stuffing.recipe, 12, new Set())[2].amount, '3 cup');
  assert.equal(popupLines(stuffing.recipe, 6, new Set())[2].amount, '1½ cup');
  assert.equal(scaleFor(stuffing.recipe, null), 1);
  assert.equal(scaleFor(recipe('x', null, []), 4), 1);
});

test('share sends what is not checked off, or everything when all are', () => {
  let s = putRecipe(emptyList(), { entryId: 'e2', servings: null, skip: [] });
  const v = deriveList(s, entries);
  assert.equal(shareText(v), 'Yellow onions (1)\nflour (¼ cup)\nchicken broth (2 cup)');
  s = toggleChecked(s, 'flour');
  assert.equal(shareText(deriveList(s, entries)), 'Yellow onions (1)\nchicken broth (2 cup)');
  for (const k of ['yellow onion', 'chicken broth']) s = toggleChecked(s, k);
  assert.equal(shareText(deriveList(s, entries)), shareText(v));
});

test('check marks for lines that have gone are pruned', () => {
  let s = putRecipe(emptyList(), { entryId: 'e2', servings: null, skip: [] });
  s = toggleChecked(toggleChecked(s, 'flour'), 'nothing here');
  const pruned = pruneChecked(s, deriveList(s, entries));
  assert.deepEqual(pruned.checked, ['flour']);
  assert.equal(pruneChecked(pruned, deriveList(pruned, entries)), pruned);
});

test('a damaged file is an empty list, never a crash', () => {
  for (const raw of [null, 3, 'x', {}, { recipes: 'no' }, []]) assert.deepEqual(parseList(raw), emptyList());
  assert.deepEqual(
    parseList({
      recipes: [{ entryId: 'e1', servings: -2, skip: ['a', 4] }, { entryId: 'e1' }, { nope: 1 }, { entryId: 'e2', servings: 8 }],
      checked: ['flour', 7],
    }),
    {
      recipes: [
        { entryId: 'e1', servings: null, skip: ['a'] },
        { entryId: 'e2', servings: 8, skip: [] },
      ],
      checked: ['flour'],
    }
  );
});

test('the servings step is an eighth of the recipe, at least 1', () => {
  assert.equal(servingsStep(4), 1);
  assert.equal(servingsStep(24), 3);
  assert.equal(servingsStep(null), 1);
});
