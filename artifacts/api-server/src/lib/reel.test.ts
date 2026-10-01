import test from "node:test";
import assert from "node:assert/strict";
import { validateRecipe, type Recipe } from "@workspace/recipe-model";
import {
  HEADING_CURATED,
  HEADING_LOVED,
  REEL,
  assembleReel,
  cardFrom,
  qualifies,
  rankPages,
  reelUsage,
  reelUsageLine,
  staleFlags,
  usageByPage,
  withMinimum,
  type ReelCard,
  type UsageRow,
} from "./reel";

const tree = (over: Record<string, unknown> = {}): Recipe =>
  ({
    title: "Weeknight Chili",
    servings: 4,
    sourceUrl: "https://www.example-recipes.com/chili",
    source: "Example Recipes",
    mealTypes: ["dinner", "lunch"],
    image: null,
    sections: [
      {
        name: "Chili",
        ingredients: [
          { id: "beef", qty: 1, unit: "lb", name: "ground beef" },
          { id: "beans", qty: 1, unit: null, name: "can kidney beans" },
        ],
        nodes: [{ id: "cook", label: "brown and simmer", inputs: ["beef", "beans"], src: 1 }],
        root: "cook",
      },
    ],
    ...over,
  }) as unknown as Recipe;

const rows = (url: string, users: string[], opts: { cooked?: boolean; rating?: number | null } = {}): UsageRow[] =>
  users.map((u) => ({ url, userId: u, cooked: opts.cooked ?? true, rating: opts.rating ?? null }));

test("the fixture tree is valid, so a null card below is the rule and not the fixture", () => {
  assert.deepEqual(validateRecipe(tree()), []);
});

test("one account can never inflate a page: forty cooks by one account count once", () => {
  const u = usageByPage(rows("https://a.example.com/r", Array(40).fill("same-account")));
  assert.equal([...u.values()][0].cookedBy, 1);
  assert.equal(qualifies([...u.values()][0]), false);
});

test("every spelling of a page is one page (tracking tokens, www, http)", () => {
  const u = usageByPage([
    ...rows("https://www.a.example.com/r", ["u1"]),
    ...rows("http://a.example.com/r?utm_source=news", ["u2"]),
    ...rows("https://a.example.com/r", ["u3"]),
  ]);
  assert.equal(u.size, 1);
  assert.equal([...u.values()][0].cookedBy, 3);
});

test("only public-looking addresses count at all: a query string, a drive, an IP", () => {
  const u = usageByPage([
    ...rows("https://a.example.com/r?p=123", ["u1", "u2", "u3"]),
    ...rows("https://docs.google.com/document/d/abc", ["u1", "u2", "u3"]),
    ...rows("http://192.168.1.4/recipe", ["u1", "u2", "u3"]),
  ]);
  assert.equal(u.size, 0);
});

test("minimums: 3 accounts cooked it; with 5+ ratings, under 60% thumbs-up is out", () => {
  assert.equal(REEL.minCookedBy, 3);
  const two = [...usageByPage(rows("https://a.example.com/x", ["u1", "u2"])).values()][0];
  assert.equal(qualifies(two), false);
  const base = ["u1", "u2", "u3", "u4", "u5"];
  const poorlyRated = usageByPage([
    ...rows("https://a.example.com/y", base.slice(0, 2), { rating: 1 }),
    ...rows("https://a.example.com/y", base.slice(2), { rating: 0 }),
  ]);
  assert.equal(qualifies([...poorlyRated.values()][0]), false, "2 of 5 loved is 40%");
  const fewRatings = usageByPage([...rows("https://a.example.com/z", base.slice(0, 3)), ...rows("https://a.example.com/z", ["u4"], { rating: 0 })]);
  assert.equal(qualifies([...fewRatings.values()][0]), true, "a share is only judged at 5 ratings");
});

