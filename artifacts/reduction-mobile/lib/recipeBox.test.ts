import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEAL_TYPES } from '@workspace/recipe-model';
import {
  BOOKS,
  arrangeBook,
  bookOf,
  clampSpread,
  cookedLabel,
  flipCommits,
  flipProgress,
  flipSettleMs,
  keyIngredients,
  pageA11yLabel,
  pageLayout,
  pagesLabel,
  shelf,
  spreadCount,
  spreadOfPage,
  stepCount,
  timeLine,
} from './recipeBox';

const recipe = (over: Record<string, unknown> = {}) => ({ title: 'X', servings: 4, sections: [], ...over }) as any;
const entry = (id: string, over: Record<string, unknown> = {}, recipeOver: Record<string, unknown> = {}) =>
  ({ id, savedAt: 0, rating: null, cooked: [], recipe: recipe(recipeOver), ...over }) as any;

test('every meal type has a book, and the mapping is the one decided', () => {
  const books = new Set(BOOKS.map((b) => b.id));
  for (const t of MEAL_TYPES) assert.ok(books.has(bookOf(entry('x', {}, { mealTypes: [t] }))), `${t} has a book`);
  const want: Record<string, string> = {
    breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'apps', salad: 'salads',
    dessert: 'desserts', side: 'other', drink: 'other', baking: 'other',
  };
  for (const [t, b] of Object.entries(want)) assert.equal(bookOf(entry('x', {}, { mealTypes: [t] })), b, t);
  assert.equal(bookOf(entry('x', {}, { mealTypes: [] })), 'other', 'untagged');
  assert.equal(bookOf(entry('x', {}, {})), 'other', 'no field at all');
  assert.equal(bookOf(entry('x', {}, { mealTypes: ['brunch'] })), 'other', 'an unknown type');
});

test('a recipe is in exactly ONE book — its primary type decides, never the others', () => {
  const e = entry('x', {}, { mealTypes: ['side', 'dinner'] });
  assert.equal(bookOf(e), 'other', 'primary is side, so Other — not Dinner as well');
  const s = shelf([e], 'added');
  assert.equal(s.flatMap((b) => b.pages).length, 1, 'never duplicated across books');
});

test('the shelf leaves empty books out and keeps shelf order', () => {
  const lib = [
    entry('d', {}, { mealTypes: ['dessert'] }),
    entry('b', {}, { mealTypes: ['breakfast'] }),
    entry('o', {}, {}),
  ];
  assert.deepEqual(shelf(lib, 'added').map((b) => b.book.id), ['breakfast', 'desserts', 'other']);
  assert.deepEqual(shelf([], 'added'), []);
});

test('thumbs-down always goes to the back of its book, whatever the sort', () => {
  const lib = [
    entry('down-new', { savedAt: 9, rating: -1 }, { mealTypes: ['dinner'] }),
    entry('up', { savedAt: 1, rating: 1 }, { mealTypes: ['dinner'] }),
    entry('none', { savedAt: 5, rating: null }, { mealTypes: ['dinner'] }),
    entry('down-old', { savedAt: 2, rating: -1 }, { mealTypes: ['dinner'] }),
  ];
  // Recently added would put down-new first; it goes to the back instead,
  // and the 👎s keep the sort among themselves.
  assert.deepEqual(arrangeBook(lib, 'dinner', 'added').map((e) => e.id), ['none', 'up', 'down-new', 'down-old']);
  for (const sort of ['added', 'cooked', 'time', 'source', 'type', 'rating'] as const) {
    const ids = arrangeBook(lib, 'dinner', sort).map((e) => e.id);
    assert.deepEqual(ids.slice(-2).sort(), ['down-new', 'down-old'], `${sort}: 👎 last`);
  }
  // Un-thumbing it puts it straight back in its sorted place.
  lib[0] = { ...lib[0], rating: 0 };
  assert.equal(arrangeBook(lib, 'dinner', 'added')[0].id, 'down-new');
});

test('spreads and the page label, including the blank last page', () => {
  assert.equal(spreadCount(0), 1);
  assert.equal(spreadCount(1), 1);
  assert.equal(spreadCount(7), 4);
  assert.equal(spreadCount(8), 4);
  assert.equal(spreadOfPage(0), 0);
  assert.equal(spreadOfPage(5), 2);
  assert.equal(pagesLabel(0, 7), 'Pages 1–2 of 7');
  assert.equal(pagesLabel(1, 7), 'Pages 3–4 of 7');
  assert.equal(pagesLabel(3, 7), 'Page 7 of 7', 'the right-hand page is the blank');
  assert.equal(pagesLabel(0, 1), 'Page 1 of 1');
  assert.equal(pagesLabel(0, 0), 'No recipes yet');
  assert.equal(clampSpread(9, 7), 3, 'a book that shrank keeps a page that exists');
  assert.equal(clampSpread(-1, 7), 0);
});

