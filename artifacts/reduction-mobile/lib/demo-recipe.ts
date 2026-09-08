/**
 * lib/demo-recipe.ts — the same ephemeral guacamole sample the web app's
 * landing page shows (see `artifacts/reduction/src/data/demo.ts`), reused
 * here so a visitor can try the app before signing in. Never touches the
 * API, LibraryContext, or storage — SignInScreen holds its own in-memory
 * `done`/`timer` state for it, exactly like a saved recipe's screen would,
 * just never persisted.
 */

import type { Recipe } from '@/shared/layout';

export const DEMO_RECIPE: Recipe = {
  title: 'Guacamole',
  servings: 4,
  sections: [
    {
      name: 'Guacamole',
      ingredients: [
        { id: 'avocados', qty: 3, unit: null, name: 'ripe avocados' },
        { id: 'lime', qty: 1, unit: null, name: 'lime', note: 'juiced' },
        { id: 'salt', qty: 0.5, unit: 'tsp', name: 'kosher salt' },
        {
          id: 'onion',
          qty: 0.25,
          unit: 'cup',
          name: 'white onion',
          note: 'finely diced',
        },
        {
          id: 'tomato',
          qty: 1,
          unit: null,
          name: 'roma tomato',
          note: 'seeded and diced',
        },
        { id: 'jalapeno', qty: 1, unit: null, name: 'jalapeño', note: 'minced' },
        {
          id: 'cilantro',
          qty: 0.25,
          unit: 'cup',
          name: 'fresh cilantro',
          note: 'chopped',
        },
      ],
      nodes: [
        { id: 'd1', label: 'halve and scoop', inputs: ['avocados'] },
        { id: 'd2', label: 'mash to desired texture', inputs: ['d1', 'lime', 'salt'] },
        {
          id: 'd3',
          label: 'combine',
          inputs: ['onion', 'tomato', 'jalapeno', 'cilantro'],
        },
        { id: 'd4', label: 'fold together', inputs: ['d2', 'd3'] },
        { id: 'd5', label: 'rest 10 min', inputs: ['d4'], minutes: 10 },
      ],
      root: 'd5',
    },
  ],
};