test("ranking: distinct cooks first, then the thumbs-up share, then the URL", () => {
  const five = ["u1", "u2", "u3", "u4", "u5"];
  const u = usageByPage([
    ...rows("https://a.example.com/three", ["u1", "u2", "u3"]),
    ...rows("https://a.example.com/five-80", five.slice(0, 4), { rating: 1 }),
    ...rows("https://a.example.com/five-80", ["u5"], { rating: 0 }),
    ...rows("https://a.example.com/five-100", five, { rating: 1 }),
    ...rows("https://a.example.com/five-unrated", five),
  ]);
  assert.deepEqual(rankPages(u).map((p) => new URL(p.url).pathname), ["/five-100", "/five-80", "/five-unrated", "/three"]);
});

test("the usage line says only what clears its floor, in people, never raw cooks", () => {
  assert.equal(reelUsageLine({ url: "", cookedBy: 2, rated: 0, loved: 0 }), null);
  assert.equal(reelUsageLine({ url: "", cookedBy: 3, rated: 4, loved: 4 }), "Cooked by 3 people");
  assert.equal(reelUsageLine({ url: "", cookedBy: 6, rated: 5, loved: 4 }), "Cooked by 6 people · 4 likes");
  assert.equal(reelUsageLine({ url: "", cookedBy: 12, rated: 30, loved: 25 }), "Cooked by 12 people · 25 likes");
  assert.equal(reelUsageLine({ url: "", cookedBy: 3, rated: 5, loved: 1 }), "Cooked by 3 people · 1 like");
});

test("the counts are the line's numbers, each null below its floor", () => {
  assert.deepEqual(reelUsage({ url: "", cookedBy: 2, rated: 9, loved: 9 }), { cookedBy: null, likes: 9 });
  assert.deepEqual(reelUsage({ url: "", cookedBy: 10, rated: 4, loved: 4 }), { cookedBy: 10, likes: null }, "four ratings are not yet a like count");
  assert.deepEqual(reelUsage({ url: "", cookedBy: 10, rated: 30, loved: 25 }), { cookedBy: 10, likes: 25 });
  assert.deepEqual(reelUsage(undefined), { cookedBy: null, likes: null });
});

test("a card carries the book page's summary of the page, from the recipe model", () => {
  const c = cardFrom(tree(), "curated", undefined)!;
  assert.equal(c.servings, 4);
  assert.equal(c.steps, 1);
  assert.deepEqual(c.ingredients, ["ground beef", "can kidney beans"]);
  assert.equal(c.moreIngredients, 0);
  assert.equal(c.photo, null, "the photo is the store's to set");
  assert.deepEqual([c.cookedBy, c.likes, c.usage], [null, null, null], "a curated card says nothing about use");
  const d = cardFrom(tree(), "data", { url: "", cookedBy: 7, rated: 6, loved: 5 })!;
  assert.deepEqual([d.cookedBy, d.likes, d.usage], [7, 5, "Cooked by 7 people · 5 likes"]);
  assert.equal(cardFrom(tree({ servings: 0 }), "curated", undefined)!.servings, null);
});

test("a card only from a clean URL extraction: pastes, photos and browser pages have no sourceUrl", () => {
  const card = cardFrom(tree(), "curated", undefined)!;
  assert.deepEqual(Object.keys(card).sort(), ["cookedBy", "ingredients", "kind", "likes", "mealType", "moreIngredients", "photo", "servings", "site", "steps", "title", "totalMinutes", "url", "usage"], "nothing about any person");
  assert.equal(card.site, "Example Recipes");
  assert.equal(card.mealType, "dinner");
  assert.equal(card.totalMinutes, null, "time is stated, never computed");
  assert.equal(cardFrom(tree({ totalMinutes: 45 }), "curated", undefined)!.totalMinutes, 45);
  assert.equal(cardFrom(tree({ sourceUrl: undefined }), "curated", undefined), null, "a paste, photo or browser read");
  assert.equal(cardFrom(tree({ sourceUrl: "https://drive.google.com/file/d/1" }), "curated", undefined), null);
  assert.equal(cardFrom(tree({ title: "  " }), "curated", undefined), null);
  assert.equal(cardFrom(tree({ sections: [] }), "curated", undefined), null, "a tree that fails validateRecipe");
  assert.equal(cardFrom(null, "curated", undefined), null);
});

