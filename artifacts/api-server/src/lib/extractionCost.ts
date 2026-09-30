/**
 * lib/extractionCost.ts — what an extraction costs us, ESTIMATED. The one
 * place the prices live: the live estimate in extraction_events
 * (extractionLog.ts) and the eval's report (eval/evalReport.ts) both read
 * them, so the two can never disagree about what a token costs.
 *
 * AN ESTIMATE, AND LABELLED ONE EVERYWHERE IT IS SHOWN. These are
 * Anthropic's list prices for the extraction model, copied by hand; the
 * invoice is the truth. They drift when the model or the price changes, so
 * `extractionCost.test.ts` fails if either call site's model is not the one
 * priced here — change the model and this file in the same commit.
 *
 * Prices (per million tokens, claude-sonnet-5, list, Sep 30 2026):
 *   input $2 · output $10 · cache write $2.50 (1.25x) · cache read $0.20 (0.1x)
 * Server tools: web fetch is not metered beyond the tokens it adds (the
 * fallback path, fetchViaClaude.ts, uses only web fetch); web search is $10
 * per 1,000 and is priced here only so a future caller cannot make it free.
 */

import type { CallUsage } from "./extractionConfig";

export const PRICED_MODEL = "claude-sonnet-5";

export const PRICE_PER_MTOK = {
  input: 2,
  output: 10,
  cacheWrite: 2.5,
  cacheRead: 0.2,
} as const;

export const WEB_SEARCH_USD = 10 / 1000;

export type PricedUsage = Pick<CallUsage, "inputTokens" | "outputTokens"> &
  Partial<Pick<CallUsage, "cacheWriteTokens" | "cacheReadTokens" | "webSearches">>;

/** Estimated US dollars for the calls in `u`, to the millionth of a dollar. */
export function estimateCostUsd(u: PricedUsage): number {
  const usd =
    (u.inputTokens * PRICE_PER_MTOK.input +
      u.outputTokens * PRICE_PER_MTOK.output +
      (u.cacheWriteTokens ?? 0) * PRICE_PER_MTOK.cacheWrite +
      (u.cacheReadTokens ?? 0) * PRICE_PER_MTOK.cacheRead) /
      1_000_000 +
    (u.webSearches ?? 0) * WEB_SEARCH_USD;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Every prompt token sent, cached or not: what the log's `input_tokens`
 *  column holds (the cost column is what prices them differently). */
export const promptTokens = (u: PricedUsage): number =>
  u.inputTokens + (u.cacheWriteTokens ?? 0) + (u.cacheReadTokens ?? 0);
