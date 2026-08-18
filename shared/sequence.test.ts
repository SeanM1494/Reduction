/**
 * shared/sequence.test.ts — the cooking-order invariant.
 *
 *   A step never appears in the card sequence after a step that consumes
 *   its output.
 *
 * Asserted two ways, because there are two kinds of dependency: `inputs`
 * inside a section, and the name-matching component link between sections
 * (see shared/sequence.ts). The second one is the one that shipped broken.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateRecipe, type Recipe, type Section } from "./layout";
import { cardSequence, componentLinks, sectionOrder, stepSequence } from "./sequence";

// ------------------------------------------------------------- fixtures --

/** Two branches merging, like the guacamole demo. */
const GUAC = (): Section => ({
  name: "Guacamole",
  ingredients: [
    { id: "avocados", qty: 3, unit: null, name: "avocados" },
    { id: "lime", qty: 1, unit: null, name: "lime" },
    { id: "salt", qty: 0.5, unit: "tsp", name: "salt" },
    { id: "onion", qty: 0.25, unit: "cup", name: "onion" },
    { id: "tomato", qty: 1, unit: null, name: "tomato" },
  ],
  nodes: [
    { id: "d1", label: "halve and scoop", inputs: ["avocados"] },
    { id: "d2", label: "mash", inputs: ["d1", "lime", "salt"] },
    { id: "d3", label: "combine", inputs: ["onion", "tomato"] },
    { id: "d4", label: "fold together", inputs: ["d2", "d3"] },
  ],
  root: "d4",
});

/** The reported shape: a cookie split into a dough section and a dry-mix
 *  section, linked by an ingredient named after the dry section, with the
 *  sections in the wrong order. Every existing check passes on this. */
const SPLIT_COOKIE = (): Recipe => ({
  title: "Chocolate chip cookies",
  servings: 24,
  sections: [
    {
      name: "Dough",
      ingredients: [
        { id: "butter", qty: 1, unit: "cup", name: "butter" },
        { id: "sugar", qty: 1, unit: "cup", name: "sugar" },
        { id: "eggs", qty: 2, unit: null, name: "eggs" },
        { id: "dough_dry", qty: 1, unit: null, name: "Dry ingredients" },
        { id: "chips", qty: 2, unit: "cup", name: "chocolate chips" },
      ],
      nodes: [
        { id: "cream", label: "cream butter and sugar", inputs: ["butter", "sugar"] },
        { id: "wet", label: "beat in eggs", inputs: ["cream", "eggs"] },
        { id: "combine", label: "combine", inputs: ["wet", "dough_dry"] },
        { id: "fold", label: "fold in chips", inputs: ["combine", "chips"] },
        { id: "bake", label: "bake 375F 11 min", inputs: ["fold"], minutes: 11 },
      ],
      root: "bake",
    },
    {
      name: "Dry ingredients",
      ingredients: [
        { id: "flour", qty: 2, unit: "cup", name: "flour" },
        { id: "soda", qty: 1, unit: "tsp", name: "baking soda" },
        { id: "dsalt", qty: 1, unit: "tsp", name: "salt" },
      ],
      nodes: [{ id: "dry", label: "mix dry ingredients", inputs: ["flour", "soda", "dsalt"] }],
      root: "dry",
    },
  ],
});

// ------------------------------------------------------------- checkers --

/** Every violation of the invariant, both kinds, for one recipe. */
function violations(recipe: Recipe): string[] {
  const seq = cardSequence(recipe);
  const at = new Map(seq.map((s, i) => [s.stepId, i]));
  const sectionAt = new Map<number, number>();
  seq.forEach((s, i) => {
    if (!sectionAt.has(s.sectionIndex)) sectionAt.set(s.sectionIndex, i);
  });
  const sectionEnd = new Map<number, number>();
  seq.forEach((s, i) => sectionEnd.set(s.sectionIndex, i));

  const bad: string[] = [];

  // (1) inputs inside a section
  recipe.sections.forEach((s) => {
    for (const n of s.nodes ?? []) {
      for (const inp of n.inputs ?? []) {
        if (!at.has(inp)) continue; // an ingredient, not a step
        if (at.get(inp)! > at.get(n.id)!) bad.push(`${inp} after its consumer ${n.id}`);
      }
    }
  });

  // (2) the component link between sections: the producing section must be
  //     finished before the consuming section starts.
  const links = componentLinks(recipe);
  for (const [consumer, producers] of links) {
    for (const producer of producers) {
      const producerDone = sectionEnd.get(producer);
      const consumerStart = sectionAt.get(consumer);
      if (producerDone == null || consumerStart == null) continue;
      if (producerDone > consumerStart) {
        bad.push(
          `section "${recipe.sections[producer].name}" finishes after section ` +
            `"${recipe.sections[consumer].name}" starts, but is an ingredient of it`
        );
      }
    }
  }
  return bad;
}

