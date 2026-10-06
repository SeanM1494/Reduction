import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { modelLimitOf, modelLimitRefusal, resetModelLimitLogForTests } from "./modelLimit";

// Built with the SDK's own factory, so a change in how it shapes an error
// fails here rather than in production on the day the account runs dry.
const sdkError = (status: number, inner: Record<string, unknown>) =>
  Anthropic.APIError.generate(status, { type: "error", error: inner }, undefined, new Headers());

const TIER_CAP = sdkError(429, {
  type: "rate_limit_error",
  message: "You have reached your API usage limits: your organization has crossed its monthly API usage threshold.",
  details: { error_code: "enforced_spend_limit_reached" },
});
const OWN_LIMIT = sdkError(400, {
  type: "invalid_request_error",
  message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.",
});
const WORKSPACE_LIMIT = sdkError(400, {
  type: "invalid_request_error",
  message: "You have reached your specified workspace API usage limits.",
});
const RATE_LIMIT = sdkError(429, { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" });
const OVERLOADED = sdkError(529, { type: "overloaded_error", message: "Overloaded" });

test("the tier's monthly cap and the Console's own limit are both 'spend'", () => {
  assert.equal(modelLimitOf(TIER_CAP), "spend");
  assert.equal(modelLimitOf(OWN_LIMIT), "spend");
  assert.equal(modelLimitOf(WORKSPACE_LIMIT), "spend");
});

test("a rate limit and an overload are 'busy'", () => {
  assert.equal(modelLimitOf(RATE_LIMIT), "busy");
  assert.equal(modelLimitOf(OVERLOADED), "busy");
});

test("anything else is not a limit, so the route's own handling stands", () => {
  assert.equal(modelLimitOf(new Error("Could not build a valid diagram from that source.")), null);
  assert.equal(modelLimitOf(sdkError(400, { type: "invalid_request_error", message: "max_tokens: too large" })), null);
  assert.equal(modelLimitOf(sdkError(500, { type: "api_error", message: "Internal" })), null);
  assert.equal(modelLimitOf(new Anthropic.APIConnectionError({ message: "socket hang up" })), null);
  assert.equal(modelLimitOf(null), null);
  assert.equal(modelLimitOf("429"), null);
});

test("the refusal is a 503 with a sentence a person can act on, never 'something went wrong'", () => {
  resetModelLimitLogForTests();
  const spend = modelLimitRefusal(OWN_LIMIT, "test");
  assert.equal(spend?.status, 503);
  assert.equal(spend?.body.code, "model_spend_limit");
  assert.match(spend!.body.error, /paused/);
  assert.match(spend!.body.error, /saved still work/);
  const busy = modelLimitRefusal(RATE_LIMIT, "test");
  assert.equal(busy?.body.code, "model_busy");
  assert.match(busy!.body.error, /Try again in a minute/);
  assert.equal(modelLimitRefusal(new Error("page refused"), "test"), null);
});

test("the spend log is loud but throttled to once per ten minutes per instance", () => {
  resetModelLimitLogForTests();
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    modelLimitRefusal(TIER_CAP, "extract", 0);
    modelLimitRefusal(TIER_CAP, "search", 60_000);
    modelLimitRefusal(TIER_CAP, "extract", 10 * 60_000);
  } finally {
    console.error = orig;
  }
  assert.equal(lines.length, 2);
  assert.match(lines[0], /ANTHROPIC SPEND LIMIT REACHED \(extract\)/);
});
