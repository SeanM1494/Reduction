import test from "node:test";
import assert from "node:assert/strict";
import { readPathNote, readPathOf } from "./readHistory";

const at = new Date("2026-10-01T12:00:00Z");

test("a tree with an image key was read by our own fetch, whatever the site's log says", () => {
  assert.deepEqual(readPathOf({ title: "x", image: null }, { via: "claude", at }), { path: "self", basis: "tree" });
  assert.deepEqual(readPathOf({ title: "x", image: "https://s/p.jpg" }, null), { path: "self", basis: "tree" });
});

test("without one, the site's last fresh read decides: the fallback, or a tree that predates pictures", () => {
  assert.deepEqual(readPathOf({ title: "x" }, { via: "claude", at }), { path: "fallback", basis: "site" });
  assert.deepEqual(readPathOf({ title: "x" }, { via: "self", at }), { path: "self", basis: "site" });
  assert.deepEqual(readPathOf({ title: "x" }, null), { path: "unknown", basis: "none" });
  assert.deepEqual(readPathOf(null, null), { path: "unknown", basis: "none" });
});

test("only a fallback read refuses a refresh, and its note says why to skip it", () => {
  assert.deepEqual(readPathNote("fallback", "site"), { note: "read through the fallback: no picture can be stored, skip", refuseRefresh: true });
  assert.equal(readPathNote("self", "site").refuseRefresh, false);
  assert.match(readPathNote("self", "site").note, /a refresh can store one/);
  assert.equal(readPathNote("self", "tree").refuseRefresh, false);
  assert.equal(readPathNote("unknown", "none").refuseRefresh, false);
});
