import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibraryView, stackStep, swipeOutcome } from "./libraryViewMode";

test("the stored view parses to grid unless it says stack", () => {
  assert.equal(parseLibraryView("stack"), "stack");
  assert.equal(parseLibraryView("grid"), "grid");
  assert.equal(parseLibraryView(null), "grid");
  assert.equal(parseLibraryView("shelves"), "grid", "a view that does not exist yet falls back");
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
