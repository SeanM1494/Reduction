import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEAL_TYPES, addBook, deleteBook, freshDefaultBooks, renameBook } from '@workspace/recipe-model';
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
  pageFit,
  pillWidth,
  notCookedLabel,
  PAGE_METRICS,
  pagesLabel,
  shelf,
  spreadCount,
  spreadOfPage,
  stepCount,
  timeLine,
  turnTarget,
  previewStats,
  previewCookedLine,
  searchBox,
  resultMeta,
  RATING_CHOICES,
  asksForRating,
  asksToRemove,
  keptToast,
  ratingPromptCopy,
  removePromptCopy,
  resetPromptCopy,
  clearedToast,
  removedToast,
  removedOn,
  removedCountLabel,
  restoredToast,
  removedWaitingNote,
  bookById,
  isRoomPage,
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
  assert.equal(notCookedLabel(false), 'Not cooked yet');
  assert.equal(notCookedLabel(true), 'Not cooked');
});

/** The page's height as the face will draw it, rebuilt from the fit and the
 *  face's own metrics (the worst case: a two-line title, full lines). */
function drawnHeight(fit: ReturnType<typeof pageFit>, time: string | null, fontScale: number): number {
  const m = PAGE_METRICS;
  const k = Math.min(fontScale, fit.maxFontScale ?? Infinity);
  return (
    m.padTop +
    fit.photoHeight +
    m.titleFixed + 2 * m.titleLine * k +
    (time ? m.timeFixed + m.timeLine * k : 0) +
    (fit.showServes ? m.servesFixed + m.servesLine * k : 0) +
    (fit.ingredientLines ? m.ingredientFixed + fit.ingredientLines * m.ingredientLine * k : 0) +
    m.pillGap + m.pillFixed + m.pillLine * k +
    fit.paddingBottom
  );
}

// Every book the carousel can draw (CAROUSEL.minBookPx to maxBookPx).
const PAGES = Array.from({ length: CAROUSEL.maxBookPx - CAROUSEL.minBookPx + 1 }, (_, i) => {
  const g = bookGeometry(CAROUSEL.minBookPx + i);
  return { w: g.pageW, h: g.pageH };
});
// iOS text sizes: xSmall, Large (default), xxxLarge, and the five accessibility sizes.
const TEXT_SIZES = [0.82, 1, 1.12, 1.235, 1.647, 1.941, 2.353, 2.765, 3.118];
const TIMES = [null, '5 min', '35 min', '3 hr 30 min', '23 hr 59 min'];
const TITLE = 'Overnight Cinnamon Rolls with Brown Butter Cream Cheese Frosting';
const COOKED = { long: 'Cooked 12× · Sep 25', short: '12× · Sep 25' };
const NOT_COOKED = { long: 'Not cooked yet', short: 'Not cooked' };
const text = (title: string, time: string | null, pill = COOKED) => ({ title, time, pill });

test('page fit: the pages the prototype was tuned for are unchanged at the default text size', () => {
  // 296 is an iPhone SE's one book; 334 and up is every phone 375pt and
  // wider. Between the two a page now keeps a second ingredient line where
  // the old width rule took it and the height has room for it.
  for (const bookW of [296, 334, 340, 352, 366, 369, 380]) {
    const { pageW, pageH } = bookGeometry(bookW);
    for (const time of TIMES) {
      const fit = pageFit(pageW, pageH, text('Sticky Sesame Chicken', time, { long: 'Cooked 2× · Sep 5', short: '2× · Sep 5' }), 1);
      // What the old width rule said: short pill and one ingredient line
      // below 160px, unless there was no time line.
      const narrow = pageW < 160;
      assert.equal(fit.pill, narrow ? '2× · Sep 5' : 'Cooked 2× · Sep 5', `${pageW} pill`);
      assert.equal(pageFit(pageW, pageH, text('Toast', time, NOT_COOKED), 1).pill, narrow ? 'Not cooked' : 'Not cooked yet', `${pageW} not cooked`);
      assert.equal(fit.ingredientLines, narrow && time ? 1 : 2, `${pageW}x${pageH} ${time}`);
      assert.equal(fit.showServes, true);
      assert.equal(fit.photoHeight, Math.round((pageH - 32) * 0.34));
      assert.equal(fit.paddingBottom, 20);
      assert.equal(fit.maxFontScale, null);
      assert.equal(fit.timeMaxFontScale, null);
      assert.equal(fit.titleMaxFontScale, null);
      assert.equal(fit.pillMaxFontScale, null);
    }
  }
});

