import { test } from "node:test";
import assert from "node:assert/strict";
import type { Recipe } from "./layout";
import { clampSourceText, leadInFrom, sentencesOf, sourceTextsByStep } from "./sourceText";

/** One section; `steps` are [id, label, ingredient names, src, input step ids]. */
function recipe(steps: [string, string, string[], number | null, string[]?][]): Recipe {
  const ingredients: Recipe["sections"][number]["ingredients"] = [];
  const nodes: Recipe["sections"][number]["nodes"] = [];
  for (const [id, label, ings, src, from] of steps) {
    const ids = ings.map((name, i) => {
      const iid = `${id}_i${i}`;
      ingredients.push({ id: iid, qty: 1, unit: null, name });
      return iid;
    });
    nodes.push({ id, label, inputs: [...(from ?? []), ...ids], ...(src === null ? {} : { src }) } as never);
  }
  return { title: "t", servings: 4, sections: [{ name: "S", ingredients, nodes, root: steps[steps.length - 1][0] }] } as Recipe;
}

// The shape reported on a real phone (Strawberry Rhubarb Bars, crust steps
// 3–5 of 12): one source paragraph, three "pulse" steps, and every card
// captioned with the whole paragraph.
const CRUST =
  "In the bowl of a food processor, pulse the flour, sugar and salt to combine. " +
  "Add the cold butter and pulse until the mixture resembles coarse crumbs. " +
  "Add the egg yolk and pulse until the dough just begins to clump together.";

test("one paragraph, three steps: each card gets its own sentence, and nothing is repeated or lost", () => {
  const r = recipe([
    ["p1", "pulse dry ingredients", ["flour", "sugar", "salt"], 1],
    ["p2", "pulse to coarse crumbs", ["cold butter"], 1, ["p1"]],
    ["p3", "pulse until clumping", ["egg yolk"], 1, ["p2"]],
  ]);
  const t = sourceTextsByStep(r, [CRUST], ["p1", "p2", "p3"]);
  assert.equal(t.get("p1")!.text, "In the bowl of a food processor, pulse the flour, sugar and salt to combine.");
  assert.equal(t.get("p2")!.text, "Add the cold butter and pulse until the mixture resembles coarse crumbs.");
  assert.equal(t.get("p3")!.text, "Add the egg yolk and pulse until the dough just begins to clump together.");
  assert.equal([...t.values()].map((x) => x.text).join(" "), CRUST, "the runs together are the paragraph, verbatim");
  assert.ok([...t.values()].every((x) => !x.shared));
  assert.equal(t.get("p1")!.leadIn, "In the bowl of a food processor");
  assert.equal(t.get("p2")!.leadIn, null, "the vessel is named once, on the step it belongs to");
});

test("a sentence that matches nothing stays with the step before it", () => {
  const text =
    "Preheat the oven to 350 degrees F.In a medium bowl, sift the flour, baking powder, baking soda and salt. Set aside. " +
    "In a large mixing bowl beat together peanut butter, coconut oil and brown sugar until creamy. " +
    "Beat in the eggs and vanilla.";
  const r = recipe([
    ["a", "sift dry ingredients", ["all-purpose flour", "baking powder", "baking soda", "salt"], 1],
    ["b", "beat until creamy", ["peanut butter", "coconut oil", "brown sugar"], 1],
    ["c", "beat in eggs and vanilla", ["large eggs", "vanilla extract"], 1, ["b"]],
  ]);
  const t = sourceTextsByStep(r, [text], ["a", "b", "c"]);
  assert.match(t.get("a")!.text, /sift the flour.*Set aside\.$/);
  assert.match(t.get("b")!.text, /^In a large mixing bowl beat together/);
  assert.equal(t.get("c")!.text, "Beat in the eggs and vanilla.");
  assert.equal(t.get("a")!.leadIn, "In a medium bowl");
  assert.equal(t.get("b")!.leadIn, "In a large mixing bowl");
});

