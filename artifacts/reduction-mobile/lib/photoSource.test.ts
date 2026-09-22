import { test } from "node:test";
import assert from "node:assert/strict";
import { photoCacheKey, pickPhotoSource, type PhotoImageSource } from "./photoSource";

const A: PhotoImageSource = { uri: "blob:a" };
const B: PhotoImageSource = { uri: "blob:b" };
const derived: PhotoImageSource = { uri: "https://host/api/library/r1/photo?v=2" };

test("the cache key is per recipe AND per version, and null without a picture", () => {
  assert.equal(photoCacheKey("r1", { version: 1, source: "page" }), photoCacheKey("r1", { version: 1, source: "user" }), "the source does not change the bytes' identity; the version does");
  assert.notEqual(photoCacheKey("r1", { version: 1, source: "page" }), photoCacheKey("r1", { version: 2, source: "page" }));
  assert.notEqual(photoCacheKey("r1", { version: 1, source: "page" }), photoCacheKey("r2", { version: 1, source: "page" }));
  assert.equal(photoCacheKey("r1", null), null);
  assert.equal(photoCacheKey("r1", undefined), null);
});

test("a derived source always wins — it is correct on the first frame after a recycle", () => {
  const stale = { key: photoCacheKey("r-other", { version: 9, source: "user" })!, source: A };
  assert.equal(pickPhotoSource(derived, stale, photoCacheKey("r1", { version: 2, source: "user" })), derived);
});

test("THE RECYCLE RULE: a fetched source is used only for the key it was fetched for", () => {
  const keyA = photoCacheKey("r-a", { version: 1, source: "user" })!;
  const keyB = photoCacheKey("r-b", { version: 1, source: "user" })!;
  const fetchedForA = { key: keyA, source: A };
  assert.equal(pickPhotoSource(null, fetchedForA, keyA), A, "its own card shows it");
  // The cell was recycled to another recipe while the fetch was in flight.
  assert.equal(pickPhotoSource(null, fetchedForA, keyB), null, "never the previous recipe's picture");
  // The same recipe, a replaced photo: the old blob is not the new one.
  const v2 = photoCacheKey("r-a", { version: 2, source: "user" })!;
  assert.equal(pickPhotoSource(null, fetchedForA, v2), null, "a stale version is stale too");
  assert.equal(pickPhotoSource(null, { key: v2, source: B }, v2), B);
});

test("no picture means no source, whatever is left over in state", () => {
  const leftover = { key: photoCacheKey("r-a", { version: 1, source: "page" })!, source: A };
  assert.equal(pickPhotoSource(null, leftover, null), null, "a removed photo shows the meal-type art, not the old picture");
  assert.equal(pickPhotoSource(null, null, null), null);
});
