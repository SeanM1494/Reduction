# Reduction

Turns any recipe into a dependency diagram: ingredients down the left, operations nesting to the right, each step's box spanning exactly the rows it consumes. Check things off as you cook and the next available step lights up.

## Getting it running on Replit

1. **Create a Repl** — "Import from GitHub" if you've pushed this, otherwise a blank Node.js Repl and drag the folder in.
2. **Install:**
   ```
   pnpm install
   ```
3. **Add your API key.** Open the Secrets tab (lock icon) and add:
   ```
   ANTHROPIC_API_KEY = sk-ant-...
   ```
   Secrets, not a file. `.env` is gitignored but Repls are easy to make public by accident.
4. **Run:**
   ```
   pnpm run dev
   ```
   Vite serves the client on port 5000 and proxies `/api` to Express on 3001. Replit exposes 5000 as the web view.

Paste a recipe URL into the bar on the home page. It should come back with a diagram in a few seconds.

## Layout

```
lib/recipe-model/src/
  layout.ts          tree → table geometry, plus validation
  amounts.ts         qty/unit formatting and serving scaling
artifacts/api-server/src/
  index.ts           Express entry, static serving in prod
  routes/recipes.ts  POST /api/recipes/extract
  lib/fetchSource.ts fetch + JSON-LD detection + HTML fallback
  lib/prompt.ts      the extraction contract
  lib/structureRecipe.ts  Claude call + validation repair loop
artifacts/reduction/src/
  App.tsx            shell and view switching
  components/        Diagram, Home, RecipeView
  lib/api.ts         calls the extract route
  lib/storage.ts     localStorage adapter
```

`lib/recipe-model/src/layout.ts` is imported by **both** sides. The client draws with `computeLayout`; the server gates model output with `validateRecipe`, which calls the same function. That's deliberate — anything that passes validation is guaranteed to render. Don't let it become two files.

## How extraction works

`POST /api/recipes/extract` takes `{ url }`, `{ text }`, `{ file: { data, mediaType } }` or `{ page: { url, html } }` and returns `{ recipe, meta }`.