test("fewer sentences than steps: split at clauses; still fewer: share, and say so", () => {
  const r = recipe([
    ["f", "fold in flour", ["all-purpose flour"], 5],
    ["w", "fold in walnuts", ["walnuts"], 5, ["f"]],
  ]);
  const text = "Add the flour last and fold just until no dry streaks remain, then fold in the walnuts.";
  const t = sourceTextsByStep(r, ["", "", "", "", text], ["f", "w"]);
  assert.equal(t.get("f")!.text, "Add the flour last and fold just until no dry streaks remain,");
  assert.equal(t.get("w")!.text, "then fold in the walnuts.");

  const wash = recipe([
    ["b", "beat", ["egg"], 6],
    ["r", "brush", ["Egg wash"], 6, ["b"]],
  ]);
  const both = "Whisk the egg with a splash of water and brush it over each pocket.";
  const w = sourceTextsByStep(wash, ["", "", "", "", "", both], ["b", "r"]);
  assert.equal(w.get("b")!.text, "Whisk the egg with a splash of water");
  assert.equal(w.get("r")!.text, "and brush it over each pocket.");
  const list = recipe([
    ["d", "whisk dry", ["flour", "sugar"], 1],
    ["m", "stir in milk", ["milk"], 1, ["d"]],
  ]);
  const l = sourceTextsByStep(list, ["Whisk the flour, sugar and salt."], ["d", "m"]);
  assert.ok(l.get("d")!.shared && l.get("m")!.shared, "a list is never cut at its 'and': one piece, shared");

  const three = recipe([
    ["x", "season chicken", ["chicken thighs", "salt"], 1],
    ["y", "brown chicken in batches", ["olive oil"], 1, ["x"]],
    ["z", "rest chicken", [], 1, ["y"]],
  ]);
  const one = "Cook the salted chicken in the oil.";
  const s = sourceTextsByStep(three, [one], ["x", "y", "z"]);
  assert.ok([...s.values()].every((v) => v.text === one && v.shared), "one piece for three steps is shared, and flagged");
});

test("the lead-in is the vessel the step's own words name, whatever the label says", () => {
  // The tikka masala on a real phone: the marinade got "In a bowl" from
  // the word "mix" in its label; the sear, in the same recipe, got "Add:".
  const marinade = "Combine all ingredients except chicken in a bowl and mix. Add chicken and turn well to coat.";
  const sear = "Heat 1 tbsp oil in a non stick pan over high heat until smoking. Add half the chicken and spread out.";
  const r = recipe([
    ["m", "mix marinade", ["plain yoghurt", "garam masala"], 1],
    ["c", "coat chicken", ["chicken thigh"], 1, ["m"]],
    ["s", "sear chicken in batches", ["oil"], 3, ["c"]],
  ]);
  const t = sourceTextsByStep(r, [marinade, "", sear], ["m", "c", "s"]);
  assert.equal(t.get("m")!.leadIn, "In a bowl");
  assert.equal(t.get("s")!.leadIn, "In a non stick pan over high heat");
  assert.equal(leadInFrom("Place in the oven for 20 minutes."), null, "an oven is not somewhere you add things");
  assert.equal(leadInFrom("Transfer into a lightly greased 9x13 baking dish."), "In a lightly greased 9x13 baking dish");
  assert.equal(leadInFrom(null), null);
});

test("untagged recipes and missing wording: nothing, never a guess", () => {
  const r = recipe([["a", "mix", ["flour"], null]]);
  assert.equal(sourceTextsByStep(r, ["Mix the flour."]).size, 0);
  const tagged = recipe([["a", "mix", ["flour"], 4]]);
  assert.equal(sourceTextsByStep(tagged, ["Mix the flour."]).size, 0, "src past the wording's end");
  assert.equal(sourceTextsByStep(tagged, null).size, 0);
});

test("sentences: a run-together page splits, a decimal does not", () => {
  assert.deepEqual(sentencesOf("Heat to 350 F.In a bowl, mix 1.5 cups flour. Stir."), ["Heat to 350 F.", "In a bowl, mix 1.5 cups flour.", "Stir."]);
});

test("property: for any division, the runs are the step's pieces in order — nothing dropped, nothing doubled", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const vocab = ["flour", "sugar", "butter", "egg", "milk", "salt", "onion", "garlic", "stir", "whisk", "bake", "fold"];
  for (let trial = 0; trial < 500; trial++) {
    const k = 2 + Math.floor(rand() * 4);
    const n = k + Math.floor(rand() * 4);
    const sentences = Array.from({ length: n }, (_, i) => `Step ${String.fromCharCode(65 + i)} ${vocab[Math.floor(rand() * vocab.length)]} well.`);
    const steps: [string, string, string[], number, string[]?][] = Array.from({ length: k }, (_, j) => [
      `s${j}`,
      `${vocab[Math.floor(rand() * vocab.length)]} it`,
      [vocab[Math.floor(rand() * vocab.length)]],
      1,
      j ? [`s${j - 1}`] : [],
    ]);
    const t = sourceTextsByStep(recipe(steps), [sentences.join(" ")], steps.map((s) => s[0]));
    const runs = steps.map((s) => t.get(s[0])!.text);
    assert.ok(runs.every(Boolean), "every step gets a run");
    assert.equal(runs.join(" "), sentences.join(" "));
  }
});

