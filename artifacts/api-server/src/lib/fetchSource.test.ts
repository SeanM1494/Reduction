import { test } from "node:test";
import assert from "node:assert/strict";
import { imageUrlOf, sourceFromHtml } from "./fetchSource";

const page = "https://example.com/recipes/lemon-loaf";

test("schema.org image: a string, an array, an ImageObject, and the first usable wins", () => {
  assert.equal(imageUrlOf("https://cdn.example.com/loaf.jpg"), "https://cdn.example.com/loaf.jpg");
  assert.equal(imageUrlOf(["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]), "https://cdn.example.com/a.jpg");
  assert.equal(imageUrlOf({ "@type": "ImageObject", url: "https://cdn.example.com/obj.jpg" }), "https://cdn.example.com/obj.jpg");
  assert.equal(imageUrlOf({ "@type": "ImageObject", contentUrl: "https://cdn.example.com/c.jpg" }), "https://cdn.example.com/c.jpg");
  assert.equal(imageUrlOf([{ "@type": "ImageObject" }, "https://cdn.example.com/second.jpg"]), "https://cdn.example.com/second.jpg", "an object with no url is skipped, not fatal");
});

test("relative URLs resolve against the page; everything that is not a web address is null", () => {
  assert.equal(imageUrlOf("/images/loaf.jpg", page), "https://example.com/images/loaf.jpg");
  assert.equal(imageUrlOf("//cdn.example.com/x.jpg", page), "https://cdn.example.com/x.jpg");
  assert.equal(imageUrlOf("data:image/png;base64,AAAA", page), null, "a data URI is bytes, not a pointer the server fetches");
  assert.equal(imageUrlOf("javascript:alert(1)", page), null);
  assert.equal(imageUrlOf("", page), null);
  assert.equal(imageUrlOf(undefined, page), null);
  assert.equal(imageUrlOf(42, page), null);
  assert.equal(imageUrlOf("x".repeat(3000), page), null, "an absurd length is refused");
});

// ----------------------------------------------------------- total time ---

// WP Recipe Maker, which a large share of recipe sites run: the Recipe node
// inside an @graph, with prepTime and cookTime beside totalTime.
const wprm = (extra: Record<string, unknown>) => `<!doctype html><html><head>
<meta property="og:site_name" content="A Recipe Site">
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "A Recipe Site" },
    {
      "@type": "Recipe",
      name: "Garlic Knots",
      recipeIngredient: ["1 cup warm water", "2 cups flour", "3 cloves garlic"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Mix." }, { "@type": "HowToStep", text: "Bake." }],
      ...extra,
    },
  ],
})}</script></head><body></body></html>`;
const at = new URL("https://example.com/garlic-knots/");

test("total time: the page's own schema.org totalTime is captured, in minutes", () => {
  const src = sourceFromHtml(wprm({ prepTime: "PT15M", cookTime: "PT20M", totalTime: "PT1H35M" }), at);
  assert.equal(src.quality, "jsonld");
  assert.equal(src.totalMinutes, 95, "the stated total — which includes a rise that prep + cook would miss");
});

test("total time: no totalTime means none — prep and cook are NOT added up", () => {
  // Summing looks harmless and is exactly the confident wrong number the
  // spec rules out: for anything with a rise, a chill or a rest, the total
  // is longer than prep + cook.
  const src = sourceFromHtml(wprm({ prepTime: "PT15M", cookTime: "PT20M" }), at);
  assert.equal(src.totalMinutes, null);
  assert.equal(sourceFromHtml(wprm({ totalTime: "PT0M" }), at).totalMinutes, null, "a zero from a site that never set one");
  assert.equal(sourceFromHtml(wprm({ totalTime: "45 minutes" }), at).totalMinutes, null, "free text in a structured field");
});

test("total time: a page without structured data leaves it to the model, which read the text", () => {
  const prose = `<html><head><title>Garlic knots</title></head><body><p>${"Knead the dough and shape the knots. ".repeat(20)}Total time: 45 minutes.</p></body></html>`;
  const src = sourceFromHtml(prose, at);
  assert.equal(src.quality, "text");
  assert.equal(src.totalMinutes, null, "not parsed here: on a text page the model reads the stated total");
  assert.match(src.text, /Total time: 45 minutes/, "and the text it reads still carries it");
});

// ----------------------------------------------------- original wording ---

test("original wording: a JSON-LD page gives the card's own lines, and nothing of the post around it", () => {
  const html = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
    "@type": "Recipe",
    name: "Lemon Loaf",
    recipeIngredient: ["1 1/2 cups flour", "1&nbsp;cup sugar", "2 lemons, zested"],
    recipeInstructions: [
      {
        "@type": "HowToSection",
        name: "Make the loaf",
        itemListElement: [
          { "@type": "HowToStep", text: "Heat the oven to 350°F." },
          { "@type": "HowToStep", text: "Whisk the <b>flour</b> and sugar." },
        ],
      },
      { "@type": "HowToSection", name: "Glaze", itemListElement: [{ "@type": "HowToStep", text: "Stir lemon juice into sugar." }] },
    ],
  })}</script></head><body><main>
<p>My grandmother made this loaf every summer at the lake, and I still remember the smell of lemons drifting across the porch while we waited.</p>
<p>Jump to recipe. Pin it for later! 147 comments.</p></main></body></html>`;
  const src = sourceFromHtml(html, new URL(page));
  assert.equal(src.quality, "jsonld");
  assert.deepEqual(src.original, {
    ingredients: [{ text: "1 1/2 cups flour" }, { text: "1 cup sugar" }, { text: "2 lemons, zested" }],
    steps: [
      { text: "Make the loaf", heading: true },
      { text: "Heat the oven to 350°F." },
      { text: "Whisk the flour and sugar." },
      { text: "Glaze", heading: true },
      { text: "Stir lemon juice into sugar." },
    ],
    truncated: false,
    from: "page",
  });
  const everything = JSON.stringify(src.original);
  assert.ok(!/grandmother|porch|Pin it|comments/.test(everything), "the story and the page furniture never reach it");
  // The model sees the same steps, cleaned and numbered from the same
  // list, so source step 2 IS the second non-heading line above.
  assert.deepEqual(src.instructions, ["Heat the oven to 350°F.", "Whisk the flour and sugar.", "Stir lemon juice into sugar."]);
});

test("original wording: a page without structured data has none here — the model copies it out", () => {
  const html = `<html><body><main>${"Mix the flour and water, then knead for ten minutes until smooth. ".repeat(6)}</main></body></html>`;
  const src = sourceFromHtml(html, new URL(page));
  assert.equal(src.quality, "text");
  assert.equal(src.original, null);
});