const one = (section: Section): Recipe => ({ title: "t", servings: 1, sections: [section] });

// ------------------------------------------------- within one section --

test("a two-branch section emits both branches before the step that merges them", () => {
  assert.deepEqual(stepSequence(GUAC()), ["d1", "d2", "d3", "d4"]);
  assert.deepEqual(violations(one(GUAC())), []);
});

test("a short branch is not emitted after the step that consumes it", () => {
  // The case the diagram's late-packing pass changed: "dry" packs right, next
  // to the step it feeds, rather than sitting at column 1. It must still come
  // first.
  const cookie: Section = {
    name: "Cookies",
    ingredients: [
      { id: "flour", qty: 2, unit: "cup", name: "flour" },
      { id: "soda", qty: 1, unit: "tsp", name: "baking soda" },
      { id: "butter", qty: 1, unit: "cup", name: "butter" },
      { id: "sugar", qty: 1, unit: "cup", name: "sugar" },
      { id: "eggs", qty: 2, unit: null, name: "eggs" },
    ],
    nodes: [
      { id: "dry", label: "mix dry ingredients", inputs: ["flour", "soda"] },
      { id: "cream", label: "cream butter and sugar", inputs: ["butter", "sugar"] },
      { id: "wet", label: "beat in eggs", inputs: ["cream", "eggs"] },
      { id: "combine", label: "combine", inputs: ["wet", "dry"] },
      { id: "bake", label: "bake", inputs: ["combine"] },
    ],
    root: "bake",
  };
  const seq = stepSequence(cookie);
  assert.ok(seq.indexOf("dry") < seq.indexOf("combine"), `dry came after combine: ${seq}`);
  assert.deepEqual(violations(one(cookie)), []);
});

test("every step appears exactly once", () => {
  const seq = stepSequence(GUAC());
  assert.equal(seq.length, GUAC().nodes.length);
  assert.equal(new Set(seq).size, seq.length);
});

test("a section that cannot lay out sequences to nothing rather than throwing", () => {
  const broken: Section = {
    name: "Broken",
    ingredients: [{ id: "a", qty: 1, unit: null, name: "a" }],
    nodes: [{ id: "s1", label: "s", inputs: ["missing"] }],
    root: "s1",
  };
  assert.deepEqual(stepSequence(broken), []);
});

// -------------------------------------------------------- across sections --

test("the reported bug: a component section emitted after the step that uses it", () => {
  const recipe = SPLIT_COOKIE();
  // Everything the app checks already passes on this tree — that is the point.
  assert.deepEqual(validateRecipe(recipe), [], "the tree itself is valid");

  const labels = cardSequence(recipe).map(
    (s) => recipe.sections[s.sectionIndex].nodes.find((n) => n.id === s.stepId)!.label
  );
  assert.equal(labels[0], "mix dry ingredients", `got: ${labels.join(" -> ")}`);
  assert.ok(
    labels.indexOf("mix dry ingredients") < labels.indexOf("combine"),
    `dry mix must precede combine, got: ${labels.join(" -> ")}`
  );
  assert.deepEqual(violations(recipe), []);
});

test("componentLinks matches section names case- and space-insensitively", () => {
  const recipe = SPLIT_COOKIE();
  recipe.sections[1].name = "  DRY INGREDIENTS ";
  assert.deepEqual([...(componentLinks(recipe).get(0) ?? [])], [1]);
  assert.deepEqual(sectionOrder(recipe), [1, 0]);
});