test("a long run is cut after whole sentences, the rest kept for a tap", () => {
  const knead =
    "Knead the dough: keep the dough in the mixer and beat for an additional 5 full minutes, or knead by hand on a lightly floured surface for 5 full minutes. " +
    "If the dough becomes too sticky, sprinkle in 1 teaspoon of flour at a time. " +
    "Poke it with your finger: if it slowly bounces back, your dough is ready to rise. " +
    "You can also do a windowpane test.";
  const { head, rest } = clampSourceText(knead);
  assert.equal(head, sentencesOf(knead)[0]);
  assert.equal(`${head} ${rest}`, knead);
  assert.deepEqual(clampSourceText("Short. Two sentences."), { head: "Short. Two sentences.", rest: null });
});

// Verbatim from the saved recipe on a real phone (Strawberry Rhubarb Bars,
// Sep 27): one source step, two sections, three cards that each showed all
// of it.
const BARS_REAL =
  "Make the crust and crumble: In a food processor, pulse the flour, granulated sugar, brown sugar, baking powder, and salt to combine. " +
  "Add the butter, cream cheese, and almond extract and pulse until coarse crumbs form, about 10 pulses. " +
  "Remove one-third of the mixture (about 1 2/3 cups) and set aside in a medium bowl for the topping. " +
  "Add the milk to the food processor and pulse until the remaining mixture clumps when squeezed, about 5 pulses. " +
  "It should still be crumbly, not doughy.";

test("the real Strawberry Rhubarb Bars paragraph: three cards, three shares, the right vessel on each", () => {
  const r = {
    title: "Strawberry Rhubarb Bars",
    servings: 16,
    sections: [
      {
        name: "Crumb base",
        ingredients: [
          { id: "f", qty: 2.5, unit: "cup", name: "all-purpose flour" },
          { id: "g", qty: 0.5, unit: "cup", name: "granulated sugar" },
          { id: "b", qty: 0.5, unit: "cup", name: "light brown sugar" },
          { id: "bp", qty: 1, unit: "tsp", name: "baking powder" },
          { id: "s", qty: 0.5, unit: "tsp", name: "kosher salt" },
          { id: "bu", qty: 18, unit: "tbsp", name: "cold salted butter" },
          { id: "cc", qty: 3, unit: "oz", name: "cold cream cheese" },
          { id: "al", qty: 0.5, unit: "tsp", name: "almond extract" },
        ],
        nodes: [
          { id: "d", label: "pulse dry ingredients", inputs: ["f", "g", "b", "bp", "s"], src: 2 },
          { id: "c", label: "pulse to coarse crumbs", inputs: ["d", "bu", "cc", "al"], src: 2 },
        ],
        root: "c",
      },
      {
        name: "Crust",
        ingredients: [
          { id: "cb", qty: 1, unit: null, name: "crumb base" },
          { id: "m", qty: 3, unit: "tbsp", name: "milk" },
        ],
        nodes: [{ id: "k", label: "pulse until clumping", inputs: ["cb", "m"], src: 2 }],
        root: "k",
      },
    ],
  } as unknown as Recipe;
  const t = sourceTextsByStep(r, ["Preheat the oven.", BARS_REAL], ["d", "c", "k"]);
  assert.equal(t.get("d")!.text, "Make the crust and crumble: In a food processor, pulse the flour, granulated sugar, brown sugar, baking powder, and salt to combine.");
  assert.match(t.get("c")!.text, /^Add the butter, cream cheese, and almond extract .*for the topping\.$/);
  assert.match(t.get("k")!.text, /^Add the milk to the food processor .* not doughy\.$/);
  assert.equal([...t.values()].map((x) => x.text).join(" "), BARS_REAL);
  assert.equal(t.get("d")!.leadIn, "In a food processor");
  assert.equal(t.get("c")!.leadIn, null, "the medium bowl is where the TOPPING waits, not where the butter goes");
  assert.equal(t.get("k")!.leadIn, "In the food processor");
  assert.equal(leadInFrom("Bring to a boil in a large pot."), "In a large pot", "'to a boil' is not a vessel");
});