`page` (Sep 28) is a page the phone's in-app browser already has — how a site that refuses every server is read at all: allrecipes.com answers our fetch with a 402 and refuses Anthropic's outright. The HTML goes through the same parse as our own fetch (`sourceFromHtml`, then `recipeFromSource` in `lib/readRecipe.ts`: structured data when present, one call, the card's own wording), with no fallback fetch. **It is cached by what the page SAYS (`pageKey`), never by the URL it claims, and the cached copy carries no `sourceUrl`** — the sender chose the HTML, so a page read behind someone's login, or claimed to be from a URL it is not, must never answer another person's paste of that URL or reach search, which offers cached rows by `sourceUrl`. A content key only matches someone who already has the identical recipe in hand; `routes/page.db.test.ts` pins all of it. A URL extraction that ends in "This site blocked us…" carries `code: "site_blocked"`, which is what the phone keys its "Open in browser" offer on — it opens the page in Find's Browse tab, the in-app browser, which is also where anyone can browse a recipe site and extract from it (ROADMAP "Find: three tabs").

1. For a URL, fetch the page and look for `schema.org/Recipe` JSON-LD. Most modern food sites have it, which skips the messy parsing. Older sites fall back to stripped body text.
2. Send that to Claude with the rules in `lib/prompt.ts`.
3. Validate with `validateRecipe`. On failure, hand the model its own JSON plus the error list and ask for a fix. Two attempts, then a 422.

`meta.extraction` tells you whether the parse came from structured data (`jsonld`) or prose (`text`). Prose results are the ones worth eyeballing before trusting.

## Things worth knowing before you extend it

**The diagram is a tree, not a graph.** A step can feed only one later step, because a rowspan table can't draw a split. When a recipe reserves half a sauce, the convention is that the shared part becomes its own *section* and its result appears as an ingredient downstream. That rule is stated in the prompt and enforced by the validator.

**Amounts are `{ qty, unit, name }`, not strings.** That's what makes the servings stepper possible — `2.5 lb` scales, `"2½ lb / 1.1 kg"` doesn't. `unit: null` means countable, with the counting noun in the name ("large eggs"). Ingredients scale; times and pan sizes don't, and the UI says so.

**Storage is localStorage.** Fine for one person on one browser. When you want saved recipes to sync, rewrite `loadLibrary`/`saveLibrary` in `artifacts/reduction/src/lib/storage.ts` to call your API — nothing else in the app touches persistence.

**The extraction cache is in-memory** and dies whenever the Repl sleeps, which means re-paying for extractions on wake. The Drizzle table to replace it with is sketched in a comment at the top of `routes/recipes.ts`.

## Scripts

| | |
|---|---|
| `pnpm run dev` | Vite on 5000 + Express on 3001 |
| `pnpm run build` | Client → `dist/public` |
| `npm start` | Production: Express serves everything on `$PORT` |
| `pnpm run check` | `tsc --noEmit` |

## Deploying

`.replit` is set up for Autoscale: builds with `pnpm run build`, runs `npm start`. Add `ANTHROPIC_API_KEY` to the deployment's secrets separately — it doesn't inherit from the workspace.

Timer notifications need three more secrets (four with the external-cron path): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` or `https:` contact — Apple rejects anything else) and `TIMER_DISPATCH_SECRET`. With the VAPID pair unset the app runs normally and hides the notifications toggle; with `TIMER_DISPATCH_SECRET` unset, `POST /api/timers/dispatch` 404s rather than running unauthenticated. Generate a pair with `node -e "console.log(require('web-push').generateVAPIDKeys())"`.

**Native (Expo) push needs no secrets.** The dispatcher has a second delivery
arm for Expo push tokens, relayed through Expo's push service to APNs/FCM, and
it runs whether or not the VAPID pair is set. The mobile app registers with
`POST /api/push/subscribe` and a body of `{ "expoPushToken": "ExponentPushToken[…]" }`
(from `expo-notifications`' `getExpoPushTokenAsync({ projectId })` — the EAS
project id must be in `app.json`, and the iOS simulator cannot mint a token).
Two optional variables: `EXPO_ACCESS_TOKEN` (an Expo access token; raises the
service's per-token rate limits, sent as a bearer header when set) and
`EXPO_PUSH_URL` (the test suite points it at a loopback stub; leave unset in
production).

### Running the mobile app in Expo Go

`pnpm --filter ./artifacts/reduction-mobile run dev` is what Replit's mobile
workflow runs. It starts with `scripts/expo-session.mjs`, which signs Expo CLI
in from `REPLIT_EXPO_SESSION_SECRET` and prints who the server is, then
starts Metro through Replit's packager proxy.

**If the phone shows "signed in to Expo Go as replit-private-…, but not
signed in to Expo CLI", no line of the app has run.** A signed-in Expo Go
demands a signed manifest, and signing needs both a logged-in CLI and an EAS
project id in `app.json` (`extra.eas.projectId`), which this app does not
have yet. Until it does, open the app with Expo Go **signed out**
(Profile → Sign out, scan the QR again). The Metro log says at every start
which of the two conditions is missing.

### Sign in with Apple

Four secrets, all from the Apple Developer console:

| secret | value | where it comes from |
|---|---|---|
| `APPLE_CLIENT_ID` | the **Services ID** (`com.example.appservices`) | Identifiers → Services IDs. NOT the App ID or bundle id. |
| `APPLE_TEAM_ID` | 10-character Team ID | top right of the console, or Membership |
| `APPLE_KEY_ID` | 10-character Key ID | Keys → the Sign in with Apple key |
| `APPLE_PRIVATE_KEY` | the whole `.p8` file's contents | downloaded once, at key creation |

`APPLE_PRIVATE_KEY` takes the **file's text pasted directly**, including the
`-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. No
base64-wrapping, no path — the file itself is never deployed. A multiline
paste is fine; a single-line paste with literal `\n` also works, because
`normalisePem` in `artifacts/api-server/src/lib/apple.ts` accepts both.

`PUBLIC_BASE_URL` must match a redirect URI registered on the Services ID
byte for byte — Apple compares exactly — and the callback path is
`/api/auth/apple/callback`.

The client secret is an ES256 JWT minted from the key on demand and cached
until it nears expiry, never stored. Apple caps it at six months; this uses 90
days. Rotating the key in Secrets takes effect on the next call, because the
cache is keyed on the Key ID.

With any of the four missing the app runs normally and the Apple button shows
as "Coming soon" rather than offering a sign-in that would fail.

**To check what a deployment is actually running with** (needs `ADMIN_SECRET`):

```
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "https://<host>/api/admin/preflight/apple"
```

It reports the Services ID, Key ID and redirect URI the *running process*
holds, whether the private key parses, and the client secret's shape —
signature encoding, and whether `iss`/`sub` are the right way round. No secret
is disclosed. This is the fastest way to tell a stale deployment apart from a
misconfiguration, because both produce an identical `invalid_client`.

`privateKeyEnv` in that response describes what actually landed in
`APPLE_PRIVATE_KEY` without disclosing it: character and byte counts (these
differ exactly when something non-ASCII crept in), the first and last 15
characters (fixed PEM boilerplate in a healthy key), literal backslash-n
versus real newlines, and flags for a BOM, CRLF, surrounding quotes and smart
punctuation. `repairs` lists what `normalisePem` had to fix.

Most damage is now repaired automatically — literal backslash-n, CRLF, a BOM,
surrounding quotes, and **newlines stripped entirely**, which some secrets UIs
do while leaving the value looking perfectly correct. What cannot be repaired
is a corrupted header (an editor turning the dashes into an em-dash), a
missing BEGIN line, or a truncated body; each is flagged by name rather than
reported as a generic parse failure.

**Deleting an account revokes its Sign in with Apple token** (Apple asks
this of every app offering that sign-in). The code exchange returns a
refresh token, which the callback keeps in `apple_tokens` for that alone;
`DELETE /api/account` reads it before the rows go and, after they are gone,
posts it to `https://appleid.apple.com/auth/revoke`. The app then disappears
from the person's Settings › Apple Account › Sign in with Apple. Neither step
can fail a sign-in or a deletion (`lib/appleTokens.ts`): an account with no
stored token — everyone who signed in before this shipped — or a refusal
from Apple comes back as `appleSignIn: "manual"`, and both clients tell the
person to remove the app there themselves. Hand-run DDL, safe to run twice:

```sql
create table if not exists apple_tokens (
  subject text primary key,
  user_id text not null references users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
create index if not exists apple_tokens_user_idx on apple_tokens (user_id);
```

Run it before the deploy. Unlike a new column it breaks nothing if it is
late, because every read and write of the table is caught; what it costs
is the tokens of everyone who signs in before it exists. `/api/health`
names it while it is missing. The revoke call has never run from this
container (`appleid.apple.com` is blocked); the first real one is a
deletion of a Sign in with Apple account on a deployment, which should log
`apple=revoked`.


### App Store subscriptions (IAP)

The App Store adapter (`artifacts/api-server/src/lib/billing/apple.ts`) verifies
StoreKit 2 transactions and App Store Server Notifications V2, and writes them
to the same provider-agnostic `subscriptions` table as Stripe, as
`provider = 'apple'`. It is off until configured, and fails closed.

| secret | value | required |
|---|---|---|
| `APPLE_BUNDLE_ID` | the app's bundle id (`com.example.reduction`) | yes |
| `APPLE_ROOT_CERTS` | base64 of Apple's root CA `.cer` files (DER), comma-separated — from https://www.apple.com/certificateauthority/ ("Apple Root CA - G3" signs App Store payloads; add G2 too). Or `APPLE_ROOT_CA_DIR`, a directory of `.cer` files. | yes |
| `APPLE_IAP_ENVIRONMENT` | the environment this server SELLS in: `Production` (default) or `Sandbox`. Verification accepts BOTH regardless — the payload declares its environment and the matching verifier runs — which is how App Review's sandbox purchases verify on the production deployment. `Sandbox` is for a workspace server, where no App Store id is needed | for testing |
| `APPLE_APP_APPLE_ID` | the numeric App Store id, from App Store Connect → App Information. Required to verify PRODUCTION payloads at all; a server without it verifies sandbox only (`verifies` in the preflight report says which) | Production |
| `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_PRIVATE_KEY` | an **In-App Purchase** key (App Store Connect → Users and Access → Integrations → In-App Purchase) — a different key from the Sign in with Apple one; the `.p8` pastes the same way as `APPLE_PRIVATE_KEY` | optional |
| `APPLE_IAP_OFFLINE` | `1` disables OCSP revocation checks against Apple | no |

Without the three API credentials the app's `POST /api/billing/apple/verify`
still works from the signed transaction alone; with them the server also asks
Apple for the current status on each verify, and the admin route below can
request a test notification. **A 401 from Apple with a key that parses** is
almost always a different `.p8` than the Key ID names — the Sign in with
Apple key is the usual one, since both are `.p8` files from the same account.
The download's filename says which it is (`SubscriptionKey_<KEYID>.p8` for an
In-App Purchase key, `AuthKey_<KEYID>.p8` for the others), and the preflight
reports `serverApi.publicKeyFingerprint`, which must equal
`openssl pkey -in SubscriptionKey_<KEYID>.p8 -pubout -outform DER | sha256sum`
on the file. The Issuer ID is the one on the In-App Purchase tab of
Integrations, and a key minutes old can be refused for a short while.

Register `PUBLIC_BASE_URL` + `/api/billing/apple/notifications` in App Store
Connect → App → App Information → App Store Server Notifications (V2), in BOTH
the production and the sandbox URL field — one server handles both, by the
environment each payload declares. The route 404s until the adapter is
configured and answers 400 to anything that does not verify, so Apple stops
retrying it.

The app stamps `appAccountToken` = the user's id (a UUID) on the purchase;
that is how a notification names an account with no lookup table. It sends
`{ signedTransactionInfo, signedRenewalInfo }` (StoreKit 2's
`jwsRepresentation`s) to the verify route after a purchase or restore.

**The products, exactly as the app asks the store for them**
(`artifacts/reduction-mobile/lib/purchasePolicy.ts`). Create both in App
Store Connect → the app → Subscriptions, in ONE subscription group (so a
change of plan is an upgrade or downgrade, not a second subscription):

| product id | plan | price |
|---|---|---|
| `com.recipereduction.mobile.plan.monthly` | auto-renewable, 1 month | $1.99 |
| `com.recipereduction.mobile.plan.yearly` | auto-renewable, 1 year | $19.99 |

