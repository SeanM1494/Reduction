/**
 * server/lib/claim.test.ts — the contract for merging an anonymous library
 * into an account.
 *
 * Written before the implementation, on purpose. These cases are what the
 * merge has to do; whatever planClaim ends up looking like has to satisfy
 * them rather than the other way round.
 *
 * They currently FAIL — planClaim throws "not implemented". That is the
 * expected state until step 3.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planClaim, type ClaimCandidate } from "./claim";

const USER = "user-1";
const OTHER = "user-2";

/** Predictable ids so a re-key can be asserted exactly. */
function sequentialIds(prefix = "new") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const anon = (...ids: string[]): ClaimCandidate[] =>
  ids.map((id) => ({ id, userId: null }));

test("an empty anonymous library is a no-op, not an error", () => {
  const plan = planClaim({ userId: USER, candidates: [], existingIds: [] });
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.alreadyMine, []);
  assert.deepEqual(plan.skippedOwnedByOther, []);
});

test("with no collisions every row keeps the id it already had", () => {
  const plan = planClaim({
    userId: USER,
    candidates: anon("a", "b", "c"),
    existingIds: ["x", "y"],
  });
  assert.deepEqual(
    plan.moves,
    [
      { fromId: "a", toId: "a", rekeyed: false },
      { fromId: "b", toId: "b", rekeyed: false },
      { fromId: "c", toId: "c", rekeyed: false },
    ],
    "ids that do not collide must be preserved — they are what any existing link or bookmark points at"
  );
});

test("a colliding id is re-keyed, never dropped and never overwritten", () => {
  const plan = planClaim(
    { userId: USER, candidates: anon("dup"), existingIds: ["dup"] },
    { newId: sequentialIds() }
  );
  assert.equal(plan.moves.length, 1, "the incoming row must still arrive");
  assert.deepEqual(plan.moves[0], { fromId: "dup", toId: "new-1", rekeyed: true });
});

test("only the colliding rows are re-keyed", () => {
  const plan = planClaim(
    {
      userId: USER,
      candidates: anon("keep", "clash", "also-keep"),
      existingIds: ["clash"],
    },
    { newId: sequentialIds() }
  );
  assert.deepEqual(plan.moves, [
    { fromId: "keep", toId: "keep", rekeyed: false },
    { fromId: "clash", toId: "new-1", rekeyed: true },
    { fromId: "also-keep", toId: "also-keep", rekeyed: false },
  ]);
});

test("every row colliding is still every row arriving", () => {
  const plan = planClaim(
    { userId: USER, candidates: anon("a", "b"), existingIds: ["a", "b"] },
    { newId: sequentialIds() }
  );
  assert.equal(plan.moves.length, 2);
  assert.ok(plan.moves.every((m) => m.rekeyed));
  assert.deepEqual(
    plan.moves.map((m) => m.toId),
    ["new-1", "new-2"]
  );
});

test("rows owned by another user are never touched", () => {
  const plan = planClaim({
    userId: USER,
    candidates: [
      { id: "mine", userId: null },
      { id: "theirs", userId: OTHER },
    ],
    existingIds: [],
  });
  assert.deepEqual(
    plan.moves,
    [{ fromId: "mine", toId: "mine", rekeyed: false }],
    "a guessed or shared owner key must not be able to take someone else's recipes"
  );
  assert.deepEqual(plan.skippedOwnedByOther, ["theirs"]);
});

test("claiming twice is a no-op the second time", () => {
  const plan = planClaim({
    userId: USER,
    candidates: [
      { id: "already", userId: USER },
      { id: "fresh", userId: null },
    ],
    existingIds: ["already"],
  });
  assert.deepEqual(plan.moves, [{ fromId: "fresh", toId: "fresh", rekeyed: false }]);
  assert.deepEqual(
    plan.alreadyMine,
    ["already"],
    "a retried claim must converge, not duplicate or re-key what it already moved"
  );
});

test("a replacement id never collides with an id the account already holds", () => {
  // The naive generator hands back an id the user already has. The plan must
  // not accept it — that would trade one collision for another.
  const ids = ["taken", "safe"];
  let i = 0;
  const plan = planClaim(
    { userId: USER, candidates: anon("clash"), existingIds: ["clash", "taken"] },
    { newId: () => ids[i++] }
  );
  assert.equal(plan.moves[0].toId, "safe");
});

test("a replacement id never collides with another incoming row", () => {
  const ids = ["dup", "dup", "unique"];
  let i = 0;
  const plan = planClaim(
    { userId: USER, candidates: anon("c1", "c2"), existingIds: ["c1", "c2"] },
    { newId: () => ids[i++] }
  );
  const assigned = plan.moves.map((m) => m.toId);
  assert.equal(new Set(assigned).size, assigned.length, "assigned ids must be distinct");
});

test("a replacement id never collides with a row that is keeping its id", () => {
  // "survivor" is not colliding, so it keeps its id. A re-key that happened to
  // generate "survivor" would collide with a row moving in the same claim —
  // the subtlest version of this bug, and invisible without this case.
  const ids = ["survivor", "actually-free"];
  let i = 0;
  const plan = planClaim(
    {
      userId: USER,
      candidates: anon("survivor", "clash"),
      existingIds: ["clash"],
    },
    { newId: () => ids[i++] }
  );
  assert.deepEqual(plan.moves, [
    { fromId: "survivor", toId: "survivor", rekeyed: false },
    { fromId: "clash", toId: "actually-free", rekeyed: true },
  ]);
});

test("the default id generator produces distinct, non-empty ids", () => {
  const plan = planClaim({
    userId: USER,
    candidates: anon("a", "b", "c"),
    existingIds: ["a", "b", "c"],
  });
  const assigned = plan.moves.map((m) => m.toId);
  assert.equal(new Set(assigned).size, 3);
  assert.ok(assigned.every((id) => typeof id === "string" && id.length > 0));
  assert.ok(
    assigned.every((id) => !["a", "b", "c"].includes(id)),
    "generated ids must not reuse the ids they are replacing"
  );
});

test("planning does not mutate its input", () => {
  const candidates = anon("a", "clash");
  const existingIds = ["clash"];
  const snapshot = JSON.stringify({ candidates, existingIds });
  planClaim({ userId: USER, candidates, existingIds }, { newId: sequentialIds() });
  assert.equal(
    JSON.stringify({ candidates, existingIds }),
    snapshot,
    "the caller's arrays are reused to build the SQL — mutating them corrupts the write"
  );
});

test("every candidate is accounted for exactly once", () => {
  // The invariant that actually protects against data loss: nothing may be
  // dropped on the floor. Whatever a future implementation does, each input
  // row must appear in exactly one of the three output buckets.
  const candidates: ClaimCandidate[] = [
    { id: "a", userId: null },
    { id: "b", userId: USER },
    { id: "c", userId: OTHER },
    { id: "d", userId: null },
  ];
  const plan = planClaim(
    { userId: USER, candidates, existingIds: ["a"] },
    { newId: sequentialIds() }
  );
  const seen = [
    ...plan.moves.map((m) => m.fromId),
    ...plan.alreadyMine,
    ...plan.skippedOwnedByOther,
  ];
  assert.deepEqual(
    seen.slice().sort(),
    ["a", "b", "c", "d"],
    "no candidate may be silently dropped"
  );
  assert.equal(new Set(seen).size, seen.length, "no candidate may be double-counted");
});