test('page fit: on the smallest book (a 320pt phone with several books) rows give way in order', () => {
  const { pageW, pageH } = bookGeometry(CAROUSEL.minBookPx); // 103 x 176
  const withTime = pageFit(pageW, pageH, text('Buttermilk Pancakes', '35 min'), 1);
  assert.equal(withTime.pill, '12× · Sep 25');
  assert.deepEqual([withTime.showServes, withTime.ingredientLines], [false, 0], 'title, time, pill and number only');
  const noTime = pageFit(pageW, pageH, text('Buttermilk Pancakes', null), 1);
  assert.deepEqual([noTime.showServes, noTime.ingredientLines], [false, 1], 'the missing time line buys back an ingredient line');
  // A step taller and the serves line comes back before a second ingredient line.
  const seen: string[] = [];
  for (let h = 150; h <= 320; h++) {
    const f = pageFit(140, h, text('Buttermilk Pancakes', '35 min'), 1);
    const key = `${f.showServes}/${f.ingredientLines}`;
    if (seen[seen.length - 1] !== key) seen.push(key);
  }
  assert.deepEqual(seen, ['false/0', 'false/1', 'true/1', 'true/2'], 'the order rows return in, which is the order they go in reversed');
});

test('page fit: nothing overflows the page, on every book size and every iOS text size', () => {
  for (const { w, h } of PAGES) {
    for (const s of TEXT_SIZES) {
      for (const time of TIMES) {
        const fit = pageFit(w, h, text(TITLE, time), s);
        const label = `${w}x${h} @${s} ${time}`;
        assert.ok(drawnHeight(fit, time, s) <= h + 1e-9, `${label}: ${drawnHeight(fit, time, s)} > ${h}`);
        assert.ok(fit.photoHeight >= PAGE_METRICS.minPhoto, `${label}: photo ${fit.photoHeight}`);
        assert.ok(fit.maxFontScale === null || fit.maxFontScale >= 1, label);
        // Rows go in order: the serves line never outlives the ingredients.
        if (fit.showServes) assert.ok(fit.ingredientLines >= 1, label);
        // The text is capped only once every row that can go has gone.
        if (fit.maxFontScale !== null) assert.deepEqual([fit.showServes, fit.ingredientLines], [false, 0], label);
        // The time line is never cut: its text fits the page's width.
        if (time) {
          // A cap below 1 is not a cap iOS honours; the text is then at 1.
          const k = Math.min(s, Math.max(1, Math.min(fit.maxFontScale ?? Infinity, fit.timeMaxFontScale ?? Infinity)));
          assert.ok(time.length * PAGE_METRICS.timeCharPx * k <= w - 22 + 1e-9, `${label}: time too wide at ${k}`);
        }
        // The title's longest word ("Overnight") stays whole under large text.
        const kt = Math.min(s, Math.max(1, Math.min(fit.maxFontScale ?? Infinity, fit.titleMaxFontScale ?? Infinity)));
        if (kt > 1) assert.ok('Overnight'.length * PAGE_METRICS.titleCharPx * kt <= w - 22 + 1e-9, `${label}: title word too wide at ${kt}`);
        // The pill's label is never cut: the long one where it fits, else
        // the short one, which fits every page at the default size.
        const kp = Math.min(s, Math.max(1, Math.min(fit.maxFontScale ?? Infinity, fit.pillMaxFontScale ?? Infinity)));
        assert.ok(pillWidth(fit.pill) * kp <= w - 22 - 16 + 1e-9, `${label}: pill "${fit.pill}" too wide at ${kp}`);
      }
    }
  }
});