The app only ever renders the price the store returns, so a product that
is not yet approved, or whose id differs by a character, is simply absent
from the wall rather than shown wrong. The app sells nothing at all until
`GET /api/billing/config` reports `nativePurchaseAvailable: true`, which is
the Apple adapter being configured with the secrets above — a purchase the
server could not record would be money taken and nothing unlocked.

To try it end to end: a development build (below; Expo Go cannot run
StoreKit) on a physical iPhone, a Sandbox tester (App Store Connect → Users
and Access → Sandbox), a workspace server on `APPLE_IAP_ENVIRONMENT=Sandbox`
(the deployment needs no change: it verifies sandbox purchases as it stands,
and App Review's are exactly those), then a purchase from the wall and a
"Restore purchases" from Settings on a second device.

### The legal pages

The Privacy Policy and Terms of Use are static HTML in
`artifacts/reduction/public/privacy.html` and `terms.html`, and every link
names the FILE: `/privacy.html`, `/terms.html`. No router on the web, and
Apple's reviewer needs them reachable without JavaScript. **The published
site does not serve them the way `app.ts` does**: it is Replit's static
hosting (`artifacts/reduction/.replit-artifact/artifact.toml`), whose
catch-all rewrite answers any path without a file with the web app — so
`/terms` opened the recipe library on the first TestFlight build (Sep 24),
though `app.ts`'s `extensions: ["html"]` serves it fine locally. The
artifact file now rewrites `/terms` and `/privacy` to their files ahead of
the catch-all, for the short URLs already given out; the links do not
depend on that. The mobile app links them
through `lib/legal.ts`: `webUrl` from `/api/billing/config` (this server's
`PUBLIC_BASE_URL`) with `https://recipereduction.com` as the fallback, so the
pages must exist on whichever host that names. The links appear beside every
price (the web paywall and Subscription card; the mobile `SubscribeBox`,
which is the wall and Settings), in both Settings screens, on the mobile
sign-in screen and under the landing page's call to action — Apple's 3.1.2
wants them in the binary as well as the metadata.

What to put in App Store Connect: **App Information → Privacy Policy URL** =
`https://recipereduction.com/privacy.html`; the version's **License Agreement**
field, or a line in the description, = `https://recipereduction.com/terms.html`.
The version's **Support URL** = `https://recipereduction.com/support.html`
(the contact address and a pointer to Settings › Send feedback; added Sep 30,
linked from both legal pages).
The **App Privacy** questionnaire has to say what the policy says: name,
email and an identifier from sign-in; the recipes and progress people save;
purchase records; a push token when timers are on; server logs. Photos are
sent for extraction and not kept. The contact address on both pages is
`admin@recipereduction.com`; the same address goes in App Store Connect's App Review contact.

The pages describe what the code does — Stripe on the website, Anthropic for
extraction, the cache of extracted pages, deletion cancelling what it can.
If any of that changes, the pages change in the same commit.

### Over-the-air updates (EAS Update)

The phone app's JavaScript and assets can ship without a new build. A build
carries `expo-updates` (added Sep 24), and on every cold launch it asks
`u.expo.dev` for a newer bundle on its **channel** — named after the
`eas.json` profile it was built with, so TestFlight and App Store builds
(one binary, the production profile) share `production`. A new bundle
downloads in the background and runs from the **next** cold launch
(`fallbackToCacheTimeout: 0`: nobody waits on the network at start), so a
published change reaches a phone on its second launch after publishing. A
bundle that crashes on launch is rolled back to the previous one by
`expo-updates` itself.

**Publish with the script, never with bare `eas update`:**

```sh
cd artifacts/reduction-mobile
node scripts/publish-update.mjs --message "What changed"            # production
node scripts/publish-update.mjs --message "What changed" --dry-run  # show, don't send
node scripts/publish-update.mjs --channel preview --message "What changed"  # the owner's phone only
node scripts/publish-update.mjs --promote <group id>                 # that same bundle, to production
```

**Since Oct 1 the order is preview, then promote**: the owner's phone
switches to the preview channel from the testing sheet (*Updates from*),
runs the update there, and `--promote` copies the exact bundle to
production. The steps, the 5-minute check and the rollbacks for each
channel are in `docs/next-publish.md`.

`eas update` bakes in the SHELL's `EXPO_PUBLIC_DOMAIN`, not the build
profile's; in the Replit workspace that is the dev server or nothing, and
either would ship every installed app a bundle that cannot reach the real
server. The script reads the domain from the channel's profile in
`eas.json` and refuses without one.

**It publishes the checkout it runs in, so it checks that checkout first**
(Oct 1). It runs `git fetch` and refuses when the checkout is behind
`origin/main` or has uncommitted changes to tracked files (`--force`
publishes anyway, and the message then says `+changes`). Before uploading
it prints the commit, the channel, the runtime version and the server, and
it appends the short commit hash to the message — so `eas update:list`
shows which commit each update is.

**What a phone is running** is on the phone. Settings ends with "Version
1.1.0 (build N)", the binary. The owner's testing sheet (long-press
"Replay intro") starts with *This launch*: `Update 0e8a3c1e` or `Embedded
bundle`, the channel, the runtime version, when that bundle was published
(UTC, as `update:list` prints it), the last check, any check or download
error, an emergency launch and its reason, and "Waiting" when a newer
update is downloaded and needs one more cold start. All of it is what
`expo-updates` reports (`useUpdates()`); nothing asks the network.

**What cannot ship this way:** anything native — a package with native
code, a config plugin, an `app.json` field that lands in Info.plist, a new
permission. That needs `eas build`, and **`expo.version` bumped in the same
commit**: `runtimeVersion.policy` is `appVersion`, so an update reaches only
builds whose version matches, and the bump is what keeps a bundle written
for new native code off binaries that lack it. `appVersion` rather than
`fingerprint` because the fingerprint is computed twice — on EAS's macOS
builders and on whichever shell runs `eas update` — and a monorepo's
`node_modules` differing between the two makes them disagree silently.

To inspect what a build will carry, `npx expo prebuild -p ios --no-install`
writes `ios/Reduction/Supporting/Expo.plist` (runtime version, update URL)
— and ALSO copies `expo`, `react` and `react-native` into the mobile
`package.json`'s `dependencies`, which breaks the frozen install
(`ERR_PNPM_OUTDATED_LOCKFILE`). `ios/` is gitignored; delete it and revert
`package.json` before committing.

**App Review.** Apple permits downloaded interpreted code (Developer
Program License Agreement 3.3.2, Review Guideline 2.5.2) as long as it does
not change the app's primary purpose or add features inconsistent with what
was reviewed. Fixes, copy, layout and tweaks to existing features are what
it is for. A new feature of substance goes through a build and review.
Never use it to change how purchases are made (3.1.1). A reviewer running
the production binary receives production updates too.

### Search