test('key ingredients: recipe order, each once, never a section’s finished result', () => {
  const r = recipe({
    sections: [
      { name: 'Dry ingredients', ingredients: [{ id: 'f', name: 'Flour' }, { id: 's1', name: 'salt' }], nodes: [{ id: 'n1' }] },
      {
        name: 'Dough',
        ingredients: [
          { id: 'dry', name: 'Dry ingredients' }, // the link: not something you buy
          { id: 's2', name: 'Salt' }, // already listed
          { id: 'b', name: 'Butter' },
          { id: 'e', name: 'Eggs' },
          { id: 'm', name: 'Milk' },
        ],
        nodes: [{ id: 'n2' }, { id: 'n3' }],
      },
    ],
  });
  assert.deepEqual(keyIngredients(r), { names: ['Flour', 'salt', 'Butter'], more: 2 });
  assert.equal(stepCount(r), 3);
  assert.deepEqual(keyIngredients(recipe()), { names: [], more: 0 });
});

test('time line: the stated total or nothing — never a sum of steps', () => {
  assert.equal(timeLine(recipe({ totalMinutes: 30 })), '30 min');
  assert.equal(timeLine(recipe({ totalMinutes: 150 })), '2 hr 30 min');
  assert.equal(timeLine(recipe({ sections: [{ name: 'a', ingredients: [], nodes: [{ id: 'n', minutes: 2 }] }] })), null);
});

test('cooked pill: count and last date, short on a narrow page, null when never', () => {
  const sep11 = new Date(2026, 8, 11, 18).getTime();
  const aug2 = new Date(2026, 7, 2, 18).getTime();
  assert.equal(cookedLabel([aug2, sep11, aug2 + 1]), 'Cooked 3× · Sep 11');
  assert.equal(cookedLabel([sep11], true), '1× · Sep 11');
  assert.equal(cookedLabel([]), null);
  assert.equal(cookedLabel(null), null);
});

test('narrow pages: one ingredient line and the short pill — unless there is no time line to pay for it', () => {
  assert.deepEqual(pageLayout(176, true), { narrow: false, ingredientLines: 2, shortPill: false }, 'iPhone 13');
  assert.deepEqual(pageLayout(141, true), { narrow: true, ingredientLines: 1, shortPill: true }, 'iPhone SE');
  assert.deepEqual(pageLayout(141, false), { narrow: true, ingredientLines: 2, shortPill: true }, 'SE, no stated time');
});

test('the page as VoiceOver reads it', () => {
  assert.equal(pageA11yLabel('Guacamole', 'Apps & Snacks', recipe({ totalMinutes: 15 }), 1), 'Guacamole, Apps & Snacks, 15 min, rated thumbs up');
  assert.equal(pageA11yLabel('Toast', 'Other', recipe(), null), 'Toast, Other', 'no time and no rating: nothing invented');
  assert.equal(pageA11yLabel('Chili', 'Dinner', recipe(), -1), 'Chili, Dinner, rated thumbs down');
});

test('page turn: progress, the commit rule and the settle times, as tuned', () => {
  const W = 366;
  assert.equal(flipProgress(-W * 0.85, 1, W), 1, 'a full turn is 85% of the book');
  assert.equal(flipProgress(-W * 0.425, 1, W), 0.5);
  assert.equal(flipProgress(50, 1, W), 0, 'dragging the wrong way turns nothing');
  assert.equal(flipProgress(W * 0.425, -1, W), 0.5, 'backwards is the mirror');
  assert.equal(flipCommits(0.41, 800, -150), true, 'past 40%');
  assert.equal(flipCommits(0.39, 800, -150), false);
  assert.equal(flipCommits(0.07, 200, -45), true, 'a flick past 6%');
  assert.equal(flipCommits(0.05, 200, -45), false, 'a flick, but not past 6%');
  assert.equal(flipCommits(0.2, 400, -45), false, 'too slow to be a flick');
  assert.equal(flipSettleMs(0, true), 600);
  assert.equal(flipSettleMs(1, true), 140);
  assert.equal(flipSettleMs(0.5, false), 300);
});