test('page fit: larger text never shows MORE rows on the same page', () => {
  for (const { w, h } of PAGES) {
    let before = Infinity;
    for (const s of TEXT_SIZES) {
      const f = pageFit(w, h, text('Buttermilk Pancakes', '35 min'), s);
      const rows = (f.showServes ? 10 : 0) + f.ingredientLines;
      assert.ok(rows <= before, `${w}x${h} @${s}`);
      before = rows;
    }
  }
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

test('search: title, ingredient and BOOK name, in shelf and page order, never a removed recipe', () => {
  const ing = (name: string) => ({ name: null, ingredients: [{ id: 'i', name }], nodes: [] });
  const lib = [
    entry('pasta', { savedAt: 3 }, { title: 'Cacio e pepe', mealTypes: ['dinner'], sections: [ing('Parmesan')] }),
    entry('salad', { savedAt: 2 }, { title: 'Caesar', mealTypes: ['salad'], sections: [ing('parmesan')] }),
    entry('cake', { savedAt: 1 }, { title: 'Lemon cake', mealTypes: ['dessert'], sections: [ing('Flour')] }),
    entry('gone', { savedAt: 4, removedAt: 5 }, { title: 'Parmesan crisps', mealTypes: ['snack'], sections: [] }),
    entry('stew', { savedAt: 0 }, { title: 'Beef stew', mealTypes: ['dinner'], sections: [ing('Beef')] }),
  ];
  const ids = (q: string) => searchBox(lib, q, 'added').map((h) => `${h.entry.id}@${h.book.id}:${h.page}`);
  // Ingredient match across books, shelf order (Dinner before Salads); the
  // removed recipe's title matches and it is still left out.
  assert.deepEqual(ids('PARMESAN'), ['pasta@dinner:0', 'salad@salads:0']);
  // The book's name finds the whole book, with each recipe's page.
  assert.deepEqual(ids('dinner'), ['pasta@dinner:0', 'stew@dinner:1']);
  assert.deepEqual(ids('dessert'), ['cake@desserts:0']);
  assert.deepEqual(ids('lemon'), ['cake@desserts:0']);
  assert.deepEqual(ids('   '), []);
  assert.deepEqual(ids('nothing like it'), []);
});

test('result meta: stated time and cooked count, whichever exist', () => {
  assert.equal(resultMeta(recipe({ totalMinutes: 30 }), [1, 2, 3]), '30 min · cooked 3×');
  assert.equal(resultMeta(recipe({}), [1]), 'cooked 1×');
  assert.equal(resultMeta(recipe({ totalMinutes: 90 }), []), '1 hr 30 min');
  assert.equal(resultMeta(recipe({}), null), '');
});

test('the rating prompt: asked exactly when a cook is stamped, worded for rated and unrated', () => {
  assert.equal(asksForRating([1], [1, 2]), true);
  // stampCooked returned the same list: inside the six-hour window, or not a finish.
  assert.equal(asksForRating([1, 2], [1, 2]), false);
  assert.equal(asksForRating([], []), false);
  assert.deepEqual(RATING_CHOICES.map((c) => c.value), [-1, 0, 1]);
  assert.deepEqual(ratingPromptCopy('Chili', null), { heading: 'How was Chili?', sub: 'Your rating decides where it sits in your recipe box.' });
  assert.equal(ratingPromptCopy('Chili', 0).sub, 'You can keep your rating or change it.');
});

test('start fresh: one question after the rating, and its toast', () => {
  assert.deepEqual(resetPromptCopy(), {
    heading: 'Start fresh next time?',
    body: 'Clears every check, so it opens on step 1 in both the diagram and Step-by-Step. Your rating and notes stay.',
  });
  assert.equal(clearedToast, 'Progress cleared');
});

test('thumbs down: the words, and when the recipe itself asks', () => {
  assert.deepEqual(removePromptCopy('Chili', 'Dinner'), {
    heading: 'Take it out of your box?',
    body: 'You gave Chili a thumbs down. Want it gone, or kept at the back of Dinner?',
    note: 'Removed recipes wait in Settings → Removed recipes. You can bring them back anytime.',
  });
  assert.equal(removedToast('Chili'), 'Removed Chili');
  assert.equal(keptToast('Dinner'), 'Moved to the back of Dinner');
  assert.equal(asksToRemove(1, -1), true);
  assert.equal(asksToRemove(null, -1), true);
  assert.equal(asksToRemove(-1, -1), false);
  assert.equal(asksToRemove(-1, null), false);
  assert.equal(asksToRemove(0, 1), false);
});

test('removed recipes: the date, the count, the restore toast and the empty-library note', () => {
  assert.equal(removedOn(new Date(2026, 8, 24, 12).getTime()), 'Removed Sep 24');
  assert.equal(removedOn(null), 'Removed');
  assert.deepEqual([0, 1, 4].map(removedCountLabel), ['None', '1 recipe', '4 recipes']);
  assert.equal(restoredToast('Chili', 'Dinner', -1), 'Chili is back, at the back of Dinner');
  assert.equal(restoredToast('Chili', 'Dinner', 1), 'Chili is back in Dinner');
  assert.equal(removedWaitingNote(0), null);
  assert.equal(removedWaitingNote(1), '1 removed recipe is waiting in Settings → Removed recipes.');
  assert.equal(removedWaitingNote(2), '2 removed recipes are waiting in Settings → Removed recipes.');
});


// ------------------------------------------------ the person's own books --

test("custom books: a placement beats the meal type; a made book shows empty, a default does not", () => {
  const books = addBook(addBook(freshDefaultBooks(), { id: 'soups', name: 'Soups', now: 1 }), { id: 'bread', name: 'Bread', now: 2 });
  const chili = { ...entry('chili', {}, { mealTypes: ['dinner'] }), book: 'soups' };
  const toast = entry('toast', {}, { mealTypes: ['breakfast'] });
  assert.equal(bookOf(chili, books), 'soups', 'placed');
  assert.equal(bookOf(toast, books), 'breakfast', 'no placement: its meal type');
  const s = shelf([chili, toast], 'added', books);
  assert.deepEqual(s.map((b) => [b.book.name, b.pages.length]), [['Breakfast', 1], ['Soups', 1], ['Bread', 0]], 'Bread is empty and still there; empty defaults are not');
  assert.equal(isRoomPage(0, 0), true, "an empty book opens on 'Room for one more'");
  assert.equal(isRoomPage(1, 0), false);
  assert.equal(isRoomPage(3, 3), true);
  assert.equal(isRoomPage(4, 4), false);
});

test("custom books: renamed and merged books carry their recipes; search finds a book by its new name", () => {
  let books = addBook(freshDefaultBooks(), { id: 'mains', name: 'Mains', now: 1 });
  books = deleteBook(books, 'dinner', { into: 'mains', now: 2 });
  books = renameBook(books, 'mains', 'Weeknight');
  const chili = entry('chili', {}, { mealTypes: ['dinner'] });
  assert.equal(bookOf(chili, books), 'mains', 'the old Dinner sends it on');
  assert.equal(bookById('mains', books).name, 'Weeknight');
  assert.equal(bookById('dinner', books).name, 'Other', 'a stale id reads as Other, never as a book that is gone');
  const hits = searchBox([chili], 'weeknight', 'added', books);
  assert.deepEqual(hits.map((h) => `${h.entry.id}@${h.book.name}`), ['chili@Weeknight']);
});
