# Reduction

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

Timer notifications need three more secrets (four with the external-cron path): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` or `https:` contact — Apple rejects anything else) and `TIMER_DISPATCH_SECRET`. With the VAPID pair unset the app runs normally and hides the notifications toggle; with `TIMER_DISPATCH_SECRET` unset, `POST /api/timers/dispatch` 404s rather than running unauthenticated. Generate a pair with `node -e "console.log(require('web-push').generateVAPIDKeys())"`.

### Admin lookup

`ADMIN_SECRET` enables `GET /api/admin/user?email=…`, which returns matching accounts' ids plus their allowance and subscriptions. Unset, the route 404s.

```
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "https://<host>/api/admin/user?email=someone@example.com"
```

Matching is case-insensitive and covers both `users.email` and `identities.email`, and every match is returned — two accounts can legitimately share an address. This is a read for one operator, not an auth path and not a role system; see the note at the top of `server/routes/admin.ts`.

Signed-in users can find their own id under Settings → Account ID, with a copy button.

`PATCH /api/admin/user` sets `enforce_override` for one account — `true` forces the paywall on for them while it is off globally, `false` comps them while it is on, `null` clears back to following the global flag:

```
curl -X PATCH -H "x-admin-secret: $ADMIN_SECRET" -H 'Content-Type: application/json' \
  -d '{"userId":"<id>","enforceOverride":true,"note":"dogfooding"}' \
  "https://<host>/api/admin/user"
```

Addressed by user id, not email — email can match two accounts, and a write must not fan out. It answers with `{before, after, changed}`. Every call, including a no-op, writes a row to `admin_events` in the same transaction as the change.

### Subscriptions

Off by default. With `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` unset the billing routes 404, the paywall UI hides its own Subscribe button, and nothing is enforced.

Enforcement is a *separate* switch from configuration: `PAYWALL_ENFORCED=1` turns the wall on globally, and `account_access.enforce_override` forces it per account in either direction (`true` to live on the paid tier before anyone else, `false` to comp someone). With enforcement off the gate still runs and still records every decision to `access_events` — `decision = 'would_block'` is the wall firing in a world where the flag is on.

The Stripe webhook is mounted with `express.raw` **before** `express.json()` in `server/index.ts`. Stripe signs the raw bytes; parse them first and every event fails signature verification permanently.

**Notifications only fire while the app is awake.** An in-process interval dispatches due timers every 30s, but Autoscale scales to zero — so a timer that comes due after the deployment sleeps waits until someone opens the app. That is a deliberate bandaid, stated to the user in Settings; see ROADMAP's Phase B entry for the two paid options that fix it properly. `TIMER_DISPATCH_SECRET` is only needed for the external-cron path and can stay unset until then.

## Dependencies

The lockfile resolves against `registry.npmjs.org`, so `npm install` works off Replit
too — in CI, in a container, on a laptop. If you ever regenerate it from inside a Repl,
check that `resolved` URLs didn't get rewritten to `package-firewall.replit.local`;
those pin to a host nothing outside Replit can reach.

`.npmrc` sets `min-release-age=1440`, which blocks packages published less than a day
ago — a supply-chain buffer, since malicious releases are usually pulled within hours.
It needs npm >= 11.6; older npm ignores the key silently, which is why `packageManager`
pins a floor.
