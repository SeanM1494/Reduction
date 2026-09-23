import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEAL_TYPES } from '@workspace/recipe-model';
import {
  BOOKS,
  CAROUSEL,
  arrangeBook,
  bookGeometry,
  bookOf,
  bookSettleMs,
  bookSwipeCommits,
  carouselDrag,
  carouselGeometry,
  carouselPlacement,
  carouselWindow,
  loopOffset,
  shelfIndex,
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
  turnTarget,
  previewStats,
  previewCookedLine,
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

test('book geometry: the prototype\'s proportions', () => {
  assert.deepEqual(bookGeometry(366), { bookW: 366, pageW: 176, pageH: 293, coverH: 309 });
  assert.deepEqual(bookGeometry(296), { bookW: 296, pageW: 141, pageH: 237, coverH: 253 });
});

test('carousel geometry: the prototype\'s book and spacing where there is room, a smaller book where there is not', () => {
  // An iPhone 13 as the app gets it: the prototype, untouched.
  const roomy = carouselGeometry(390, 530, 3);
  assert.equal(roomy.bookW, 366);
  assert.equal(roomy.step, 0.92 * (309 + 40));
  // Too short for the neighbours to show at that size: the book narrows.
  const tight = carouselGeometry(320, 354, 3);
  assert.ok(tight.bookW < 296, `book ${tight.bookW}`);
  assert.ok(tight.bookW >= CAROUSEL.minBookPx);
  // One book has no neighbours to make room for.
  assert.equal(carouselGeometry(320, 354, 1).bookW, 296);
  // A preposterous stage keeps a readable book and gives up the peeks.
  assert.equal(carouselGeometry(390, 200, 3).bookW, CAROUSEL.minBookPx);
});

test('carousel geometry: over every phone-ish stage, covers never overlap and a neighbour always shows', () => {
  for (let w = 300; w <= 440; w += 10) {
    for (let h = 300; h <= 800; h += 7) {
      const g = carouselGeometry(w, h, 3);
      if (g.bookW === CAROUSEL.minBookPx && g.bookW < Math.min(w - 24, 380)) continue; // the preposterous case
      const far = 1 - CAROUSEL.shrink;
      const gapBetween = g.step - (g.coverH / 2 + (far * g.coverH) / 2);
      assert.ok(gapBetween >= CAROUSEL.tabPx + 4 - 1e-9, `${w}x${h}: gap ${gapBetween}`);
      const peek = h / 2 - (g.step - (far * g.coverH) / 2);
      assert.ok(peek >= CAROUSEL.minPeekPx - 1e-9, `${w}x${h}: peek ${peek}`);
      assert.ok(g.top >= 0, `${w}x${h}: tab above the stage`);
    }
  }
});

test('loop offset: each book at its nearest copy, the handoff where it cannot be seen', () => {
  // Three books, front = 0: the other two either side.
  assert.deepEqual([0, 1, 2].map((i) => loopOffset(i, 0, 3)), [0, 1, -1]);
  // Half way to book 1, book 2 is handed from above to below, at ±1.5.
  assert.equal(loopOffset(2, 0.49, 3), -1.49);
  assert.equal(loopOffset(2, 0.51, 3), 1.49);
  // Endless: position 7 on a shelf of three is book 1 in front.
  assert.equal(loopOffset(1, 7, 3), 0);
  // Two books: the other one is BELOW, and stays below through the rubber band.
  assert.equal(loopOffset(1, 0, 2), 1);
  assert.equal(loopOffset(1, -0.12, 2), 1.12);
  assert.equal(loopOffset(0, 1, 2), 1);
  // …and the front one, leaving upwards, goes round to the back at half way.
  assert.ok(loopOffset(0, 0.49, 2) < 0);
  assert.ok(loopOffset(0, 0.51, 2) > 1);
  assert.equal(loopOffset(0, 0.3, 1), -0.3);
});

test('placement: the prototype between neighbours, gone where the loop hands a book over', () => {
  const p0 = carouselPlacement(0, 300, 3);
  assert.deepEqual(p0, { translateY: 0, scale: 1, rotateX: -0, opacity: 1, bottomTab: 0 });
  const below = carouselPlacement(1, 300, 3);
  assert.equal(below.translateY, 300);
  assert.equal(below.scale, 0.86);
  assert.equal(below.rotateX, -10);
  assert.ok(Math.abs(below.opacity - 0.55) < 1e-9);
  assert.equal(below.bottomTab, 0);
  const above = carouselPlacement(-1, 300, 3);
  assert.equal(above.bottomTab, 1);
  assert.equal(carouselPlacement(1.5, 300, 3).opacity, 0);
  assert.equal(carouselPlacement(-1.5, 300, 3).opacity, 0);
  // Two books: the one leaving upwards is gone by half way.
  assert.equal(carouselPlacement(-0.5, 300, 2).opacity, 0);
  assert.ok(carouselPlacement(0.5, 300, 2).opacity > 0.7);
});

test('book swipe: 22% of the step or a flick; two books rubber-band downwards', () => {
  assert.equal(carouselDrag(-150, 300, true), 0.5);
  assert.equal(carouselDrag(-900, 300, true), 1);
  assert.equal(carouselDrag(150, 300, true), -0.5);
  assert.ok(Math.abs(carouselDrag(150, 300, false) - -0.06) < 1e-9);
  assert.equal(carouselDrag(-150, 300, false), 0.5);
  assert.equal(bookSwipeCommits(-67, 1000, 300), true);
  assert.equal(bookSwipeCommits(-65, 1000, 300), false);
  assert.equal(bookSwipeCommits(-45, 200, 300), true);
  assert.equal(bookSwipeCommits(-35, 200, 300), false);
  assert.equal(bookSettleMs(0), 420);
  assert.equal(bookSettleMs(0.5), 210);
  assert.equal(bookSettleMs(0.9), 180);
});

test('carousel window: every book on a small shelf, two either side on a big one', () => {
  assert.deepEqual(carouselWindow(0, 0), []);
  assert.deepEqual(carouselWindow(4, 3), [0, 1, 2]);
  assert.deepEqual(carouselWindow(0, 7), [0, 1, 2, 5, 6]);
  assert.deepEqual(carouselWindow(-8, 7), [0, 1, 4, 5, 6]);
  assert.equal(shelfIndex(-1, 3), 2);
  assert.equal(shelfIndex(7, 3), 1);
  assert.equal(shelfIndex(5, 0), 0);
});

test('a turn always lands on a whole spread, and never past either end', () => {
  assert.equal(turnTarget(0, 1, 2), 1);
  assert.equal(turnTarget(2, 1, 2), null);
  assert.equal(turnTarget(0, -1, 2), null);
  assert.equal(turnTarget(1, -1, 2), 0);
  // The phone bug: a second swipe that began mid-settle, at 0.8.
  assert.equal(turnTarget(0.8, 1, 2), 2);
  assert.equal(turnTarget(0.8, 1, 1), null);
  assert.equal(clampSpread(1.8, 5), 2);
  assert.equal(clampSpread(1.8, 3), 1);
  assert.ok(Number.isInteger(clampSpread(0.4, 9)));
});

test('preview tiles: total time only when stated, then servings and steps', () => {
  const sections = [{ name: null, ingredients: [{ id: 'a', name: 'Flour' }], nodes: [{ id: 's1', label: 'Mix', inputs: ['a'] }, { id: 's2', label: 'Bake', inputs: ['s1'] }] }];
  assert.deepEqual(previewStats(recipe({ servings: 4, totalMinutes: 30, sections })), [
    { value: '30 min', label: 'total time' },
    { value: '4', label: 'servings' },
    { value: '2', label: 'steps' },
  ]);
  // No stated time: two tiles, never a sum of the steps.
  assert.deepEqual(previewStats(recipe({ servings: 1, sections: [{ ...sections[0], nodes: [{ id: 's1', label: 'Mix', inputs: ['a'], minutes: 12 }] }] })), [
    { value: '1', label: 'serving' },
    { value: '1', label: 'step' },
  ]);
  assert.deepEqual(previewStats(recipe({ servings: null, sections })), [{ value: '2', label: 'steps' }]);
});

test('preview cooked line: count and last date, or never — the rating after either', () => {
  const sep11 = new Date(2026, 8, 11, 19).getTime();
  const sep2 = new Date(2026, 8, 2, 19).getTime();
  assert.equal(previewCookedLine([sep2, sep11, sep2], 1), 'Cooked 3× · last Sep 11 · your rating 👍');
  assert.equal(previewCookedLine([sep11], null), 'Cooked 1× · last Sep 11');
  assert.equal(previewCookedLine([], null), "You haven't cooked this yet");
  assert.equal(previewCookedLine(null, -1), "You haven't cooked this yet · your rating 👎");
});
