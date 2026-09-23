import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OVERSCROLL_MAX_PX,
  PEEK,
  RUBBER_BAND,
  dragPosition,
  overscrollPx,
  parseBoxStyle,
  stackStep,
  stackWindow,
  swipeOutcome,
} from "./libraryViewMode";

test("the recipe box style: books by default, grid only when chosen", () => {
  assert.equal(parseBoxStyle("books"), "books");
  assert.equal(parseBoxStyle("grid"), "grid");
  assert.equal(parseBoxStyle(null), "books", "books is the default");
  assert.equal(parseBoxStyle("shelves"), "books", "a style that does not exist falls back to the default");
  // Carried over from the old in-library toggle, which stored only a tap.
  assert.equal(parseBoxStyle(null, "grid"), "grid", "a grid chosen with the old toggle is kept");
  assert.equal(parseBoxStyle(null, "stack"), "books", "the books replaced the stack");
  assert.equal(parseBoxStyle("books", "grid"), "books", "the Settings key wins over the old one");
});

test("a swipe commits when far or fast, in the direction it moved, and springs back otherwise", () => {
  const W = 340;
  assert.equal(swipeOutcome(-150, 0, W), "next", "far enough left");
  assert.equal(swipeOutcome(150, 0, W), "prev", "far enough right");
  assert.equal(swipeOutcome(-40, -1.2, W), "next", "a short fast flick left");
  assert.equal(swipeOutcome(40, 1.2, W), "prev", "a short fast flick right");
  assert.equal(swipeOutcome(-60, 0.1, W), "stay", "neither far nor fast");
  assert.equal(swipeOutcome(-150, 2, W), "next", "far left beats a contrary velocity: distance decides when it is far");
});

test("the index steps and clamps at both ends", () => {
  assert.equal(stackStep(0, "next", 3), 1);
  assert.equal(stackStep(2, "next", 3), 2, "the last card stays");
  assert.equal(stackStep(0, "prev", 3), 0, "the first card stays");
  assert.equal(stackStep(1, "stay", 3), 1);
  assert.equal(stackStep(5, "stay", 0), 0, "no cards, no index");
  assert.equal(stackStep(5, "stay", 2), 1, "an index past the end (a filter shrank the list) clamps");
});

test("the deck's position follows the finger 1:1 and clamps at both ends", () => {
  const TRAVEL = 400;
  const COUNT = 5;
  // Dragging left advances; dragging right goes back. The denominator is
  // the card's own travel, so half a card's width is half a card.
  assert.equal(dragPosition(1, -200, TRAVEL, COUNT), 1.5);
  assert.equal(dragPosition(1, 200, TRAVEL, COUNT), 0.5);
  assert.equal(dragPosition(2, 0, TRAVEL, COUNT), 2, "no drag, no movement");

  // It never goes outside the library. A position below zero would read, to
  // every card's transform, as the front card being pushed BACK into the
  // deck — the give past the end belongs to overscrollPx instead.
  assert.equal(dragPosition(0, 400, TRAVEL, COUNT), 0);
  assert.equal(dragPosition(0, 4000, TRAVEL, COUNT), 0);
  assert.equal(dragPosition(COUNT - 1, -400, TRAVEL, COUNT), COUNT - 1);
  assert.equal(dragPosition(0, -400, TRAVEL, 1), 0, "a one-card library has nowhere to go");
  assert.equal(dragPosition(0, 0, TRAVEL, 0), 0, "and an empty one has no range to divide by");
});

test("past either end the whole deck gives, a little, and no further than the margin", () => {
  const TRAVEL = 400;
  const COUNT = 5;
  assert.equal(overscrollPx(2, -100, TRAVEL, COUNT), 0, "inside the library nothing gives");
  // Floating point: the excess is a position fraction multiplied back out
  // by the same travel, so it lands a bitmap pixel either side of exact.
  const near = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} vs ${b}`);
  near(overscrollPx(0, 40, TRAVEL, COUNT), 40 * RUBBER_BAND, "before the first card the deck follows right");
  near(overscrollPx(COUNT - 1, -40, TRAVEL, COUNT), -40 * RUBBER_BAND, "after the last it follows left");

  // Capped in both directions: the deck lives in the 24px margin the card
  // leaves, so more than this would put a card off the side of the screen.
  assert.equal(overscrollPx(0, 4000, TRAVEL, COUNT), OVERSCROLL_MAX_PX);
  assert.equal(overscrollPx(COUNT - 1, -4000, TRAVEL, COUNT), -OVERSCROLL_MAX_PX);
  assert.ok(OVERSCROLL_MAX_PX <= 24, "24px a side is what the card layout actually leaves");

  // A one-card library gives in both directions and divides by nothing.
  assert.ok(overscrollPx(0, 100, TRAVEL, 1) > 0);
  assert.ok(overscrollPx(0, -100, TRAVEL, 1) < 0);
  assert.equal(overscrollPx(0, 100, TRAVEL, 0), OVERSCROLL_MAX_PX * 0 + overscrollPx(0, 100, TRAVEL, 1), "empty behaves like one");
});

test("the mounted cards are listed deepest first, and the card BEFORE the front one is last", () => {
  // Paint order is this list's order — there is no zIndex in the stack, so
  // the last entry is the card on top. The card before the front one is
  // mounted for exactly two reasons: swiping back slides it in over the
  // top, and after a forward swipe it is the one still flying off.
  assert.deepEqual(stackWindow(2, 9), [5, 4, 3, 2, 1], "one buffer past the peeks, down to index - 1");
  assert.equal(stackWindow(2, 9).at(-1), 1, "index - 1 paints last, i.e. on top");

  // The ends clamp rather than running off either side of the library.
  assert.deepEqual(stackWindow(0, 9), [3, 2, 1, 0]);
  assert.deepEqual(stackWindow(8, 9), [8, 7]);
  assert.deepEqual(stackWindow(0, 1), [0]);
  assert.deepEqual(stackWindow(0, 0), [], "an empty library mounts nothing");

  // Every window is descending, distinct and inside the library.
  for (let count = 1; count <= 12; count += 1) {
    for (let i = 0; i < count; i += 1) {
      const w = stackWindow(i, count);
      assert.ok(w.includes(i), `the front card is always mounted (${i} of ${count})`);
      assert.deepEqual([...w].sort((a, b) => b - a), w, "descending");
      assert.equal(new Set(w).size, w.length, "no duplicates");
      assert.ok(w.every((n) => n >= 0 && n < count), "inside the library");
      assert.ok(w.length <= PEEK + 3, "a bounded number of cards is mounted");
    }
  }
});