test("a recipe with no component links keeps its original section order", () => {
  const recipe = SPLIT_COOKIE();
  // Break the link by renaming the ingredient; nothing should be reordered.
  recipe.sections[0].ingredients[3].name = "dry mix (already made)";
  assert.deepEqual(sectionOrder(recipe), [0, 1]);
});

test("sections already in the right order are left alone", () => {
  const recipe = SPLIT_COOKIE();
  recipe.sections.reverse();
  assert.deepEqual(sectionOrder(recipe), [0, 1]);
  assert.deepEqual(violations(recipe), []);
});

test("a cycle between sections emits every section once and does not hang", () => {
  // A bad parse can claim each section is an ingredient of the other. There is
  // no correct order, but dropping a section or looping forever are both worse
  // than falling back to the order it arrived in.
  const recipe: Recipe = {
    title: "t",
    servings: 1,
    sections: [
      {
        name: "A",
        ingredients: [
          { id: "a1", qty: 1, unit: null, name: "B" },
          { id: "a2", qty: 1, unit: null, name: "flour" },
        ],
        nodes: [{ id: "as", label: "mix a", inputs: ["a1", "a2"] }],
        root: "as",
      },
      {
        name: "B",
        ingredients: [
          { id: "b1", qty: 1, unit: null, name: "A" },
          { id: "b2", qty: 1, unit: null, name: "sugar" },
        ],
        nodes: [{ id: "bs", label: "mix b", inputs: ["b1", "b2"] }],
        root: "bs",
      },
    ],
  };
  const order = sectionOrder(recipe);
  assert.deepEqual([...order].sort(), [0, 1]);
  assert.equal(cardSequence(recipe).length, 2);
});

test("a section naming itself is not treated as its own dependency", () => {
  const recipe: Recipe = {
    title: "t",
    servings: 1,
    sections: [
      {
        name: "Sauce",
        ingredients: [{ id: "s1", qty: 1, unit: null, name: "Sauce" }],
        nodes: [{ id: "n1", label: "reduce", inputs: ["s1"] }],
        root: "n1",
      },
    ],
  };
  assert.deepEqual([...(componentLinks(recipe).get(0) ?? [])], []);
  assert.deepEqual(sectionOrder(recipe), [0]);
});

test("an empty recipe sequences to nothing", () => {
  assert.deepEqual(sectionOrder({ title: "t", servings: 1, sections: [] }), []);
  assert.deepEqual(cardSequence({ title: "t", servings: 1, sections: [] }), []);
});

// ------------------------------------------------------------------ fuzz --

test("the invariant holds across randomly generated valid trees", () => {
  // A deterministic generator, so a failure is reproducible from the seed
  // rather than being a story about a run nobody can repeat.
  let seed = 20260818;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  let checked = 0;
  for (let iter = 0; iter < 4000; iter++) {
    const ingredients: Section["ingredients"] = [];
    const nodes: Section["nodes"] = [];
    const pool: string[] = [];
    let ing = 0;
    const newIng = () => {
      const id = `i${ing++}`;
      ingredients.push({ id, qty: 1, unit: null, name: `ing ${id}` });
      pool.push(id);
      return id;
    };
    for (let i = 0; i < 3 + Math.floor(rnd() * 4); i++) newIng();
    const nSteps = 2 + Math.floor(rnd() * 7);
    for (let s = 0; s < nSteps; s++) {
      const inputs: string[] = [];
      const want = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < want; k++) {
        if (pool.length === 0 || (rnd() < 0.35 && s < nSteps - 1)) inputs.push(newIng());
        else inputs.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
      }
      nodes.push({ id: `s${s}`, label: `step ${s}`, inputs });
      pool.push(`s${s}`);
    }
    const last = nodes[nodes.length - 1];
    for (const leftover of pool) if (leftover !== last.id) last.inputs.push(leftover);

    const recipe = one({ name: "S", ingredients, nodes, root: last.id });
    if (validateRecipe(recipe).length) continue; // only trees the app accepts
    checked++;
    const bad = violations(recipe);
    assert.deepEqual(bad, [], `seed-derived tree violated the invariant: ${JSON.stringify(recipe)}`);
    assert.equal(
      cardSequence(recipe).length,
      nodes.length,
      "every step must appear exactly once"
    );
  }
  assert.ok(checked > 100, `expected a decent sample of valid trees, got ${checked}`);
});