`POST /api/recipes/search` answers with **at most five** results: up to
three pages the app has already read (`extraction_cache`, matched on the
recipe's title with English stemming, every word required), then the live
web search's results in their own order, minus any page already offered,
until there are five. Fewer than three cached matches means more from the
web. The web half is one model call with web search, now asked for five
results with at most two searches (it was six to eight, with three).

**Only public-looking pages from a URL ever surface** (`surfaceableUrl` in
`lib/searchLibrary.ts`): a pasted or photographed recipe is cached without a
`sourceUrl` and never matches, and a query string, a document or drive host,
an IP address or an unusual port keeps a page out, because somebody's shared
document must not reach a stranger searching the dish's name.

**Each result may carry one line on how people found it** (`proof`):
"Saved by 12 people · cooked 40 times", or a loved percentage. Counts are
across signed-in accounts, from boxes only (a removed recipe is not saved),
and a page saved under a variant URL counts for the same page. Each part is
said only above a floor — 3 accounts, 5 cooks, 5 ratings (`PROOF_FLOOR`) —
because "Saved by 1 person" looks broken and is close enough to a person to
be worth not publishing. Below every floor the result says nothing extra.
The old "Instant" badge is gone; `cached` still travels, and only decides
whether the clients show the staged "reading the page" wait.

**The phone's My Recipes tab asks for the cached half alone.** `POST
/api/recipes/suggestions { query }` (`suggestionsFor` in
`lib/searchLibrary.ts`) is `libraryMatches` at a limit of two
(`SUGGESTION_LIMIT`) plus the same counts and floors, so nothing can surface
there that search would not. It runs only when the query matched nothing in
the person's own box. No model call and no web search, so it is signed-in
only but NOT walled, and has its own per-account throttle (240 an hour)
rather than the extraction budget's; opening a suggestion is an ordinary
link extraction — a cache hit — and is walled where it always was. The
phone no longer shows `/search` at all (Browse's address bar searches the
web instead); the route stays, and the website's search still uses it.

**Why this does not slow search down.** The cached half starts before the
web call and is awaited alongside it; the counts are one read over at most
five URLs after both land. Measured on 20,000 cached pages and 20,000 saved
recipes, no indexes: the cached half 49ms (hidden inside the web call), the
counts 103ms (added). With the two indexes below: 5.6ms and 15ms. The web
call is seconds, so neither matters today; the indexes are for when the
tables are large. Optional, hand-run, and nothing in `REQUIRED_SCHEMA`,
because the queries are correct without them:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS extraction_cache_title_fts_idx
  ON extraction_cache USING gin (to_tsvector('english', coalesce(recipe->>'title', '')));
CREATE INDEX IF NOT EXISTS recipes_source_url_trgm_idx
  ON recipes USING gin ((recipe->>'sourceUrl') gin_trgm_ops);
```

### Recipe books

An account's books are one versioned document in `recipe_books` (one row
per account: the list, with tombstones for deleted books that say where
their recipes went), and each recipe's book is a row in
`recipe_placements`, by book id. The rules — defaults, colours, names,
resolution, the merge — are recipe-model `books.ts`; storage is
`artifacts/api-server/src/lib/books.ts`; the routes are `GET /api/books`
(creates the seven defaults on first read, idempotently, and places the
account's existing recipes by meal type) and `PUT /api/books { books,
ifVersion }` (409 with the current list when stale, 422 when invalid). A
recipe's book rides the library's own save (`book` on `POST
/api/library`) and versioned `PATCH` (`book`, or `null` to let its meal
type decide again), and the list carries it as `book` on every entry.

Both tables are hand-run DDL, and both are optional to the app: without
them the list serves `book: null`, saves and edits go through with the
book dropped, `/api/books` answers 503 `books_unavailable`, and the phone
shows today's seven. Verified Sep 29 by renaming both tables under a
running server. **Production DDL**, before the deploy that uses them:

```sql
create table if not exists recipe_books (
  user_id    text primary key,
  books      jsonb   not null,
  version    integer not null default 1,
  updated_at timestamptz default now()
);
create table if not exists recipe_placements (
  owner_key  text not null,
  id         text not null,
  book_id    text not null,
  updated_at timestamptz default now(),
  primary key (owner_key, id)
);
```

No foreign keys, for the reason in the recipe_photos schema comment: the
library DELETE route and account deletion remove placements and books in
code (`books.db.test.ts`, `account.db.test.ts`).

### Recipe photos

A recipe's picture lives in `recipe_photos`, keyed on the recipe's
`(owner_key, id)`, never in the recipe JSON and never on the `recipes` row
(the library list would otherwise carry megabytes on every load). The list
carries `photo: { version, source } | null` per entry and the bytes are at
`GET /api/library/:id/photo?v=<version>`, private and `immutable` because the
version changes with the picture. Two sources: `page` — the source page's
schema.org `image` (or `og:image`), recorded by the extractor as
`recipe.image` and fetched by the SERVER at save time, stored as our copy so
nothing ever links to the site; and `user` — `PUT /api/library/:id/photo`
with `{ data, mediaType }`, which a page fetch never overwrites.
`DELETE /api/library/:id/photo` removes one; `POST
/api/library/:id/photo/from-source` fetches the page's picture on demand (the
card calls it once when a recipe has an image URL but no photo). Everything
stored is JPEG, long edge 1024, via `jimp` (pure JavaScript, no native
build). A recipe saved before pictures existed has a `sourceUrl` and no
`image`; the card asks `from-source` for it too, and the server reads the
page's schema.org `image` or `og:image` with `fetchSource` — one page
fetch, no model call, no free recipe — and stores that picture. The URL
it found is not written into the recipe (that would bump its version and
409 every other device). A paste or a photo has neither URL and keeps the
meal-type art. There is no bulk backfill: a picture fills in when its card
is first shown.

**Production DDL for the table** (schema changes are hand-run, never
pushed — CLAUDE.md), before deploying anything that imports it:

```sql
create table recipe_photos (
  owner_key  text    not null,
  id         text    not null,
  bytes      bytea   not null,
  media_type text    not null,
  width      integer not null,
  height     integer not null,
  source     text    not null,
  version    integer not null default 1,
  updated_at timestamptz default now(),
  primary key (owner_key, id)
);
```

No foreign key to `recipes`, deliberately — see the schema comment. The
library DELETE route and account deletion remove photos in code.

### Extraction speed

Extraction is one Sonnet 5 call (two when the tree fails validation), and
the phone waits **180 seconds** for it (`EXTRACTION_TIMEOUT_MS`), saying
"Still working — taking longer than usual" after 45. Two server settings,
in `lib/extractionConfig.ts`, reported by `/api/health` as `extraction`:

- **Output cap: 16,000 tokens**, always. The model reasons before it
  answers and that reasoning counts against the cap; at 8,000 a long recipe
  could be cut off inside the tree and cost a second full attempt.
- **Source step numbers: ON** (Sep 25; `EXTRACTION_STEP_SOURCES=off` turns
  them off, and the prompt is then exactly what it was). The model tags
  each diagram step with the number of the recipe's own step it came from;
  Step-by-Step then follows the recipe's order and shows its sentence
  (CLAUDE.md, "Cooking order is not section order"). A wrong tag makes the
  order worse than none, so the comparison below prints every tag against
  the sentence it names. Recipes extracted before have no tags and keep
  the old order (a re-read brings tags).
- **Effort: `low`** (Sep 25). It changes what the diagram can say, so it
  is measured on real extractions now that it is live. The
  `EXTRACTION_EFFORT` secret overrides it with no commit: `default` for the
  model's own (the most reasoning), or `medium` / `high`.
- **The fallback's effort** (Sep 26): when a site refuses our own fetch,
  Anthropic's web fetch reads the page and the same call builds the tree.
  `EXTRACTION_FALLBACK_EFFORT` sets that path alone (unset: it follows
  `EXTRACTION_EFFORT`; `default` for the model's own). A fallback reply
  with no recipe in it — a block page, "I was unable to access…" — ends the
  reading at once with "This site blocked us from reading the recipe. Try
  pasting the recipe text instead." rather than spending a repair call, and
  a fetch Anthropic's side PAUSES is resumed with the page it already had
  (before Sep 26 the page was dropped and the model asked to fix its JSON).

Measured Sep 26 on 19 real cases, the old settings against today's (same
recipes, `evalExtraction.ts`, configs A and S): 12 → 17 extracted, average
97s → 32s, slowest 329s → 76s, 6 → 0 over two minutes, 7 → 0 cut off by the
cap, $2.91 → $1.32. Retries did NOT drop (11 → 10 runs with a second call):
the cut-offs were gone, and what remained was every one a first tree that
broke a validation rule — which the report now tallies by rule.

Measured Sep 27 (24 cases, configs S and F — the fallback at the model's
default effort): **F did not help and is not on.** All seven allrecipes.com
links failed in 2–7 seconds under both, because Anthropic's fetch is
refused for that domain outright ("permission denied for this domain"), so
no amount of reasoning reaches the page; each now ends in one call with the
blocked message. On the pages the fallback CAN read, F averaged 47.5s
against 25.4s, ran three past two minutes (the turkey took 305s and hit the
cap), and cost 39% more. `EXTRACTION_FALLBACK_EFFORT` stays unset (the
fallback follows `EXTRACTION_EFFORT`). The tally named the retries: 7 of
the 8 non-allrecipes second calls were one rule, "has no qty and no text
fallback" — the prompt said "if the source omits an amount, qty null and
text null", which the validator has always refused. The prompt now says
what the validator wants ("to taste" for seasonings, "as needed"
otherwise, never an invented number); re-measure with `--configs S`.

Where the time goes, from the production log (read-only):

```sql
-- by path: via = claude is the page Anthropic had to fetch; attempts = 2 is a retry
select via, attempts, ok, count(*) n,
       round(avg(ms)/1000.0, 1) avg_s,
       round((percentile_cont(0.9) within group (order by ms))::numeric/1000, 1) p90_s,
       round(max(ms)/1000.0, 1) max_s
  from extraction_events
 where not cached and at > now() - interval '14 days'
 group by 1,2,3 order by 1,2,3;

