# Logic Cooking

Turns any recipe into a dependency diagram: ingredients down the left, operations nesting to the right, each step's box spanning exactly the rows it consumes. Check things off as you cook and the next available step lights up.

## Getting it running on Replit

1. **Create a Repl** — "Import from GitHub" if you've pushed this, otherwise a blank Node.js Repl and drag the folder in.
2. **Install:**
   ```
   npm install
   ```
3. **Add your API key.** Open the Secrets tab (lock icon) and add:
   ```
   ANTHROPIC_API_KEY = sk-ant-...
   ```
   Secrets, not a file. `.env` is gitignored but Repls are easy to make public by accident.
4. **Run:**
   ```
   npm run dev
   ```
   Vite serves the client on port 5000 and proxies `/api` to Express on 3001. Replit exposes 5000 as the web view.

Paste a recipe URL into the bar on the home page. It should come back with a diagram in a few seconds.

## Layout

```
shared/
  layout.ts          tree → table geometry, plus validation
  amounts.ts         qty/unit formatting and serving scaling
server/
  index.ts           Express entry, static serving in prod
  routes/recipes.ts  POST /api/recipes/extract
  lib/fetchSource.ts fetch + JSON-LD detection + HTML fallback
  lib/prompt.ts      the extraction contract
  lib/structureRecipe.ts  Claude call + validation repair loop
client/src/
  App.tsx            shell and view switching
  components/        Diagram, Home, RecipeView
  lib/api.ts         calls the extract route
  lib/storage.ts     localStorage adapter
```

`shared/layout.ts` is imported by **both** sides. The client draws with `computeLayout`; the server gates model output with `validateRecipe`, which calls the same function. That's deliberate — anything that passes validation is guaranteed to render. Don't let it become two files.

## How extraction works

`POST /api/recipes/extract` takes `{ url }`, `{ text }`, or `{ file: { data, mediaType } }` and returns `{ recipe, meta }`.

1. For a URL, fetch the page and look for `schema.org/Recipe` JSON-LD. Most modern food sites have it, which skips the messy parsing. Older sites fall back to stripped body text.
2. Send that to Claude with the rules in `lib/prompt.ts`.
3. Validate with `validateRecipe`. On failure, hand the model its own JSON plus the error list and ask for a fix. Two attempts, then a 422.

`meta.extraction` tells you whether the parse came from structured data (`jsonld`) or prose (`text`). Prose results are the ones worth eyeballing before trusting.

## Things worth knowing before you extend it

**The diagram is a tree, not a graph.** A step can feed only one later step, because a rowspan table can't draw a split. When a recipe reserves half a sauce, the convention is that the shared part becomes its own *section* and its result appears as an ingredient downstream. That rule is stated in the prompt and enforced by the validator.

**Amounts are `{ qty, unit, name }`, not strings.** That's what makes the servings stepper possible — `2.5 lb` scales, `"2½ lb / 1.1 kg"` doesn't. `unit: null` means countable, with the counting noun in the name ("large eggs"). Ingredients scale; times and pan sizes don't, and the UI says so.

**Storage is localStorage.** Fine for one person on one browser. When you want saved recipes to sync, rewrite `loadLibrary`/`saveLibrary` in `client/src/lib/storage.ts` to call your API — nothing else in the app touches persistence.

**The extraction cache is in-memory** and dies whenever the Repl sleeps, which means re-paying for extractions on wake. The Drizzle table to replace it with is sketched in a comment at the top of `routes/recipes.ts`.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite on 5000 + Express on 3001 |
| `npm run build` | Client → `dist/public` |
| `npm start` | Production: Express serves everything on `$PORT` |
| `npm run check` | `tsc --noEmit` |

## Deploying

`.replit` is set up for Autoscale: builds with `npm run build`, runs `npm start`. Add `ANTHROPIC_API_KEY` to the deployment's secrets separately — it doesn't inherit from the workspace.
