import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICED_MODEL, estimateCostUsd, promptTokens } from "./extractionCost";
import { MODEL as STRUCTURE_MODEL } from "./structureRecipe";
import { MODEL as FALLBACK_MODEL } from "./fetchViaClaude";
import { costUsd } from "../eval/evalReport";

test("both extraction call sites use the model the prices are for", () => {
  // Change a model and this fails until extractionCost.ts is updated with it.
  assert.equal(STRUCTURE_MODEL, PRICED_MODEL);
  assert.equal(FALLBACK_MODEL, PRICED_MODEL);
});

test("list prices: $2 in, $10 out, cache write 1.25x, cache read 0.1x, per million", () => {
  assert.equal(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }), 2);
  assert.equal(estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000 }), 10);
  assert.equal(estimateCostUsd({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 }), 2.5);
  assert.equal(estimateCostUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }), 0.2);
  assert.equal(estimateCostUsd({ inputTokens: 0, outputTokens: 0, webSearches: 3 }), 0.03);
  // A typical structured page: ~6k in, ~2k out.
  assert.equal(estimateCostUsd({ inputTokens: 6000, outputTokens: 2000 }), 0.032);
  assert.equal(estimateCostUsd({ inputTokens: 0, outputTokens: 0 }), 0, "a cache hit costs nothing");
});

test("the eval report and the live log price a token the same", () => {
  assert.equal(costUsd(12_345, 6_789), estimateCostUsd({ inputTokens: 12_345, outputTokens: 6_789 }));
});

test("prompt tokens count cached and uncached input alike", () => {
  assert.equal(promptTokens({ inputTokens: 10, outputTokens: 5, cacheWriteTokens: 20, cacheReadTokens: 30 }), 60);
});
