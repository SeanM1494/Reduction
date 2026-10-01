/**
 * client/src/data/demo.ts
 *
 * The landing page's live, interactive sample — not a saved recipe. Two
 * independent branches (the mash chain and the raw-veg "combine" chain)
 * converge at "fold together", so a first-time visitor sees what the
 * diagram is *for* within a couple of clicks, not just a straight line.
 *
 * This never touches the API/library/Postgres — LandingPage.tsx keeps its
 * own ephemeral `done` state in memory, exactly like a saved recipe's
 * Diagram would, just never persisted.
 */

import type { Recipe } from "../shared/layout";

export const DEMO_RECIPE: Recipe = {
  title: "Guacamole",
  servings: 4,
  sections: [
    {
      name: "Guacamole",
      ingredients: [
        { id: "avocados", qty: 3, unit: null, name: "ripe avocados" },
        { id: "lime", qty: 1, unit: null, name: "lime", note: "juiced" },
        { id: "salt", qty: 0.5, unit: "tsp", name: "kosher salt" },
        {
          id: "onion",
          qty: 0.25,
          unit: "cup",
          name: "white onion",
          note: "finely diced",
        },
        {
          id: "tomato",
          qty: 1,
          unit: null,
          name: "roma tomato",
          note: "seeded and diced",
        },
        { id: "jalapeno", qty: 1, unit: null, name: "jalape\u00f1o", note: "minced" },
        {
          id: "cilantro",
          qty: 0.25,
          unit: "cup",
          name: "fresh cilantro",
          note: "chopped",
        },
      ],
      nodes: [
        { id: "d1", label: "halve and scoop", inputs: ["avocados"] },
        { id: "d2", label: "mash to desired texture", inputs: ["d1", "lime", "salt"] },
        {
          id: "d3",
          label: "combine",
          inputs: ["onion", "tomato", "jalapeno", "cilantro"],
        },
        { id: "d4", label: "fold together", inputs: ["d2", "d3"] },
        { id: "d5", label: "rest 10 min", inputs: ["d4"], minutes: 10 },
      ],
      root: "d5",
    },
  ],
};

/** Nothing is checked at the start, like a real recipe (Oct 1, matching the
 *  phone's demo). Checking the ripe avocados alone is what makes "halve and
 *  scoop" the one amber step; no other single ingredient readies anything.
 *  Kept as a constant because Reset and "Watch it" replay from it. */
export const DEMO_PRECHECKED: string[] = [];
