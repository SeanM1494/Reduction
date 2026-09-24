/**
 * The rules of a five-result search that need no database: which cached pages
 * may be shown to a stranger, how ours and the web's are merged, and what a
 * result may say about how people found it. The reads are in
 * searchLibrary.db.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeResults, proofLine, surfaceableUrl, PROOF_FLOOR } from "./searchLibrary";
import type { SearchResult } from "./searchRecipes";

const r = (url: string, title = url): SearchResult => ({ title, url, site: "", note: "" });

test("a published recipe page may surface; somebody's document or token link may not", () => {
  for (const ok of [
    "https://www.seriouseats.com/the-best-chocolate-chip-cookies",
    "http://smittenkitchen.com/2020/01/lemon-loaf/",
    "https://themodernnonna.com/greek-chicken-gyros/#recipe",
  ])
    assert.equal(surfaceableUrl(ok), true, ok);
  for (const no of [
    "https://docs.google.com/document/d/abc123/edit",
    "https://drive.google.com/file/d/abc/view",
    "https://www.dropbox.com/s/abc/recipe.pdf",
    "https://myteam.sharepoint.com/recipe",
    "https://someone.notion.site/Grandma-s-Pie-123",
    "https://example.com/recipe?token=secret",
    "https://example.com/?p=123",
    "https://user:pass@example.com/recipe",
    "https://192.168.1.10/recipe",
    "http://localhost:3000/recipe",
    "https://example.com:8443/recipe",
    "ftp://example.com/recipe",
    "not a url",
  ])
    assert.equal(surfaceableUrl(no), false, no);
});

test("five at most: up to three of ours first, the web fills the rest in its own order", () => {
  const ours = ["o1", "o2", "o3", "o4"].map((k) => r(`https://a.test/${k}`));
  const web = ["w1", "w2", "w3", "w4", "w5"].map((k) => r(`https://b.test/${k}`));
  assert.deepEqual(
    mergeResults(ours, web).map((x) => x.url.split("/").pop()),
    ["o1", "o2", "o3", "w1", "w2"],
  );
});

test("fewer than three of ours means more from the web, still five in all", () => {
  const web = ["w1", "w2", "w3", "w4", "w5", "w6"].map((k) => r(`https://b.test/${k}`));
  assert.deepEqual(mergeResults([r("https://a.test/o1")], web).map((x) => x.url.split("/").pop()), ["o1", "w1", "w2", "w3", "w4"]);
  assert.equal(mergeResults([], web).length, 5);
  assert.equal(mergeResults([], []).length, 0);
});

test("a page offered from our cache is not offered again by the web, spelled differently or not", () => {
  const out = mergeResults(
    [r("https://a.test/pie", "Ours")],
    [r("https://a.test/pie?utm_source=news", "Web copy"), r("https://b.test/other")],
  );
  assert.deepEqual(out.map((x) => x.title), ["Ours", "https://b.test/other"]);
});

test("a count below its floor is not said at all", () => {
  assert.equal(proofLine(undefined), null);
  assert.equal(proofLine({ saves: 1, cooks: 1, loved: 1, rated: 1 }), null, "never 'Saved by 1 people'");
  assert.equal(
    proofLine({ saves: PROOF_FLOOR.saves - 1, cooks: PROOF_FLOOR.cooks - 1, loved: 4, rated: PROOF_FLOOR.rated - 1 }),
    null,
  );
});

test("above the floors: kept, then cooked, then loved, two parts at most", () => {
  assert.equal(proofLine({ saves: 3, cooks: 0, loved: 0, rated: 0 }), "Saved by 3 people");
  assert.equal(proofLine({ saves: 2, cooks: 7, loved: 0, rated: 0 }), "Cooked 7 times");
  assert.equal(proofLine({ saves: 12, cooks: 40, loved: 0, rated: 0 }), "Saved by 12 people · cooked 40 times");
  assert.equal(proofLine({ saves: 0, cooks: 0, loved: 4, rated: 5 }), "80% loved it");
  assert.equal(proofLine({ saves: 12, cooks: 40, loved: 9, rated: 10 }), "Saved by 12 people · cooked 40 times");
});
