import { test } from "node:test";
import assert from "node:assert/strict";
import { createLatest } from "./latestRequest";

test("starting again supersedes the one in flight, and aborts it", () => {
  const latest = createLatest();
  const first = latest.begin();
  assert.equal(latest.pending(), true);
  assert.equal(first.isCurrent(), true);
  assert.equal(first.signal.aborted, false);

  const second = latest.begin();
  assert.equal(first.signal.aborted, true, "the superseded request is stopped, not just ignored");
  assert.equal(first.isCurrent(), false, "and its reply, if it still arrives, is stale");
  assert.equal(second.isCurrent(), true);
  assert.equal(second.signal.aborted, false);
});

test("a reply already in the socket when the abort went out is still dropped", () => {
  const latest = createLatest();
  const first = latest.begin();
  latest.begin();
  // The first request's `then` runs anyway — an abort races the response.
  assert.equal(first.isCurrent(), false, "the generation, not the signal, is what decides");
});

test("settling the current attempt clears pending; settling a stale one does not disturb the live one", () => {
  const latest = createLatest();
  const first = latest.begin();
  first.settle();
  assert.equal(latest.pending(), false);
  assert.equal(
    first.isCurrent(),
    true,
    "settling does not make an attempt stale: the finally block that clears the spinner runs after it and still has to know the spinner is its own"
  );

  const second = latest.begin();
  const third = latest.begin();
  second.settle(); // late, and stale
  assert.equal(latest.pending(), true, "the live attempt is still live");
  assert.equal(third.isCurrent(), true);
  third.settle();
  assert.equal(latest.pending(), false);
});

test("cancel stops what is running and makes everything outstanding stale", () => {
  const latest = createLatest();
  const only = latest.begin();
  latest.cancel();
  assert.equal(only.signal.aborted, true);
  assert.equal(only.isCurrent(), false);
  assert.equal(latest.pending(), false);

  // Idempotent, and safe with nothing in flight — it runs from an unmount.
  latest.cancel();
  latest.cancel();
  assert.equal(latest.pending(), false);
});

test("an attempt begun after a cancel is current again", () => {
  const latest = createLatest();
  latest.begin();
  latest.cancel();
  const next = latest.begin();
  assert.equal(next.isCurrent(), true);
  assert.equal(next.signal.aborted, false);
});