-- the slowest recent links (the log keeps only the host; the URL comes from
-- the cache row written at the same moment, so a failed one shows no URL)
select e.at, round(e.ms/1000.0,1) secs, e.via, e.attempts, e.ok, e.host,
       c.recipe->>'sourceUrl' as url
  from extraction_events e
  left join lateral (
    select recipe from extraction_cache c
     where c.recipe->>'sourceUrl' ilike '%' || e.host || '%'
       and c.created_at between e.at - interval '5 minutes' and e.at + interval '1 minute'
     order by abs(extract(epoch from c.created_at - e.at)) limit 1) c on true
 where not e.cached and e.source = 'url' and e.at > now() - interval '14 days'
 order by e.ms desc nulls last limit 15;
```

**The comparison that decides the two secrets** is
`artifacts/api-server/src/eval/evalExtraction.ts`. It runs every case in a
cases file through production's own extraction code under four configs —
**A** the old 8,000 cap, **B** the 16,000 cap alone, **C** B at low
effort, **S** C with source step tags (production now) — and writes a report: time,
model calls per run (a retry or a fallback shows as more than one), cap
hits and cost per config; every case side by side; and every tag checked
against the sentence it names (out of range, no words in common, or
numbered before a step it depends on). It never touches a database — it
deletes `DATABASE_URL` before loading anything — and spends real money,
so it prints an estimate and does nothing without `--yes`. Run it in the
workspace, which has the API key and the open internet:

```sh
node --import tsx artifacts/api-server/src/eval/evalExtraction.ts \
  artifacts/api-server/src/eval/cases.txt --yes