const card = (url: string, kind: ReelCard["kind"]): ReelCard => ({
  url, title: url, site: "s", totalMinutes: null, mealType: null, servings: null, steps: 1, ingredients: [], moreIngredients: 0,
  usage: null, cookedBy: null, likes: null, photo: null, kind,
});
const rated = { url: "", cookedBy: 5, rated: 5, loved: 5 };
const unrated = { url: "", cookedBy: 5, rated: 0, loved: 0 };

test("data first, curated fills, one card per page, hidden never, at most 10", () => {
  const data = [card("https://a.example.com/1", "data"), card("https://a.example.com/2", "data")].map((c) => ({ card: c, usage: rated }));
  const curated = [card("https://www.a.example.com/2", "curated"), ...Array.from({ length: 12 }, (_, i) => card(`https://c.example.com/${i}`, "curated"))];
  const hidden = new Set(["https://c.example.com/0"]);
  const reel = assembleReel(data, curated, hidden);
  assert.equal(reel.cards.length, REEL.maxCards);
  assert.deepEqual(reel.cards.slice(0, 2).map((c) => c.kind), ["data", "data"]);
  assert.ok(!reel.cards.some((c) => c.url === "https://www.a.example.com/2"), "the curated duplicate of a data page is dropped");
  assert.ok(!reel.cards.some((c) => c.url === "https://c.example.com/0"), "hidden");
  assert.equal(reel.heading, HEADING_CURATED);
});

test('"Loved by Reduction users" only when every card is data-backed AND clears the ratings floor', () => {
  const lovedOnly = assembleReel([{ card: card("https://a.example.com/1", "data"), usage: rated }], [], new Set());
  assert.equal(lovedOnly.heading, HEADING_LOVED);
  const oneUnrated = assembleReel(
    [{ card: card("https://a.example.com/1", "data"), usage: rated }, { card: card("https://a.example.com/2", "data"), usage: unrated }],
    [],
    new Set()
  );
  assert.equal(oneUnrated.heading, HEADING_CURATED, "cooked by 5, rated by nobody, is not shown to be loved");
  const withCurated = assembleReel([{ card: card("https://a.example.com/1", "data"), usage: rated }], [card("https://c.example.com/1", "curated")], new Set());
  assert.equal(withCurated.heading, HEADING_CURATED);
});

test("warm-up flags: the step order, the picture and the original wording", () => {
  assert.deepEqual(staleFlags(tree(), true), []);
  const old = tree({ image: undefined });
  delete (old as { image?: unknown }).image;
  (old.sections[0].nodes[0] as { src?: number }).src = undefined;
  assert.deepEqual(staleFlags(old, false), ["no_step_order", "no_picture", "no_original_wording"]);
});

test("the minimum: three cards or no reel at all, and the withheld cards are named for the preview", () => {
  assert.equal(REEL.minCards, 3);
  const three = assembleReel([], [1, 2, 3].map((i) => card(`https://c.example.com/${i}`, "curated")), new Set());
  assert.deepEqual(withMinimum(three).withheld, []);
  assert.equal(withMinimum(three).reel.cards.length, 3);
  const two = assembleReel([], [1, 2].map((i) => card(`https://c.example.com/${i}`, "curated")), new Set());
  const held = withMinimum(two);
  assert.deepEqual(held.reel.cards, [], "two cards are withheld whole, never shown as a short row");
  assert.equal(held.withheld.length, 2);
  assert.equal(withMinimum({ heading: HEADING_CURATED, cards: [] }).withheld.length, 0, "an empty reel stays empty");
});

test("the heading is decided by the cards that remain once the pictureless ones are gone", () => {
  // The caller drops cards without a stored picture BEFORE assembling: with
  // the unpictured curated card gone, three loved data cards say "Loved".
  const loved = [1, 2, 3].map((i) => ({ card: card(`https://a.example.com/${i}`, "data"), usage: rated }));
  assert.equal(assembleReel(loved, [], new Set()).heading, HEADING_LOVED);
  assert.equal(assembleReel(loved, [card("https://c.example.com/1", "curated")], new Set()).heading, HEADING_CURATED, "kept, it would not");
});
