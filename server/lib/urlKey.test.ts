/**
 * server/lib/urlKey.test.ts
 *
 * Two halves, and the second is the important one. Folding the right things
 * together earns margin; folding the wrong things together serves somebody
 * the wrong recipe, which no hit-rate pays for. The "must not fold" block is
 * the constraint, written down.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { normalizeUrl, rawKeyOf, urlKeyOf } from "./urlKey";

const same = (a: string, b: string) =>
  urlKeyOf(a) !== null && urlKeyOf(a) === urlKeyOf(b);

const BASE = "https://example.com/recipes/chocolate-chip-cookies";

test("the raw key is unchanged, so every stored row still resolves", () => {
  // This is the identity the cache has always used. If this ever changes,
  // every row written before the change becomes unreachable.
  assert.equal(
    rawKeyOf("https://example.com/x"),
    crypto.createHash("sha256").update("url:https://example.com/x").digest("hex")
  );
});

// ------------------------------------------------------------- must fold --

test("scheme, host case and www fold", () => {
  assert.ok(same(BASE, "http://example.com/recipes/chocolate-chip-cookies"));
  assert.ok(same(BASE, "https://EXAMPLE.com/recipes/chocolate-chip-cookies"));
  assert.ok(same(BASE, "https://www.example.com/recipes/chocolate-chip-cookies"));
  assert.ok(same(BASE, "http://WWW.Example.COM/recipes/chocolate-chip-cookies"));
});

test("default ports, fragments and trailing slashes fold", () => {
  assert.ok(same(BASE, "https://example.com:443/recipes/chocolate-chip-cookies"));
  assert.ok(same(BASE, "http://example.com:80/recipes/chocolate-chip-cookies"));
  assert.ok(same(BASE, `${BASE}#ingredients`));
  assert.ok(same(BASE, `${BASE}/`));
  assert.ok(same(BASE, `${BASE}///`));
});

test("tracking parameters fold — this is the share-sheet case", () => {
  // What a phone actually pastes.
  assert.ok(same(BASE, `${BASE}?utm_source=pinterest&utm_medium=social`));
  assert.ok(same(BASE, `${BASE}?fbclid=IwAR0abc`));
  assert.ok(same(BASE, `${BASE}?gclid=xyz&utm_campaign=spring`));
  assert.ok(same(BASE, `${BASE}?mc_cid=1&mc_eid=2`));
  assert.ok(same(BASE, `${BASE}?_ga=2.1&_gl=1`));
  assert.ok(same(BASE, `${BASE}?igshid=abc`));
  assert.ok(same(BASE, `${BASE}?amp=1`));
  // The whole lot at once, plus a fragment and a trailing slash.
  assert.ok(same(BASE, `${BASE}/?utm_source=x&fbclid=y&utm_medium=z#recipe`));
});

test("parameter order does not matter", () => {
  assert.ok(same(`${BASE}?page=2&print=1`, `${BASE}?print=1&page=2`));
});

// --------------------------------------------------------- must NOT fold --

test("content-selecting parameters are kept — a deny-list, never an allow-list", () => {
  // The failure this rule exists to prevent: serving page 1 to someone who
  // asked for page 2, or a 4-serving tree to someone who asked for 8.
  assert.ok(!same(BASE, `${BASE}?page=2`));
  assert.ok(!same(`${BASE}?page=2`, `${BASE}?page=3`));
  assert.ok(!same(BASE, `${BASE}?print=1`));
  assert.ok(!same(BASE, `${BASE}?servings=6`));
  assert.ok(!same(`${BASE}?servings=4`, `${BASE}?servings=8`));
  // Unknown parameters are kept, which is the whole point of a deny-list:
  // the default for something we have never heard of is to preserve it.
  assert.ok(!same(BASE, `${BASE}?variant=vegan`));
  assert.ok(!same(BASE, `${BASE}?id=91234`));
  // Three that read like trackers and are deliberately NOT folded, because
  // they are just as plausible as content selectors.
  assert.ok(!same(BASE, `${BASE}?ref=homepage`));
  assert.ok(!same(BASE, `${BASE}?source=newsletter`));
});

test("paths stay case-sensitive, because servers do", () => {
  assert.ok(!same(BASE, "https://example.com/Recipes/Chocolate-Chip-Cookies"));
});

test("a trailing /amp path segment is a path, not a flag", () => {
  assert.ok(!same(BASE, `${BASE}/amp`));
});

test("different pages, hosts and subdomains stay different", () => {
  assert.ok(!same(BASE, "https://example.com/recipes/oatmeal-cookies"));
  assert.ok(!same(BASE, "https://other.com/recipes/chocolate-chip-cookies"));
  // Only a leading "www." is folded; any other subdomain is its own site.
  assert.ok(!same(BASE, "https://blog.example.com/recipes/chocolate-chip-cookies"));
});

test("repeated keys keep their order", () => {
  assert.ok(!same(`${BASE}?a=1&a=2`, `${BASE}?a=2&a=1`));
});

// ------------------------------------------------------------- non-URLs --

test("anything unparseable has no alias at all", () => {
  // Null rather than a fallback to the raw string: two strings that both fail
  // to parse must never end up sharing a key.
  for (const bad of ["", "   ", "not a url", "/recipes/x", "example.com/x"]) {
    assert.equal(normalizeUrl(bad), null);
    assert.equal(urlKeyOf(bad), null);
  }
});

test("non-http schemes have no alias", () => {
  for (const bad of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "ftp://example.com/x",
  ]) {
    assert.equal(urlKeyOf(bad), null);
  }
});

test("the alias digest cannot be confused with a raw digest", () => {
  // Different prefixes, so a normalised URL that happens to equal some other
  // URL's raw string cannot let one lookup answer for the other.
  const u = "https://example.com/x";
  assert.notEqual(urlKeyOf(u), rawKeyOf(u));
  assert.notEqual(urlKeyOf(u), rawKeyOf(normalizeUrl(u)!));
});

test("normalisation is idempotent", () => {
  for (const u of [
    BASE,
    `${BASE}/?utm_source=x#y`,
    "http://WWW.Example.com:80/A/b/?b=2&a=1",
  ]) {
    const once = normalizeUrl(u)!;
    assert.equal(normalizeUrl(once), once);
  }
});