# --configs A,B (a subset) · --concurrency 2 · --out eval-out (gitignored)
```

`cases.txt` holds links (add the slow ones from the query above), and
three pasted recipes written to be awkward: a blog post around its recipe,
a notes-app ingredient list with a run-on method, and a two-part recipe
whose steps interleave.

### Original wording

Beside the diagram, a recipe's ingredient lines and steps as its source
worded them — `OriginalRecipe` in `lib/recipe-model/src/original.ts`:
`{ ingredients, steps, truncated, from }`, each list an array of lines with
sub-headings marked (`{ text, heading: true }`), never one block of text.

Where it comes from, per extraction path:

| path | wording from | model cost |
|---|---|---|
| page with schema.org JSON-LD | `recipeIngredient` / `recipeInstructions` (`fetchSource`), HowToSection names as headings | none |
| page without structured data | the same model pass, `askOriginal` (`prompt.ts` `ORIGINAL_RULES`) | output tokens ≈ the recipe's length |
| page only Claude could fetch | same, in `fetchViaClaude` | same |
| pasted text, photo / PDF | same | same |

The model is told to copy ONLY the recipe's lines, verbatim, and to leave
the story, tips, FAQs, nutrition and comments behind — the same judgement
the tree already rests on, made explicit because a verbatim copy is where a
stray paragraph of a post would actually be shown. `original` is asked for
LAST in the JSON, so a reply the 8000-token limit stops is cut in the
wording, not the tree: `closeTruncatedJson` keeps every complete line and
the list is marked `truncated`. Long recipes are truncated with a note and a
link to the source, never retried at a higher limit. `sanitizeOriginal`
gates everything stored (120 ingredient lines, 80 steps, 1,500 characters a
line, 24,000 in all).

Stored in two tables (schema comment on `extraction_originals`): beside the
cached tree under its hash, and per recipe under `(owner_key, id)`, copied
at save from the `sourceKey` the extract response returned. `GET
/api/library/:id/original` answers `{ original, sourceUrl, source }`; a
recipe with no copy yet (saved before this existed, or by a client that
sent no key) is filled once on first open from the cache's wording for its
URL, else from the page's JSON-LD — no model call — and "none" is
remembered. Private to the account, never in the recipe JSON, never in
search. Deleted with its recipe and with the account, in code.

**Production DDL** (hand-run, before deploying the code; both tables are
decoration, so the code tolerates their absence — extraction, saving and
the library carry on, and the screen says the wording was not kept):

```sql
create table extraction_originals (
  hash       text primary key,
  original   jsonb not null,
  created_at timestamptz default now()
);
create table recipe_originals (
  owner_key  text not null,
  id         text not null,
  original   jsonb,
  created_at timestamptz default now(),
  primary key (owner_key, id)
);
```

### The recipe box

A recipe can be taken out of the recipe box without being deleted:
`recipes.removed_at` is set, the library list leaves the row out, and
`GET /api/library/removed` lists it for Settings → Removed recipes.
Restoring is a PATCH of `removedAt: null`; deleting forever is the
ordinary DELETE. Hand-run DDL, like every production schema change:

```sql
alter table recipes add column removed_at timestamptz;
```

**Run it BEFORE the deploy that carries it — and before pulling that commit
into the Replit workspace, whose dev server uses the production database.**
Nullable with no default, so it is instant and the code already running is
unaffected. The other order is not: drizzle's `select()` names every schema
column, so code that knows `removed_at` fails every recipes query against a
database without it, and the app shows an empty shelf. Measured by renaming
the column under a booted server: `/api/library` answered 500.

`GET /api/health` reports this: its `schema` field lists any hand-run
column or table the running code needs and the database lacks, with the
README section holding its DDL, and the same line is logged at boot
(`lib/schemaCheck.ts`, which is where new hand-run DDL is registered):

```json
{"ok":true,"commit":"…","schema":{"ok":false,"missing":["recipes.removed_at (README \"The recipe box\")"]}}
```

### Recipe notes

The person's own notes on a recipe ("less salt, double the garlic"; user
feedback, Oct 2) and on single steps ("cast iron, 8 min a side") are
`recipes.notes`, `{ text?, steps?: { [stepId]: text } }` or null — entry-level like
`rating`, never in the tree (`lib/recipe-model/src/notes.ts` says why). They
ride the ordinary versioned library PATCH; two devices that both changed a
note keep both (`mergeNotes`), and an app that predates notes never sends
the field, so it cannot erase one. The box takes 2,000 characters and the
server stores up to 4,000, so a merge of two full notes is never refused.
The phone shows them in the diagram's top row where that costs the diagram
nothing (`lib/notesStrip.ts`), under the diagram, above Step-by-Step's first
card and as a margin line on the Recipe Box page; the website shows them
under the recipe. A step's note is on that step's Step-by-Step card on both
clients (written there, 280 characters) and listed under the recipe's note;
each text merges on its own, so a step note added on one device and the
recipe note edited on another both stand. An edit that deletes a step moves
its note into the recipe's note under the step's old label — the server
does it in the PATCH transaction (`pruneNotes`), so nothing typed is lost.
The signed-out try has none. Hand-run DDL (step notes need none of their
own; they are a key in the same column):

```sql
alter table recipes add column if not exists notes jsonb;
```

**Run it BEFORE the deploy that carries it, and before pulling that commit
into the Replit workspace**, for the reason `removed_at` gives above: code
that knows the column fails every recipes query against a database without
it. Nullable with no default, so it is instant and harmless to the code
already running. `/api/health` names it while it is missing.

### Extraction costs

Every extraction attempt and cache hit is a row in `extraction_events`
(`lib/extractionLog.ts`). Since Sep 30 a fresh one also records the
signed-in account (null for a signed-out trial), the prompt and output
tokens the model calls reported, and an **ESTIMATED** cost at list price
(`lib/extractionCost.ts`, the one place the prices live, shared with the
eval). A cache hit records 0. The route is the existing `source` column:
`url` (a link), `text` (a paste), `file` (a photo or PDF), `page` (a page
the phone's browser handed over), `reextract`. Hand-run DDL, safe to run
twice:

```sql
alter table extraction_events add column if not exists user_id text;
alter table extraction_events add column if not exists input_tokens integer;
alter table extraction_events add column if not exists output_tokens integer;
alter table extraction_events add column if not exists est_cost_usd numeric(10, 6);
create index if not exists extraction_events_user_at_idx on extraction_events (user_id, at);
```

All nullable, no defaults: instant, and harmless to the code already
running. Run it before the deploy anyway. Unlike most columns, the code
copes with the other order: the writer falls back to the old column set
when these are missing (one `[extractionLog] cost columns missing` line per
process), so no extraction is ever lost to it. `GET /api/admin/costs`
answers 503 `schema_behind` until the SQL runs, and `/api/health` lists all
four under `schema.missing`.

Deleting an account sets its rows' `user_id` to null. The totals stay; the
link to the person goes.

`GET /api/admin/costs` (header `x-admin-secret`) returns, for the last 7
and 30 days: fresh extractions (and how many failed), cache hits, the
estimated total, what one fresh extraction costs (mean, median, p90),
totals by route, signed-out trials as one total, and the top 20 accounts
by fresh extractions and by estimated spend. Accounts are ids only, never
an email. It caps nothing.

```sh
curl -s -H "x-admin-secret: $ADMIN_SECRET" https://<deployment>/api/admin/costs
```

### Per-client limits: `TRUSTED_EDGE_IPS`

The extraction and search limit (20 fresh an hour, per instance) and the
admin failure throttle key on the CLIENT, which behind the deployment is
not `req.ip` (that is a loopback proxy, the same for everyone).
`lib/clientAddress.ts` takes the entry immediately left of the rightmost
address in `TRUSTED_EDGE_IPS` in X-Forwarded-For — Replit's load balancer
appends the client and then itself, so nothing a client writes can land to
the right of it. Set it in the **deployment's** secrets only:

```
TRUSTED_EDGE_IPS=34.111.179.208,34.117.33.233
```

(recipereduction.com and recipe-reduction.replit.app respectively, measured
Sep 30.) Addresses only, comma-separated, at most 10; anything else is
refused whole with one boot warning. Unset or refused, every client shares
one bucket, which is how it was before. If Replit adds or moves a load
balancer, the log says `[client-key] a request arrived through <address>,
which TRUSTED_EDGE_IPS does not list` — add that address. The workspace
dev server needs none: nothing there sits behind the load balancer.

### Daily cost brakes

The hourly limit above is per instance and per client; nothing in it bounds
a DAY. `lib/costBrake.ts` does, from `extraction_events` (so every instance
sees every other's spend), in front of every paid model call — a cache miss
on `/extract`, `/reextract`, and the web half of `/search`:

```
EXTRACTION_DAILY_BUDGET_USD=25     # everyone's estimated spend today (UTC); 503, search too
SIGNED_OUT_DAILY_EXTRACTIONS=150   # fresh extractions with no account, all together; 429
ACCOUNT_DAILY_EXTRACTIONS=40       # fresh extractions by one account; 429
```

Those are the defaults when unset; `off` removes one, and anything that is
not a positive number means the default, never "unlimited". The spend is
the list-price ESTIMATE in `est_cost_usd`, and search's own cost is not in
it (search writes no event row). The log says `[cost] estimated spend today
… has passed 50% / 80% / 100%` once per instance per day. That log line is
the only alarm this server has: set a spend limit and an email notification
on the Anthropic Console workspace too, which no bug here can switch off. A
database error fails the brake OPEN with one log line.

### Usage counters

Anonymous daily counts (`lib/counters.ts`): one row per UTC day and name,
and nothing that identifies anyone — privacy.html promises "totals ... not
linked to your account or device". The server counts `save` (a new recipe
in a library), `wall_hit.subscription_required` and `wall_hit.trial_spent`
(where the 402 is written) and `coupon_redeemed`. The app may report only
the reel's events (`reel_shown`, `reel_tap_data`/`_curated`,
`reel_saved_data`/`_curated`) through `POST /api/counters`, signed in, 120
an hour per account. Extractions are not counted here: `extraction_events`
already has every one by route, and `GET /api/admin/counters?days=30`
(x-admin-secret) shows both side by side. Hand-run DDL, safe to run twice:

```sql
create table if not exists daily_counters (
  day date not null,
  name text not null,
  count integer not null default 0,
  primary key (day, name)
);
```

Without it nothing is counted (one `[counters]` warning per process) and
nothing else changes; `/api/health` lists `daily_counters` and the admin
read answers 503 `schema_behind`.

**Which view people cook in** (Oct 3): the app and the website also report
`recipe_opened`, `view_steps`, `ticked_diagram`/`ticked_steps` (each once
per visit to a saved recipe) and `finished_diagram`/`finished_steps` (once
per cook, in the view the last tick happened). Phone: `lib/cookCounters.ts`;
web: `RecipeView`'s `countUsage`. A preview, the demo and the trial recipe
report nothing.

**`GET /api/admin/usage?days=30&exclude=<user id>,…&format=text`**
(x-admin-secret, `lib/usage.ts`) puts those counts beside what the library
already holds: of the accounts that signed up in the window, how many
cooked one recipe, two different recipes, on two days, and 7+ days after
joining; of the recipes saved in the window, how many were started and
cooked through, link vs pasted/photographed, and which view each was last
left in. Totals only — `exclude` leaves your own accounts out by id and no
id comes back. A cook is recorded only when every step is ticked, so every
number is a floor, and a share prints only out of 10 or more.

```sh
curl -s -H "x-admin-secret: $ADMIN_SECRET" "https://recipereduction.com/api/admin/usage?days=30&format=text"
```

### Crash reports

The phone and the website report their own errors to `POST /api/crash`
(`routes/crash.ts`, `lib/crashReports.ts`); the shape and the scrubbing are
recipe-model `crashReport.ts`, run on the device AND on the server. A report
is: kind (`render` — the "Something went wrong" screen; `fatal` / `error` —
an uncaught JS error; `emergency_launch` — expo-updates fell back to the
embedded bundle because a downloaded update crashed on launch), platform,
the error's class, its message with anything quoted, URLs, emails, ids and
long numbers taken out, up to 15 stack frames cut to file basenames, the
route PATTERN, and app version, runtime, update id, channel and OS version.
No account (the route never reads the session, and the phone sends no
token), no device id, no address. privacy.html "Technical records" says so.

Signed in or not. One client is braked at 10 an hour (`clientKey`, in
memory), and the insert itself refuses past 5,000 rows a UTC day, so the
table is bounded however many instances a script reaches. Rows older than
90 days are pruned on the way in. A fatal error on the phone is stored on
the device and sent at the next launch; each distinct crash is sent once
per process and at most ten in all. Off in development (`__DEV__`, and the
web's `import.meta.env.DEV`): the workspace's dev server writes to
production.

What it cannot see: a crash on the UI thread (a worklet) or in native code
closes the app without passing through JS. Those are Apple's: Xcode →
Window → Organizer → Crashes, and App Store Connect → TestFlight → Crashes
(from App Store users only when they share analytics with developers).

`GET /api/admin/crashes?days=7` (x-admin-secret) groups by fingerprint
(kind, class and top five frames), the most frequent first, with the app
versions and update ids each was seen on and the newest report whole:

```sh
curl -s -H "x-admin-secret: $ADMIN_SECRET" "$PUBLIC_BASE_URL/api/admin/crashes?days=7"
```

Hand-run DDL, safe to run twice:

```sql
create table if not exists crash_reports (
  id bigserial primary key,
  at timestamptz not null default now(),
  fingerprint text not null,
  kind text not null,
  platform text not null,
  name text not null,
  message text not null,
  stack text not null,
  route text,
  app_version text,
  runtime text,
  update_id text,
  channel text,
  os_version text
);
create index if not exists crash_reports_at_idx on crash_reports (at);
create index if not exists crash_reports_fingerprint_idx on crash_reports (fingerprint);
```

Without it nothing is stored (one `[crash]` warning per process), the route
still answers 204, `/api/health` lists `crash_reports`, and the admin read
answers 503 `schema_behind`.

### Starter recipes reel

A horizontal reel of recipes on Find › Add New and the empty library, for
someone with nothing saved yet (`lib/reel.ts` rules, `lib/reelStore.ts`
data, `routes/reel.ts`). **Data first:** pages other people saved and
cooked, ranked by DISTINCT accounts that cooked them, then by the share of
👍 among their ratings. **Curated second:** the owner's list fills what the
data leaves. The privacy rules are search suggestions' rules: URL
extractions only, public-looking addresses only, never a paste, photo or
browser-read page, counts per account and only above their floors, and
nothing about any person in the answer. Every card is already in the
extraction cache, so a tap is the ordinary link extraction answered from
the cache: instant and free. Minimums are PROVISIONAL (ROADMAP).

`GET /api/reel` — signed in, not walled, but EMPTY for an account the wall
has stopped (a tap would only meet the wall); 30 an hour per account;
built once an hour per instance. Heading "Loved by Reduction users" only
when every card is data-backed and clears the ratings floor, otherwise
"Try one of these"; no heading and no reel when nothing qualifies.

**A card needs its page's own picture, stored** (Oct 1, the owner's rule):
a page — data-backed or curated — with no row in `reel_photos` is left
out, BEFORE the reel is assembled, so the next candidate takes its place.
A build still starts fetching the missing pictures it can (three a build,
fire-and-forget), so a page whose tree names an image joins the reel a
build later. **Fewer than three cards and there is no reel at all**
(`REEL.minCards`): the phone already shows nothing for an empty list, so
the minimum lives here and needs no update to change. The preview counts
both (`no stored picture: N`, and the cards waiting for the minimum) and
names the pictureless pages; the public answer says neither.

The owner's list is `reel_entries` — hand-run DDL, safe to run twice:

```sql
create table if not exists reel_entries (
  url_key text primary key,
  url text not null,
  status text not null check (status in ('curated', 'hidden')),
  pinned jsonb,
  note text,
  updated_at timestamptz not null default now()
);
```

Without it the reel is data-backed only and nothing can be hidden or
curated; `/api/health` lists it and the admin writes answer 503. A curated
page keeps a PINNED copy of its tree: if its cache row is lost (a failed
re-read is the one thing that deletes a row and leaves nothing), the next
reel build puts the copy back into the cache, with no model call.

The owner works it from the Replit shell with `scripts/reel.mjs`, which
calls the admin routes on the deployment (PUBLIC_BASE_URL, ADMIN_SECRET):

- `node scripts/reel.mjs preview` — the dry run: what a stranger would see,
  data-backed or curated, counts of what was left out and why, the pages
  left out for want of a stored picture by name, and any cards waiting for
  the minimum.
- `node scripts/reel.mjs warm [list]` — report only: cached ($0), would
  extract, or not public; for a cached page, what it predates (step order,
  picture, original wording). The list defaults to
  `~/workspace/reel-urls.txt`, one URL per line — in `~/workspace` because
  Replit clears the home folder between sessions and keeps only that
  folder. `reel-*.txt` at the repo root is gitignored: working data.
- `... --write` — extracts what is not cached (once, logged as `warmup` in
  the cost report) and curates every clean page with a pinned copy and its
  card picture.
- `... --write --refresh <url>` — also re-reads that named cached page,
  EXCEPT one read through the fallback, which is refused (printed, nothing
  changed, $0) unless `--force` is added: the fallback never records a
  page's image, so a re-read cannot get it into the reel.
- `... --candidates [file]` — also reports a second list (default
  `~/workspace/reel-candidates.txt`), never read or curated: cached, or
  would_extract with an estimated cost from recent reads, and a warning
  when the site's last read went through the fallback.

Every report line says how the page was last read (`lib/readHistory.ts`):
a cached tree with an `image` key was read by our own fetch (the fallback
never writes one); without it, the site's last fresh read in
`extraction_events` decides — the log keeps hosts, not URLs, and it is the
site that refuses us. "Spent this run" counts only real reads; estimates
are totalled on their own line.
- `node scripts/reel.mjs hide <url>` / `unhide <url>`. A hidden page is
  never warmed: `warm` refuses it before reading, curating or storing
  anything, until it is unhidden.
- `node scripts/reel.mjs hide <url> --purge` — hide AND delete our stored
  copy of the page's picture (`reel_photos`); the photo route then answers
  404. This is the answer to a site's removal request (terms.html), and it
  is audited on its own `admin_events` row (after = `purged`). Plain `hide`
  keeps the picture.

Every write is in `admin_events` (action `reel`, target `(reel)`, the URL
in the note).

**A card is the Recipe Box page's face** (Sep 30): the page's picture, the
title, the stated time, "Serves N · N steps", the first ingredients (the
recipe model's `keyIngredients`/`stepCount`, so the reel and the box can
never disagree), the site, and — on data-backed cards, each above its
floor — "Cooked by N people" and "N likes" (accounts whose latest rating
is 👍, once five have rated). `usage` still carries the joined line for the
app versions that read only that.

**The picture is the page's own image, stored by this server, one per page**
in `reel_photos` (`lib/reelPhotos.ts`) — fetched from the URL the page's
extraction recorded and kept PREVIEW-SIZED, long edge 480
(`REEL_PHOTO_LONG_EDGE`, Oct 1): a card is a link preview of somebody
else's page, credited and linked to it (the site line opens the page), and
keeps no more of their picture than a card needs. Copies stored at 1024
before that are shrunk in place by the next builds, from our own bytes. NEVER an account's
`recipe_photos` row: a `user` photo is someone's own picture and nothing
builds a card from that table. The warm-up stores a curated page's picture
as it curates it (`picture: stored` in its report, no model call); a
data-backed card's is fetched in the background by the reel builds that
follow, at most three per build, and a picture that cannot be fetched is
tried once per instance. `GET /api/reel/photo/<url key>?v=<version>` serves
it, signed in, `immutable`. Hand-run DDL, safe to run twice:

```sql
create table if not exists reel_photos (
  url_key text primary key,
  image_url text not null,
  bytes bytea not null,
  media_type text not null,
  width integer not null,
  height integer not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
```

Without it every card shows its meal-type art, `/api/health` lists it, and
a warm-up reports `picture: no reel_photos table yet`.

### A development build for a physical iPhone

`artifacts/reduction-mobile/eas.json` has three profiles. `development` is
a dev-client build (`expo-dev-client`): the native shell with StoreKit,
notifications and the store's own splash, loading its JavaScript from a
dev server exactly as Expo Go does — so a code change never needs a
rebuild, only a native change does (a new native module, a plugin, a
permission string, the icon). `preview` and `production` embed the bundle
and point it at the deployment through `EXPO_PUBLIC_DOMAIN`; a dev build
takes that from whichever dev server it connects to.

From `artifacts/reduction-mobile`, once (each needs the Apple Developer
Program membership and `npx eas-cli login --no-browser` — the default
opens a browser, which the Replit shell cannot use):

1. `pnpm exec eas device:create` — registers the phone's UDID with Apple
   for internal distribution. It prints a link; open it ON THE PHONE in
   Safari and install the profile it offers.
2. `pnpm exec eas build --profile development --platform ios` — answer
   yes to letting EAS manage credentials; it creates the distribution
   certificate and an ad-hoc provisioning profile containing the
   registered device, then builds in the cloud (fifteen to twenty
   minutes the first time). The build page shows a QR code; open it on
   the phone to install.
3. Start the dev server on Replit (the mobile workflow), open the
   installed app, and pick the server from the list or paste its URL.

The EAS project is `seans-apps/reduction-mobile` (`extra.eas.projectId`
in app.json), which is also what push tokens key on.

Preflight (needs `ADMIN_SECRET`): `GET /api/admin/preflight/apple-iap` reports
which roots parsed, the environment, the API key's posture and the exact URL
to register; `POST /api/admin/preflight/apple-iap/test-notification` asks
Apple to send a TEST notification, and "TEST acknowledged" in the logs is the
end-to-end proof. **Nothing in the test suite has seen a real Apple-signed
payload** — the signature check is the library's, and the test notification
is how it gets exercised for the first time.

### Admin lookup

`ADMIN_SECRET` enables `GET /api/admin/user?email=…`, which returns matching accounts' ids plus their allowance and subscriptions. Unset, the route 404s.

```
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "https://<host>/api/admin/user?email=someone@example.com"
```

Matching is case-insensitive and covers both `users.email` and `identities.email`, and every match is returned — two accounts can legitimately share an address. This is a read for one operator, not an auth path and not a role system; see the note at the top of `artifacts/api-server/src/routes/admin.ts`.

Signed-in users can find their own id under Settings → Account ID, with a copy button.

`GET /api/admin/preflight/anthropic` tests the extraction pipeline's one
external dependency with the deployment's own key, against the exact model
extraction uses, and reports the API's verbatim answer — an expired key,
exhausted credits and a retired model each named outright instead of the
generic "Something went wrong reading that recipe" users see. Costs one output
token, on demand only.

`POST /api/admin/coupon` mints an "N recipes free" code without hand-written
SQL — `{"code":"NEIGHBOR10","recipes":10,"maxRedemptions":1}`, optional
`expiresAt`. Codes are normalised (case- and space-insensitive) the same way
redemption normalises them; a duplicate is a loud 409 with the original left
untouched. `GET /api/admin/coupons` lists every code with its redemption
count. The redeeming side already exists: signed-in users enter codes under
Settings → Subscription.

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

The Stripe webhook is mounted with `express.raw` **before** `express.json()` in `artifacts/api-server/src/index.ts`. Stripe signs the raw bytes; parse them first and every event fails signature verification permanently.

**Notifications only fire while the app is awake.** An in-process interval dispatches due timers every 30s, but Autoscale scales to zero — so a timer that comes due after the deployment sleeps waits until someone opens the app. That is a deliberate bandaid, stated to the user in Settings; see ROADMAP's Phase B entry for the two paid options that fix it properly. `TIMER_DISPATCH_SECRET` is only needed for the external-cron path and can stay unset until then.

## Dependencies

The lockfile resolves against `registry.npmjs.org`, so `pnpm install` works off Replit
too — in CI, in a container, on a laptop. If you ever regenerate it from inside a Repl,
check that `resolved` URLs didn't get rewritten to `package-firewall.replit.local`;
those pin to a host nothing outside Replit can reach.

`.npmrc` sets `min-release-age=1440`, which blocks packages published less than a day
ago — a supply-chain buffer, since malicious releases are usually pulled within hours.
It needs npm >= 11.6; older npm ignores the key silently, which is why `packageManager`
pins a floor.
