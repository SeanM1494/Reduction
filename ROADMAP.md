# Reduction — Roadmap

Notes are about what each entry actually requires, not just what it is.

**The numbers are names, not an order.** They were a build order once and
several are now built; **Suggested order** near the bottom is the live one.
Each entry carries its own status, so a stale "next up" line is a bug in this
file — fix the entry rather than appending a correction to the end, which is
what the retired "Where this has got to" appendix was.

---

## 1. User login with OAuth

**Status: built, except Apple.**

- Schema and session plumbing — `users`, `identities`, `sessions`,
  `auth_states`, server-side sessions behind an httpOnly cookie (`aafc59a`).
- Google, end to end, **verified working in production**: signed in, session
  created, rows in `users` and `identities` (`9c57573`).
  `docs/google-oauth.md` is the console setup.
- The claim that moves rows into a new account — tests written first, then the
  implementation; all-or-nothing transaction, id collisions re-keyed rather
  than dropped, verified against a real database (`c00bbc6`).
- The sign-in flow replacing the stub (`b540bde`). **The signed-in shell —
  sign-out, the claim-retry banner, post-sign-in extraction — has not been
  exercised against a live session yet.**

**Sign in with Apple is built** (`lib/apple.ts`, `routes/auth.ts`; README
"Sign in with Apple"; CLAUDE.md "Sign in with Apple: four things that fail
silently"). What remains is the phone: the token exchange with Apple has
never run anywhere but a real sign-in, which Phase 4 ("Sign in with Apple
must be live on the deployment — VERIFY") tracks. *(Corrected Sep 30: this
paragraph used to say Apple had not been started.)*

**`owner_key` did not become `user_id`; it was added alongside.** The original
plan was a column swap. What actually happened is that `user_id` was added
nullable next to `owner_key`, and the two now mean different things:

- `user_id` is ownership. A signed-in query scopes by it and nothing else.
- `owner_key` is provenance, plus one live use: the free trial recipe is
  parked under `trial:<trialId>` with a null `user_id` until sign-up claims it
  (#7).

**Anonymous saving is retired — #7 retired it.** An earlier version of this
section said anonymous ownership was a permanent second-class identity because
the sign-up funnel depended on it. That stopped being true when the trial
landed: a signed-out browser no longer builds a library at all, and the funnel
runs on the single trial row plus the pending URL in `auth_states`. The
signed-out query branch (`owner_key AND user_id IS NULL`) now finds only rows
saved before that change, which is exactly what `claimAnonymousLibrary` exists
to migrate — and why it is marked for removal rather than deleted (#7).

---

## The mobile app: native React Native rebuild — DECIDED (Sep 8)

**Parity audit (Sep 19): `MOBILE_PARITY.md`,** beside this file — every web
feature against the native code, what is missing, what differs on purpose, and
the decision on what ships before submission (items 1, 3, 9, 10 there) versus
after. Update it when a row closes; it is the file of record for the gap list.

Capacitor is out; Replit's generated Expo/React Native artifact
(`artifacts/reduction-mobile`) is the delivery mechanism actually in use —
settled by it being what runs in Expo Go today. That converts the earlier
research's warning from hypothetical to work item: **the web component layer
does not transfer; the model layer and server do.**

What carries over untouched: `lib/recipe-model` (all seven modules and their
suites — fold the mobile artifact's local `shared/` copy into the package as
the first act of real mobile work), and the server (bearer auth + the mobile
handshake exist; entitlement, sync endpoints, extraction are UI-agnostic).
The two server gaps for mobile parity are now BUILT (Sep 10, overnight),
server side only — each has a client half that belongs to the phase below:

- **Expo push arm** (`lib/push.ts`, commit ba7b5f0). `push_subscriptions`
  holds an Expo push token in the same `endpoint` column as a web endpoint;
  the token's shape picks the arm, the dispatcher no longer needs VAPID keys
  to run, and `POST /api/push/subscribe` takes `{ expoPushToken }`. Relayed
  through Expo's push service, not raw APNs, because Expo Go can only ever
  produce an Expo token and the service needs no Apple key. Client half:
  `expo-notifications` → `getExpoPushTokenAsync({ projectId })` → that
  route, plus a tap handler reading `recipeId`/`stepId` from the payload.
  Not verified: that a phone buzzes. The suite proves the request against a
  loopback stub.
- **App Store adapter** (`lib/billing/apple.ts`, `routes/billingApple.ts`,
  commit fd15cbb). Verifies StoreKit 2 transactions and Server Notifications
  V2 against Apple's roots, writes `provider = 'apple'` rows, refuses a
  transaction that belongs to another account, and has a preflight that can
  ask Apple for a TEST notification. Client half: a StoreKit purchase handler
  registered through `setPurchaseHandler`, stamping `appAccountToken` = the
  user's id and posting the `jwsRepresentation`s to `/verify`; plus App
  Store Connect work (register the notifications URL, drop the root
  certificates into Secrets). Not verified: a real Apple-signed payload —
  Apple's hosts and certificates are unreachable from the container.

**First-run decision — SETTLED (Sep 8): the mobile demo IS the web demo.**
Same guacamole recipe, same DemoCoach flow, ported not redesigned, and fully
explorable before sign-in — sign-in gates saving/persisting only, exactly as
on the web. So DemoCoach and the guacamole fixture ARE ported (the earlier
not-ported list was wrong to include them); only LandingPage's web chrome —
marketing copy, the signed-out CTA layout — stays out. Depends on the Phase 0
diagram spike, since DemoCoach renders through the same Diagram component.
The fixture is already in the mobile artifact (`data/demoRecipe.ts`, ported
verbatim for the spike), and the spike's auth-gate pass-through in
_layout.tsx is the placeholder Phase 1 replaces with the real demo gate.

Build order is risk-first: the diagram is Phase 0, a fixture-fed spike with
kill criteria, before any easy screen. Its approach: `computeLayout` already
answers WHERE every cell goes (row/col/rowSpan/colSpan) — the HTML table was
only ever one renderer of that answer. RN renders the same answer with
absolutely-positioned Views inside a horizontal scroller: fixed column
widths (the web already constrains them), a measure pass for wrapped-text
row heights, rowspan = sum of spanned rows, sticky ingredient column as a
translateX-on-scroll overlay. Drag hit-testing gets EASIER than the DOM
version: the layout pass owns every cell rectangle, so no elementFromPoint.

### The phases, and where each stands (Sep 10)

**Phase 0 — the diagram spike.** BUILT (commit 23ac9a7, made
symlink-independent in 5c62604). `components/diagram/layoutRects.ts` is
`computeLayout`'s second renderer, pure geometry; `DiagramView.tsx` does
the measure pass and the sticky overlay; `app/spike.tsx` is reachable
signed-out. Four kill criteria, three answered: structural identity
(guacamole plus 100 random trees, in node), the sticky column (static
overlay outside the scroller, measured scrolled), and the tap round-trip.
**Criterion 2, 60fps on a real device — PASSED (Sep 10, in Expo Go on an
iPhone):** JS thread steady at 60fps and the native Perf Monitor at 60fps
through a stress-fixture scroll with taps. Qualifier, accepted: 22 dropped
frames and a 110ms worst frame over the run — single long frames at
events (the first measure pass; a tap, which re-renders every cell because
done state flows through the whole section), not scroll jank. **Phase 1
polish, logged:** memoize cells so a tap re-renders the cells whose state
changed rather than all 161. Phase 0 is closed; the Diagram is unblocked. The mobile artifact's last local
model copy was folded into `lib/recipe-model` in this phase, so the
"first act of real mobile work" above is done.

**Sign-in on the deployment — FIXED (Sep 10).** The handshake's one-time
handoff code lived in process memory on an Autoscale deployment, so the
app's exchange request could land on an instance that never minted the
code: "That sign-in attempt expired" on the phone, nothing in the logs. It
is a database row now, and the session is minted when the code is redeemed
(see CLAUDE.md, "Nothing that spans two requests may live in process
memory"). Sep 11: reproduced and traced end to end with two api-server
builds on one database and a stand-in Google — the real topology is start
on the workspace dev server, callback on the DEPLOYMENT (Google calls back
to `PUBLIC_BASE_URL`), exchange on the dev server. Both old → "expired";
both fixed → signed in; dev fixed but deployment old → still "expired".
So the fix is live only once the deployment is republished on a commit
≥ 5bbed83; `GET /api/health` now reports `commit` on both hosts so that
can be checked rather than assumed. The expiry windows are not a factor:
the auth state lives 10 minutes and the handoff 5, against a round trip
measured in seconds.

**Phase 1, first slice — SHIPPED (Sep 10): the diagram is the Overview.**
`RecipeScreen`'s Overview tab renders `DiagramView` for the demo and for a
saved recipe alike; the scaffold's flat checklist is gone (Cook mode, the
one-step-at-a-time view, stays). The spike route stopped being reachable
from Expo Go by deep link, so the Phase 0 device read moved into the real
demo: in a dev bundle only, the demo header carries a "stress" toggle (the
30-step fixture) and the frame meter sits under it. `__DEV__` guards both,
so no release build ships them, and a release build made with
`EXPO_PUBLIC_PERF_STRIP=1` keeps them — that is how the phone got its read
while Expo Go was walled off: `EXPO_PUBLIC_PERF_STRIP=1 npx expo export
--platform web`, the bundle inlined into one HTML file and published as a
Claude artifact, opened in mobile Safari (fonts fall back; nothing else
differs). Remove the flag, the toggle and the meter once criterion 2 is
recorded — DONE (Sep 12): the spike route, its pass-through, the toggle,
the meter and the `EXPO_PUBLIC_PERF_STRIP` flag are all gone; the 30-step
fixture (`components/diagram/stressFixture.ts`) stays as a fixture. Verified in the RN-web export at three
phone profiles (cells render, an op tap moves progress, the sticky column
holds under scroll, no page overflow, the stress fixture renders, Cook
still works); the device number is still the phone's to give.

**Phase 1 — the read-only app.** Sign-in (exists) → library list →
RecipeView with the proven diagram, StepsMode, servings and reorder →
extraction (URL, text, photo). At the end of this phase the app is usable
for cooking, which is the actual product. Also here, because it is the
first thing anyone sees: the first-run demo (DemoCoach over the guacamole
fixture, ported as decided above) and the real demo gate that replaces the
spike's one-route pass-through in `_layout.tsx`.

**Phase 1, second and third slices — SHIPPED (Sep 11): the library and
RecipeView on signed-in data.** The Library tab is MyRecipes.tsx ported
(filter chips, a sort sheet, the web card token for token; the logic in
`lib/libraryView.ts` under a node test). The recipe route owns the header
— title once, a ⋮ menu with Meal types / Clear progress / Delete — and
RecipeScreen carries the web's standing facts (rating once cooked, the
meal-type badge), the servings stepper (writes `entry.servings` only, steps
by base/8), the diagram, and a 44px source row; Cook mode scales its
amounts; every write is a partial entry through `useLibrary().update`, and
the cooked stamp is taken on the completing tap. Verified in Chromium at
three phone profiles with each write checked in the database; not on a
device, in WebKit, or on production. Three calls were made in the port that
the web does differently, each cheap to reverse — **veto any of them**:
(1) delete is confirmed in a sheet (the web deletes on click; a thumb
reaches Delete more easily than a mouse); (2) the recipe opens on its
stored `mode` tab instead of the web's Diagram / Step-by-step chooser, and
tapping a tab writes `mode`; (3) the list shows a sort control and a count
where the web shows a "My Recipes" title, because the tab header already
says Library. (The per-entry serialization this slice lacked — two fast
cooking taps racing their own `ifVersion` — arrived with the Phase 2 sync
engine.)

**Phase 1, fourth slice — SHIPPED (Sep 11): Cook mode is the web's
StepsMode.** `components/recipe/StepsMode.tsx`: one card per step from
`cardSequence` (honouring `entry.order` when present), ingredients as
checkable rows on the card framed "Add: … Then <step>.", the "builds on"
line, a persisted timer with the parallel-work suggestion from another
section and a one-tap "Back to timer", the finished card, and the cooked
stamp on the completing tap. "Next Step" writes done and the cleared timer
as ONE patch, because two back-to-back writes raced their own `ifVersion`
and paid a 409-merge-retry on the most common tap (measured: four 409s over
a 30-step walk before, zero after). Verified in Chromium with every write
checked in the database. Not ported: the sweep animation between cards, and
the Reorder view that WRITES `entry.order` (it needs a drag list).

**Next slices, in order:** (a) DONE (Sep 12) — the Reorder view
(`components/recipe/ReorderView.tsx`), reached from Cook mode's Reorder
button: rows from `sectionOrder`/`stepSequence` under the current
preference, a grip only where `branchChoices`/`freeSectionIndices` say the
walk can honour a move, a press-and-hold drag (gesture-handler's Pan
activated after 250ms, so the list still scrolls) with a ghost, lit
targets, hit-testing by rows measured in window space at pickup, and edge
auto-scroll so a section can cross a 30-step list; writes `entry.order`
through `pruneOrderPreference`. Verified in Chromium with the row's
database column checked: a branch swap, a section move across a screen of
steps, Reset, and a fixed row refusing to lift. Not verified: the
long-press feel on a real phone, and gesture-handler inside a native
Modal (the view is inline, not in one, for that reason). The card sweep
animation stays unported unless it earns its place on a phone. (b) DONE (Sep
12) — the demo gate: the guacamole demo with DemoCoach is the signed-out
entry point (`DemoScreen` first, `SignInScreen` one tap away and the demo
kept mounted behind it), the spike and the perf strip are removed.
`components/demo/DemoCoach.tsx` is the web's teaching layer ported — stage
line, two tips, legend, "Watch it" with narration — wrapping RecipeScreen
through two slots (`above`, `overviewFooter`) and never reaching into it.
(Sep 29: the stage line and tips are replaced by the guided demo; see
"The guided demo: one instruction at a time".)
(c) DONE (Sep 12) — photo extraction on the Find tab: "Take a photo" and
"Choose a photo" (expo-image-picker) feed the SAME `{ file: { data,
mediaType } }` body the web upload sends, so the server needed nothing.
The one genuine mobile difference: the route accepts 8 MB and hands the
image straight to the model, which refuses over 5 MB or 8000px a side and
downscales past 1568px anyway, while a phone camera makes 12–24 megapixel
JPEGs — so the phone shrinks first (`lib/photo.ts`, expo-image-manipulator:
long edge 1568, JPEG 0.8, the numbers and reasons in `lib/photoSize.ts`
under a node test). Permissions are asked at the tap with purpose strings
in app.json's expo-image-picker plugin config; a refusal the OS will not
re-ask gets an "Open Settings" button, a device with no camera (a
simulator) is told to choose a photo instead, an unreadable page (the
route's 422) gets advice about the shot rather than the validator's
sentence. Verified in Chromium against the local API with the model
stubbed on loopback: a 4032×3024 photo became 1568×1176 at 24 KB, reached
the stub as image/jpeg, came back as a recipe, opened as the draft and
saved as a row; a 4×4 smudge produced the 422 and the advice; the camera
button opens a capture chooser on web. NOT verified: a real camera capture,
the OS permission prompts and their wording (Expo Go shows its own generic
strings; only a development or store build shows ours), HEIC handling on
a real iPhone (the picker re-encodes, the manipulator emits JPEG), and the
simulator's no-camera error text. Found on the way and fixed: the Find
tab's content never padded past the absolutely positioned tab bar, so
anything below the fold there was unreachable.

**Two web-side gaps the photo work exposed, not fixed here:** the server's
8 MB bound sits above the model's 5 MB one, so a 5–8 MB web upload passes
the route and fails at the model as a 500 "Something went wrong"; and a
photo whose base64 exceeds express.json's 12 MB limit gets an HTML 413
rather than the route's JSON one, which the clients render as "Request
failed (413)". A server-side shrink (sharp) or a lower bound with the
web's own resize would close both. (d) DONE (Sep 12) — DiagramView cells are
memoised: `DiagramCell` takes the three state booleans and stable
references instead of the `done` set, and the library context keeps the
recipe object's identity across the server's echo of a write (a fresh parse
was rebuilding the layout on every round trip). Measured in the RN-web
build on the 30-step fixture: 540 cell renders per tap before, 3 for an
ingredient and 8 for a step after; a horizontal scroll renders nothing.
The device number (the 110ms worst frame) is still the phone's to give.
(e) DONE (Sep 12) — the cosmetic pass on Settings, the paywall and Find,
against the Phase 0 audit: Settings' meta labels are Space Mono 11 tracked
and faint, its cards carry radiusCard and the card shadow, and Sign out is
a real .rd-btn-danger (card colour, hairline, light shadow) rather than a
transparent box; the paywall carries the card shadow with the web's 20px
title and 15px body; Find's paste box has a strong edge and the shadow,
its buttons radiusButton, its error the danger tokens rather than the
scaffold's solid red; the sign-in screen's invitation and buttons follow;
and every tab screen pads past the absolutely positioned tab bar. Verified
by computed style and screenshot in Chromium at an iPhone 13 profile in
BOTH schemes: in dark the hairline `border` (#3b352c on #131110) does
carry the card edge on its own, so the shadow's invisibility there costs
nothing, and the library, recipe, cook and reorder screens built earlier
read correctly in dark too. Nothing here needs a device; the one thing a
phone would add is Android's elevation rendering of the shadow.

**Phase 2 — sync and editing.** Port the storage engine behind an
AsyncStorage/AppState seam (the focus refetch becomes an AppState listener;
the per-entry write queue and the 409 merge are unchanged); then the edit
sheets and drag. Editing before sync would build on writes that can
silently lose.

**Phase 2, first slice — SHIPPED (Sep 12): the sync engine.**
`lib/syncEngine.ts` is the web storage.ts's write path, pure and behind
two seams (a transport, and events for the screen), under twelve node
tests against an in-memory model of the route's version check and 409
body. It keeps every rule in CLAUDE.md's sync section: diff-only PATCH
with ifVersion from `lastSynced`; one write in flight per entry with the
newest queued (a create queues too, so an edit made before the row exists
waits and then diffs against it); the 409 three-way merge with the
un-check tombstones; tree conflicts reported to the winner at merge and
to the loser at refresh; refused writes rolled back to the last accepted
state and said so. `lib/library-context.tsx` is now a thin layer over it:
the focus refetch is an AppState listener, and `notice` carries what the
sync path had to say to the screen it concerns. `lib/libraryCache.ts`
persists `lastSynced` per user to AsyncStorage — a READ cache: the
library shows on launch before the network answers and is still readable
with the API down (the account is remembered on disk for that, in
auth-context), and hydrating the engine from it is sound because a
cached ack is an ack. Verified against the real API with two Chromium
"devices" on one account, every step read back from the row: three fast
taps went out as three sequential PATCHes with climbing ifVersions and no
409; a stale device's tap 409'd once, merged to the union and showed it;
foregrounding adopted the other device's work with no write; meal types
edited on both without a refetch between kept the later editor's and told
it so, then told the first at its next foreground; a 422 rolled the tap
back with the server's own sentence; a cold launch with the API blocked
showed all three recipes from the cache and opened one. Not verified: the
AppState transition on a real phone (Chromium's visibilitychange stands in
for it).

**Phase 2, second slice — SHIPPED (Sep 12): the edit sheets.**
`components/edit/EditSheet.tsx` is the web's EditSheet ported over the
Sheet shell: the ingredient form (one amount field — `parseAmount`
decides — a unit picker from the validator's own set, name with the
link-consequence warning, note, "Used in" from `validMoveTargets`, delete
with `deleteIngredientBlocker`'s sentence), the step form (label, time
and temperature, input order by up/down, add an ingredient, split, add
step after, merge into next, delete), the recipe form (title, serves —
`recipe.servings`, which clears `entry.servings` on commit — yield,
source, link, add a section) and the section form (name with the
warning, standing note, delete behind a confirm that carries the
consequence). Every op is validated against the candidate tree before
it is applied and a field's problem is drawn absolutely, so nothing in
the sheet moves under a tap. RecipeScreen owns edit mode: an Edit
button in the facts row, the persistent cool edit bar with Recipe…,
Undo (50 deep) and Done, the diagram's cool outline and 44px section
titles, and `applyOp` — apply, validate, reconcile done, push undo,
write through the sync engine. Verified against real writes in Chromium
with each read back from the row: a tap in edit mode opens the sheet
and does not toggle; amount, name, unit, note, a move between steps,
step label and minutes, add step after, undo, serves (and the entry's
servings clearing), and a section rename all landed; an empty name
showed the validator's sentence under its field with the Done button
moving 0px and nothing written; a delete that the tree forbids is
disabled with its reason; thirteen writes, all 200, none conflicting.
Not verified: the keyboard's behaviour over the sheet on a real phone —
Chromium has no soft keyboard.

**The press-and-hold drag — ported (Sep 16).** In edit mode, holding an
ingredient in the sticky column for 350ms lifts it (the web's hold; a
cell here is also a tap target, so the hold has to be clearly longer
than a slow tap), the steps it may legally join light up from
`validMoveTargets` — the validator's own answer, never a re-derived
predicate — a ghost of its name rides under the fingertip, the step
under the finger takes the cool fill and heavier ring, and release
applies `moveIngredient` through the same validate-undo-write path as
the sheet's "Used in" list, which stays as the move for anyone who
cannot drag. A pickup with nowhere to go (the only input of a step) is
refused before anything moves, with the reason in the edit notice and a
warning haptic; a hold that was refused does not open the sheet on
release either. gesture-handler's Pan activated after the long press,
as in the Reorder view, so a tap stays a tap and a swipe scrolls. The
grid never reflows during a drag. Hit-testing is arithmetic against the
solved rects (`components/diagram/dragMath.ts`, pure and tested): the
finger's window point, the frame's window origin measured once at
pickup, the scroller's offset and how far the page has scrolled since.
Both scrollers scroll themselves while the finger loiters near an edge
— the frame sideways so a step off to the right is reachable, the page
vertically so the next step down is — because on a phone the next step
is already off screen when an ingredient is centred (the web measured
it on an SE; the geometry is the same here). Verified in Chromium at
iPhone 13 against real writes, the row read back after each: a tap in
edit mode still opens the sheet; lime held, lifted with two steps lit
and its own step dimmed, dropped on "halve and scoop" (PATCH 200, the
row's nodes moved); Undo put it back (200); avocados refused with
"“halve and scoop” would be left with nothing" and no sheet on release;
a release over nothing changed nothing; lime parked at the frame's
right edge scrolled the frame 190px and was dropped on "fold together"
once it came into view (200, row moved); salt parked at the window's
bottom scrolled the page to its limit with the ghost still under the
finger. Not verified: the hold's feel and the haptics on a real phone,
and the drag over a native Modal (the sheet closes before any drag can
start, so none is attempted there).

**The offline write queue — built (Sep 16), as a five-minute window
and nothing more.** Decided against a general offline system. A write
that fails because the network is unreachable (no HTTP status: the fetch
threw, or the new 15-second request timeout in `lib/api.ts` fired) is not
rolled back. The engine keeps the newest state for that entry queued, the
screen keeps showing it, a muted banner on the recipe says "No connection.
Your progress here is kept and will save when it returns.", and the write
is retried on every return to the foreground (after the refresh) and
every 10 seconds in between. Taps made while queued collapse into the one
pending write. After five minutes from the first failure without a
successful send, it gives up exactly as an immediate failure does: the
entry rolls back to the last acknowledged state and the existing notice
shows. A real refusal — any response with a status — never waits.

*The merge case is the ordinary merge case.* A queued write carries the
`ifVersion` of what the phone last had acknowledged. If the server moved
on meanwhile, the replay 409s with the row, the three-way merge runs
against `lastSynced`, and the merged state is retried — the same path a
stale write has always taken, because nothing in it knows how long the
write waited. If the phone comes back to the foreground first, the
refresh merges the server's row into the queued state before it is sent,
and there is no 409 at all. Both were verified against the real API in
Chromium with the route aborted at the browser (no status, like dead
wifi): one tap online (landed, v2); block; three taps (kept, banner, no
notice, nothing in the DB through an interval retry at 10s); another
device's change applied in SQL (unchecks one, checks another); foreground
→ GET then one PATCH, DB v4 with the phone's three adds plus the other
device's check, and its uncheck honoured — 4/12 on screen matching the
row. Then the same with no foreground event: the interval retry sent the
stale version, got a 409, retried, landed merged. And the expiry, waited
out in real time: a tap with the route still blocked was on screen with
the banner at 4½ minutes, and at 5 minutes it had rolled back (3/12 to
2/12), the banner was gone, and the notice read "That change could not be
saved (No connection.). It has been undone." — the DB untouched throughout.

*What happens if the app is killed or backgrounded with something
queued — plainly.* The queue is in memory only. A force-quit loses it: the
next launch shows the disk cache, which is the last state the server
acknowledged, so the taps made offline are gone with no notice (there is
nothing left to notice from). Backgrounding keeps it: iOS suspends the JS
thread within seconds, so the 10-second retry does not run in the
background, but the queue survives suspension and the return to the
foreground triggers refresh-then-retry. The window is wall-clock, so a
phone backgrounded for longer than five minutes rolls back with the notice
on return even if the network is fine by then. Deletes are not deferred:
a delete with no network fails at once and the row comes back.

*Open, and deliberately not built:* persisting the queue to disk so a
force-quit replays it. That is what turns "looks saved, is not" from a
five-minute risk into an unbounded one, with a replay that can land days
later against a recipe edited elsewhere — the general offline system this
was scoped away from. If real use shows people force-quitting mid-cook on
dead wifi, that is the next decision, not a bug in this one. The web has
no queue at all; it still fails and rolls back at once.

**Phase 3 — monetization and notifications.** The server halves are done
(above). Client status, Sep 16:

- DONE — **the coupon surfaces** (`components/CouponBox.tsx`): the web's
  box ported, mounted behind "Have a code?" at the wall and in the Plan
  card in Settings, refreshing the entitlement on success so the wall
  lifts because the allowance moved. A grant is not a sale, so it is
  fine under guideline 3.1.1. Verified against the real server: an
  unknown code refused with the server's sentence, a lowercase code
  redeemed (allowance 1 → 3, one redemption row), the wall gone, the same
  code refused again in Settings as already used.
- DONE, unverifiable here — **the Timers card and Expo token
  registration** (`lib/push.ts`, `lib/pushPolicy.ts`,
  `components/settings/TimersCard.tsx`, `expo-notifications` and
  `expo-device` added, the notifications plugin in app.json). The card
  states the sleeping-server limitation whether or not it is switched on
  (the same copy as the web, for the same reason). Turning it on asks
  the OS, gets the Expo token for the build's EAS project id, posts it
  to `/api/push/subscribe`, and remembers the token per account so
  turning it off deletes that exact endpoint and a different account on
  the same phone inherits nothing. A foreground handler shows the banner
  while the app is open — the case that matters, since that is when
  someone is cooking — and a tapped notification, running or cold, opens
  its recipe from the payload's `recipeId`. The state machine
  (`derivePushState`: web and simulators can never hold a token, a build
  without an EAS project id is named as a setup problem rather than shown
  as a toggle that fails, denied sends people to the system Settings)
  and the payload reader are pure and tested. Verified in Chromium only
  that the card renders its "can't receive notifications" state on the
  web build without crashing the app. **Not verified, and not verifiable
  from a container: the permission prompt, a real token, the subscribe
  round-trip from a phone, and a phone buzzing.** Before that can be
  tried at all: `eas init` (the project id in `app.json`'s `extra.eas`),
  and a development build — Expo Go can produce a token but the shipped
  handler and channel are part of the native build.
- BUILT, unverifiable here — **the StoreKit purchase handler** (Sep 16,
  on `expo-iap`; decided: monthly at $1.99 matching the web, yearly at
  $19.99). The web's purchase seam ported (`lib/purchase.ts`: the wall and
  the Plan card call `startPurchase` and never know who sells), the App
  Store handler behind it (`lib/storeKit.ts`, the only file that imports
  expo-iap), and the flow as a pure module (`lib/storeKitFlow.ts`) driven
  through a Store interface so it is proven under node: verify with the
  server THEN finish with the store (a transaction the server never
  recorded stays in StoreKit's queue and is re-delivered next launch
  rather than vanishing with the money), only our two products are ever
  verified or finished, the listener not the request is the source of
  truth, a cancel is not an error, Ask to Buy is "started", restore
  takes the newest of this Apple ID's purchases that is ours and lets
  the server refuse one bound to another account, and a standing
  reconciler settles renewals, approvals and leftovers whenever the
  signed-in app runs. `appAccountToken` = the user's id. **Available
  means the server can record it**: `/api/billing/config` now carries
  `nativePurchaseAvailable`, true only when the Apple adapter is
  configured, and the app sells nothing until it is — a store purchase
  is money taken, and the wall must never show a price it cannot honour.
  The wall grows the two plans — each one IS the purchase button, since
  the store's own sheet is the confirmation and a second Subscribe step
  would only be a tap between the person and the price they chose — and
  "Restore purchases" (`components/SubscribeBox.tsx`), only on a host
  that can sell, and the
  Plan card in Settings manages an App Store subscription in the App
  Store's own page. Verified: twelve node tests over the policy and the
  flow, and in Chromium that the web build's wall and Settings render no
  price, no button and no error. **Not verifiable from a container, in
  order of what has to happen first: App Store Connect (the two products
  in one subscription group, the server secrets, the notifications URL —
  README "App Store subscriptions"), a development build on a physical
  iPhone, a sandbox tester's purchase, then the same restore on a second
  device.** Expo Go cannot run StoreKit. Sep 18: the EAS project exists
  (`seans-apps/reduction-mobile`, the id in app.json), `expo-dev-client`
  and `eas.json` are in, and the README walks the build.

**Phase 4 — store passage.** The onboarding decision that used to sit
here is settled (the demo). Sep 21: the first real sandbox purchase went
through end to end (monthly; the yearly is propagating), so what follows is
the list of what is ACTUALLY left, read from the code and from Apple's
guidelines rather than assumed — each item says whether it is a build, a
verification, or a decision.

- ~~**Account deletion does not exist, anywhere — BUILD, and a guideline
  blocker.**~~ **Done Sep 21.** `DELETE /api/account`, "Delete account" at
  the foot of both Settings screens with a confirm that names what happens
  to billing. DECIDED (Sep 21): deletion cancels the subscription in the
  same action, and both readings below were CONFIRMED the same day: a
  Stripe subscription is cancelled IMMEDIATELY, not at period
  end (no account remains to run out; Stripe refunds nothing on a cancel
  unless done in the Dashboard), and an App Store subscription — which no
  server can cancel — is named in the confirm and again after deletion as
  the person's to cancel in Settings › Apple Account › Subscriptions.
  Verified: seven route tests against Postgres (order, refusal, cascade,
  the audit trail kept), the web flow in Chromium on three phone profiles
  through the confirm both ways, the mobile control's geometry and the
  bearer-token path against the built server. Not verifiable here: the
  phone's own alert (React Native's Alert does not exist on the web build)
  and a real Stripe cancel.
- ~~**No Terms of Use and no privacy policy — BUILD, after a DECISION.**~~
  **Done Sep 21.** Written in-house (decided: no generator subscription),
  as static pages at `/privacy.html` and `/terms.html` (the short names
  opened the web app on the published site, Sep 24 — README "The legal
  pages"; linked by file name since), linked beside every price, in
  both Settings, on the mobile sign-in screen and under the landing CTA
  (README "The legal pages" says where each thing goes in App Store
  Connect). Two things the pages say that the brief simplified, kept
  because the documents would otherwise be false: the website bills
  through Stripe, and extraction sends the recipe (or photo) to Anthropic.
  DECIDED Sep 21: the contact on both pages is `sean@recruitthebench.com`;
  no legal entity and no governing law are named — the operator is an
  individual for now, and the Terms say "where Recipe Reduction is
  established". **Revisit on incorporation**: the entity's name replaces
  "Recipe Reduction (we, us)" in both pages, a governing law can be named
  then, and App Store Connect's seller name (which Apple takes from the
  developer account, not from these pages) changes with the account.
- ~~**The Apple adapter verifies ONE environment per server — BUILD, and a
  review blocker.**~~ **Done Sep 21**: the payload's declared environment
  selects the verifier, both built from the same roots; a server without
  `APPLE_APP_APPLE_ID` verifies sandbox only and says so
  (`production_unconfigured`); the preflight's `verifies` must read both on
  the deployment; the one notifications URL goes in both App Store Connect
  fields. Was: `APPLE_IAP_ENVIRONMENT` picked Sandbox or Production
  for the whole process, fail-closed. App Review (and TestFlight) make
  SANDBOX purchases against the PRODUCTION deployment, so a reviewer's
  purchase would come back `wrong_environment` and the review fails on
  "we could not complete the purchase". Apple's own guidance is to accept
  the environment the signed payload declares: decode the (unverified)
  `environment` claim, verify with the matching verifier built from the
  same roots, and record it on the row. Sandbox testers are created only
  in this team's App Store Connect, which is why accepting them in
  production is Apple's recommendation and not a hole. Half a day with the
  suite; the notifications route needs the same treatment.
- **The App Store Server API answers 401 in PRODUCTION only — DIAGNOSED
  Sep 23, deferred to a post-launch check, NOT a submission blocker.**
  The key is good: with `86fa0b6` the preflight's test notification can
  name its environment, and `?environment=sandbox` was ACCEPTED (Apple
  returned a test notification token) with the same key, issuer, bundle id
  and signing code that `?environment=production` sends and Apple answers
  401 to, "no detail". The token that was refused was read back in full
  (`sent` in the reply, signature withheld): `kid` 5DXDVZ6J55, `iss` the
  team's issuer id, `aud` appstoreconnect-v1, `bid`
  com.recipereduction.mobile, a 20-minute `exp`, and the server clock
  agreeing with the request time. Ruled out on the way, so nobody re-runs
  them: the `.p8` not matching the Key ID (the fingerprint, `60c07b0c…`,
  matches, and sandbox would have refused too), the sandbox/production
  crossover (`selectingVerifier` is the verify path; this is the API
  path), propagation delay (the refusal held for hours), and a second
  bundle id (the repo has only ever named `com.recipereduction.mobile`,
  besides the typo'd `com.reciprededuction.app` record, and the preflight
  reports the right one).
  What is left is Apple's side: **the app has never been released**, and
  the production Server API has no app to answer for until it is. That is
  the most likely reading and it cannot be proven before launch.

  **Why it blocks nothing now:** TestFlight and App Review purchases are
  sandbox transactions, and the status refresh on verify follows the
  TRANSACTION's environment, not the server's, so every purchase before
  launch uses the host that works. Notifications never needed the key at
  all — the route is gated on `appleIapConfig()` and the verifier, Apple
  signs every notification and the roots are the proof — so renewals,
  cancellations, billing failures and refunds arrive and are written in
  either environment (an earlier note here said otherwise; it was wrong).
  Nothing in the app's push path reads an `APPLE_IAP_*` variable.

  **The post-launch check, in order:** (1) once, before launch: after the
  sandbox test notification, the deployment log should carry
  `[billing:apple:notifications] TEST acknowledged` — that proves the
  URL in App Store Connect from Apple's side, which is what the test
  exists for; (2) the day the app is live, re-run
  `POST /api/admin/preflight/apple-iap/test-notification?environment=production`;
  (3) if it still answers 401, take the `sent` block (it carries no
  secret) to Apple Developer Technical Support — at that point the key is
  proven, the app is released, and the refusal is theirs to explain. Until
  (2) passes, a real customer's restore on a second device records the
  transaction the phone held and the next notification corrects it; that
  is the whole cost.

  **The substitute proof, during the TestFlight pass:** sandbox
  subscriptions renew on a compressed clock, so a purchase produces renewal
  notifications within minutes. Watch the deployment log for
  `[billing:apple:notifications]` lines. If none arrive after a sandbox
  purchase, the URL in App Store Connect is wrong.

- **Sign in with Apple must be live on the deployment — VERIFY.**
  Guideline 4.8: offering Google sign-in requires an equivalent option,
  and Sign in with Apple is the one built (`lib/apple.ts`). The mobile
  screen shows "Coming soon" when `/api/auth/providers` reports it
  unconfigured. Read that route on the deployment; if `apple: false`, set
  the four `APPLE_*` sign-in secrets there. The Apple exchange has never
  run from a phone.
- **PAYWALL_ENFORCED at launch — DECIDED Sep 21: ON, as the LAST step.**
  Not before every other item here is verified on the TestFlight build;
  shadow mode until then. The reviewer can reach the purchase either way,
  because Settings shows the plans to anyone without one. Read
  `access_events` first (the query in CLAUDE.md), then set the flag on the
  deployment and redeploy; nothing in the clients changes.
- **Push in a store build — VERIFY.** Expo's push service needs an APNs
  key in EAS credentials (`eas credentials`) before a TestFlight build can
  receive anything; the dev build's token path proves nothing about it.
  One timer, one buzz, on the TestFlight build.
- **The TestFlight pass — VERIFY, the list this whole section has been
  accumulating.** On the production build against the deployment: the
  finish strip through a full cook, VoiceOver over the diagram (items 1
  and 10, still owed), swipe-back off over the diagram (a rightward swipe
  with the diagram at its left edge must NOT pop the screen), the Lemon
  Loaf's `[diagram]` trace pasted back so its shape can be read against
  the fixture, Google sign-in from a store build (the deployment is
  `EXPO_PUBLIC_DOMAIN` there, not the workspace), Apple sign-in, a
  purchase and a restore on a second device, a photo extraction, a timer,
  account deletion on a throwaway account (the App Store subscription line
  before the confirm and after), the Terms and Privacy links beside every
  price, and the whole Recipe Box: shelf, a book turned past "Room for
  one more" and back, search, the preview window into Cook and into the
  diagram, the rating prompt after a cook, remove from the box with its
  toast, Removed recipes and a restore, and the box style in Settings.
- **App Store Connect — the metadata, none of it started.** Rename
  "Reduction Mobile" to Recipe Reduction (rename the old record out of
  the way first, then remove it — it has no build, so it can go; the
  name is released on removal and anyone can take it, hence the order);
  The Home Screen name is a different field and is DECIDED (Sep 23):
  "Reduction", from `expo.name` in `app.json` — it is compiled into the
  binary as the bundle's display name, so changing it costs a build, and
  the store name ("Recipe Reduction") stays in App Store Connect. The
  slug and the EAS project are untouched by it.
  Screenshots for the required iPhone sizes (no iPad: `supportsTablet` is
  false); description, keywords, support URL, marketing URL, the privacy
  policy URL from above; the App Privacy questionnaire (name, email,
  user id, purchases; photos are sent for extraction and not kept — say
  so); age rating; category; attach both subscriptions to version 1.0's
  In-App Purchases section (a first subscription is submitted WITH a
  version); review notes saying how to sign in (Sign in with Apple with
  their own Apple ID, which is why the item above must be true first).
  Export compliance is already declared in `app.json`.
- **Over-the-air updates — DONE Sep 24, in the build that follows TestFlight
  build 3.** `expo-updates` with channels per `eas.json` profile and
  `runtimeVersion` following `expo.version` (README "Over-the-air
  updates"). DECIDED: publishes go through `scripts/publish-update.mjs`
  only, and a native change bumps the version in the same commit. From
  here a label change is a publish, not a build and a review.
- **Housekeeping.** The yearly product appearing in the sandbox; the
  stray `eas.json` at the repo root on Replit (from a wrong-directory
  run — the real one is in `artifacts/reduction-mobile`).

The one entry still open under "Still open from earlier work" (the
component-join finish strip) is a decision, not a blocker, and it waits on
the Lemon Loaf trace above.

**Deliberately NOT ported** — each listed so it does not port by inertia:

- `LandingPage`'s web chrome: the marketing copy, the signed-out CTA layout
  and the fold measurements. The app's first screen is the demo, not a
  landing page.
- The JSON hatch. Its removal on the web is still an open decision; the
  mobile app starts without it.
- `lib/pendingUrl.ts`. It exists to carry a pasted URL across the sign-up
  navigation in `sessionStorage`; on mobile sign-in is in-app and the value
  lives in component state.
- The service worker and everything web-push-specific in
  `NotificationSetting` (install instructions, the Safari gesture rules).
  Native push has none of those constraints; it has the Expo token instead.

## Recipe browsing: the recipe box (Sep 22, approved as proposed)

Cards with photo, name and rating everywhere; a category tab strip; a
two-column grid; a card stack; shelves as a fast-follow once the stack has
been felt on a device. Photos: `recipe_photos` (README "Recipe photos"),
page pictures fetched by the server at save, user photos from the recipe's
menu, meal-type fallback otherwise; nothing hotlinked, no backfill.

- **Stage 1 — server: DONE Sep 22.** Table, extractor capture of
  `image`/`og:image`, fetch-and-resize through `jimp`, the four photo
  routes, the fire-and-forget capture at save (library and trial), photo
  meta on every wire entry, deletion in code with the recipe and the
  account. Eleven route tests. Needs the production DDL in the README
  before the deploy that carries it.
- **Stage 2 — cards, tab strip, two-column grid, photo menu, both
  clients: DONE Sep 22.** The card is its picture (or the meal-type art,
  `lib/mealTypeArt.ts` on each client — same tints, same Feather glyphs),
  its name, a ★ when favourite, and one line of meal type and time.
  DECIDED while building: the progress bar and the step count came off
  the card — a card in a box is for finding a recipe, its state is on the
  recipe screen. The category strip is pinned above the mobile list (a
  tab that scrolls away cannot be jumped to); the web's chips already
  were. Photo from the recipe's ⋮ menu on both: take/choose/remove on
  the phone (lib/photo.ts shrinks it), choose/remove on the web (a canvas
  shrinks it). The photo meta is server-owned: both sync layers take the
  server's value on refresh and never send it. Verified in Chromium on
  three profiles, both clients, upload and remove through the real file
  input on the web; the phone's own picker is the device's to confirm.
- **Stage 3 — the card stack: DONE Sep 22, behind a toggle.** One 44px
  button at the end of the category strip flips Grid ↔ Stack (DECIDED
  while building: one icon button, not a two-button segment — the sort
  row is already full at 320px). The choice persists per device
  (`lib/libraryViewMode.ts`, which also holds the gesture policy under
  test: a swipe commits when it has gone 35% of the card or is moving
  faster than 0.6px/ms, in the direction it moved; the ends do not wrap
  but give 20px and spring back).
  **Rebuilt Sep 22 on gesture-handler and reanimated**, after the first
  cut reached a phone broken in two ways this container could not see —
  see CLAUDE.md for both. `components/library/CardStack.tsx` now drives
  the whole deck from ONE continuous `position` (`index` plus how far
  through the swipe you are), so the cards behind rise and grow by exactly
  as much as the front card has left, at every frame, and nothing is ever
  reset. The drag runs on the UI thread; a Pan and a Tap race for the
  touch, which settles the Pressable negotiation natively. Neither library
  is a new dependency — expo-router already brings both and two components
  already use them. Chevrons flank the counter so the deck is reachable
  without a drag; a light haptic marks a commit. Verified in Chromium on
  three profiles, including mid-drag sampling that the deck moves
  continuously and that the rubber band gives 20px rather than 300.
  **RETIRED Sep 24** — the Recipe Box's books replaced it (step 8 of "The
  Recipe Box: books" below lists what was removed). Its lessons live on in
  CLAUDE.md's gesture rules, now pointing at the books. Shelves were never
  built and are not queued: the books ARE one book per category.
- **Photo backfill on a cache hit — a nice-to-have, not queued (Sep 22).**
  A tree that was cached BEFORE the extractor started recording
  `recipe.image` has no image URL and never will: `cacheGetUrl` returns
  the stored tree verbatim and nothing re-checks. So an old row extracted
  again by anyone shows the meal-type fallback for ever, even though the
  page itself has a perfectly good picture. (A tree cached since the
  change carries `image`, and `capturePagePhoto` runs at SAVE, so a cache
  hit on one of those still gets its photo. The other way to land without
  one is the `web_fetch` fallback path, which never sees an image URL at
  all — that one is inherent, not staleness.) Confirmed Sep 22 as the
  explanation for a photo-less Greek Chicken Gyros; **not a bug, and
  nothing is blocked on it.**

  Which of the two applies to any given extraction is a query, not a
  guess:

  ```sql
  select at, host, cached, via, ok, ms from extraction_events
   order by at desc limit 20;
  ```

  `cached = true` is the stale row; `cached = false, via = 'claude'` is the
  fallback. If it is ever worth doing, the cheap version is to have the
  save path ask `/photo/from-source` when the tree has no `image` and the
  entry has a `sourceUrl` — one extra page fetch per recipe, on a save
  that is already doing one. The expensive version, re-extracting old cache
  rows to fill `image` in, spends the API budget on pages nobody has asked
  for and should not be built. The escape hatch that exists today is
  `/reextract`, which still has no caller on mobile (parity item 6).

## The Recipe Box: books (Sep 23, designed with an interactive prototype)

Replaces the card stack as the default Library view; the two-column grid
stays as an alternative chosen in Settings. Seven books, a display grouping
over the meal types (a recipe sits in the book of its PRIMARY type, never
two): Breakfast · Lunch · Dinner · Apps & Snacks (snack) · Salads (a new
ninth type) · Desserts · Other (side, drink, baking, untagged). A spread is
two recipes; a swipe turns a page with a real 3D flip; a vertical swipe
changes book in an endless loop. Built in eight steps, each committed and
verified; the design is the prototype, the tuned numbers are the handoff's.

DECIDED (Sep 23):
- **Sort** is persisted per device and shared by both views, with a 44px
  sort button in the Books header row. 👎 always goes to the back of its
  book whatever the sort.
- **Total time** is captured at extraction (JSON-LD `totalTime`, or a time
  the page states outright — never estimated), new recipes only. Where a
  recipe has none, the time line is HIDDEN; the sum of timed steps is never
  labelled total time anywhere, because on a "30-Minute Mongolian Beef" it
  read "2 min". Timed steps still drive timers and Cook mode. Its own
  commit, separate from the books. **DONE Sep 23** (recipe-model
  totalTime.ts): JSON-LD `totalTime` on a structured page — where it is the
  ONLY source, since the model there never sees the page — and a total the
  text or photo states outright elsewhere. Prep + cook are never added up.
  Both clients' cards and the "Total time" sort now use it; cards without
  one show no time. On the book page, a hidden time line leaves no hole
  (the lines below flow up, the cooked pill is pinned to the bottom); on a
  narrow page it buys back the second line of ingredients the SE fix took
  — measured on the prototype, 0 collisions over 31 pages.
- **Two books**: the other one always peeks below; swipe up switches,
  swipe down rubber-bands. **One book**: no peeks, no vertical swipe. An
  **empty library** is the existing invitation to find a first recipe.
- **Removed is not deleted.** A 👎 can take a recipe out of the box;
  `recipes.removed_at`, restorable from Settings, never refunds the free
  allowance. Merged on whether it is removed, never on when (shared/sync.ts).

DECIDED (Sep 23, after the step-1 push):
- **Cover colours**: the prototype's hues, darkened in lightness only to
  4.6:1 for the 11px white tab text — Breakfast `#986d29`, Lunch `#657c51`,
  Apps & Snacks `#477d7b`, Salads `#5a7f43`; Dinner `#a94f3a`, Desserts
  `#8e4f6f` and Other `#6a6575` already passed and are unchanged. The
  prototype's Breakfast was 3.03:1.
- **Narrow pages** (under ~160px wide — an iPhone SE): one line of
  ingredients and the cooked pill as "2× · Sep 5", which took the
  prototype's SE pages from 19 of 31 colliding to none. When a recipe has no
  stated time its line is hidden, and the ingredients get their second line
  back — still no collisions.
- **The page flip is SPLIT FACES**, tested on a real iPhone: each face of the
  turning leaf is its own view, one rotation about the spine, shown by
  angle. The prototype's nested leaf (both faces in one view, the back
  culled by backfaceVisibility) mirrors the front through the page in
  Chromium, because React Native renders each view as a flat layer. The
  test screen (app/dev/flip.tsx) that proved it is gone with step 8.

- **The ninth meal type, salad: DONE Sep 23.** Appended to MEAL_TYPES so no
  existing order moved; its own art on both clients; the prompt now puts a
  salad first as salad whatever meal it is served at. The list grew from 8 to
  9 for the Salads book — the split ROADMAP #8 kept the list small to make
  cheap. Existing recipes are NOT re-tagged: a salad saved before this sits
  in Dinner or Other until it is re-extracted or re-tagged by hand. A build
  already installed on a phone drops "salad" silently (its sanitizer does
  not know it) until it is rebuilt.
- **Step 1 — removed_at, server and sync: DONE Sep 23.** Hand-run DDL (README
  "The recipe box") that must run BEFORE the deploy; `/api/health` now
  reports missing hand-run DDL by name. **Known gap, deliberate: the web
  hides removed recipes (the server leaves them out of the list) but has no
  Removed list and no restore.** A recipe removed on the phone simply
  disappears from the website until it is restored on the phone. Worth
  building when the web gets the books; not before.
- **Step 2 — the book view: DONE Sep 23** (b01d3c3).
- **Step 3 — the carousel between books: DONE Sep 23.** Decided while
  building it:
  - **The navigator's "Library" title is hidden in Books view.** The books
    carry their own header, and on a phone the classic header cost the
    peeks nearly all their room (31px above the book on an iPhone 13's
    Safari-sized viewport with it hidden, ~0 with it shown). It also makes
    the classic and native tab layouts the same screen: NativeTabs never
    had a header there.
  - **The book shrinks before the peeks vanish.** Width is the prototype's
    min(screen − 24, 380) unless the stage is too short for a neighbour to
    show 28px of cover plus its tab; then the book narrows, never below
    220px (`carouselGeometry`). As the app (no URL bar) no phone measured
    shrinks — iPhone 13 peeks 98/119px, SE 52/73px; only the SE's
    Safari-sized viewport does, 296 → 290px.
  - **The shelf dots are a picture, not a control.** Seven 7px dots cannot
    each be a 44px target in the room between the page arrows; a peek, a
    swipe and (step 5) search reach any book, and VoiceOver has next/previous
    book actions on the pages.
  - **With two books the one leaving upwards fades out by half way and
    rises into the slot below** — the other book always waits below, so
    the book you leave goes to the back of the pile rather than sitting
    above you.
- **A page turn can no longer strand the book (Sep 24, ba43693)** — a quick
  second swipe landed between two spreads; see CLAUDE.md's gesture rule.
- **Step 4 — the preview sheet: DONE Sep 24.** Tapping a page opens it;
  "View diagram" and "Start cooking" open the recipe on that tab. Decided
  while building it:
  - **No stated time, two tiles.** The total-time tile follows the page's
    rule, so a recipe without one shows servings and steps only, never a
    blank or guessed third tile.
  - **The tab the preview opens is not saved.** RecipeScreen still writes
    its tab when you TAP one; opening from the preview is a choice for this
    visit, and a write on every open would be a sync round trip nobody
    asked for. So the grid, which still opens on the stored tab, is
    unaffected.
  - **Six ingredients** before "+N more" (the page has room for three).
  - **A centred window, not a bottom sheet** (decided on the phone, Sep 24).
    The first cut used the app's Sheet, whose Modal slides the WHOLE layer
    up — so the dark shading itself rose up the screen behind the card. Now
    the shading fades where it is and the card fades in from 94% scale;
    the two buttons close it instantly, because the recipe is being pushed
    underneath. The app's other sheets (sort, meal types, the ⋮ menu) still
    slide the same way and would look the same half open; not changed yet.
- **NEXT AFTER THE RECIPE BOX (asked Sep 24): a sweep of every other sheet
  for the sliding wash.** Same cause as the preview: the shared `Sheet`'s
  Modal slides the scrim up with the card. The recipe screen's ⋮ menu is
  to become a WINDOW like the preview; the rest at least fade their scrim
  in place. Tabled until step 8 is done.
- **Step 5 — search inside the box: DONE Sep 24.** A 16px field under the
  header; while it has text the shelf is replaced by results (thumbnail,
  title and rating, book chip, stated time, cooked count). `searchBox`
  reuses the Find tab's `searchLibrary` and adds the book's NAME, so
  "dessert" finds the book; removed recipes never match. A result opens
  its book to its spread with no slide and no turn, and outlines the page
  in the book's colour for ~1.8s. Nothing found → "Search the web for it"
  → the Find tab with the query filled in and the web search run once.
  (Since Sep 28: "Look for it elsewhere" → Find › My Recipes with the
  query — suggestions from the cache, then a web search in Browse.)
  Measured cost: the field row is 52px, which the book pays only where the
  stage was already short — as the app, no phone shrinks (iPhone 13 366px,
  SE 296px); in Safari-sized profiles the iPhone 13 book goes 366 → 343
  and the SE's 290 → 223, peeks still showing.
- **Step 6 — rating on finish, 👎 → remove or keep, undo: DONE Sep 24.**
  The prompt hangs off the cooked STAMP (stampCooked), so it fires from the
  diagram and from Cook mode alike and never twice inside six hours. Both
  questions are one window with two stages (`FinishPrompt`), because iOS
  will not present a Modal while another is dismissing. Decided while
  building it:
  - **Windows, not sheets**, for every new dialog (`components/Window.tsx`,
    extracted from the preview) — the direction set on the phone.
  - **From the cooking prompt, 👎 always asks** "take it out?", even if it
    was 👎 before: a fresh verdict on a fresh cook. **From the recipe's own
    rating control, only a change TO 👎 asks**; re-tapping 👎 clears it
    (the control's toggle) and asks nothing.
  - **Remove goes back to where you came from** (the library) and the
    "Removed … Undo" snackbar waits there for 5s: the recipe's own screen is
    the one place it can no longer be. Keep stays on the recipe with a toast.
  - **Undo works even after the library has refreshed** — which drops the
    removed row, since the server leaves it out: `restore(entry)` adopts the
    entry as it was removed and writes `removedAt: null` through the engine,
    a deliberately stale write the 409-merge resolves in its favour (pinned
    in syncEngine.test.ts). Settings' Restore (step 7) is the same call.
  - The toast sits above the Recipe Box's page controls, not on them.
- **Step 7 — Settings: DONE Sep 24.** "Recipe box style" (Books · Grid)
  and "Removed recipes" (with its count). Decided while building it:
  - **The style has its own key**, `reduction_box_style`, and Books is the
    default. The old in-library toggle's key is read once as a fallback:
    it only ever held something someone TAPPED, so a stored 'grid' there is
    a real choice and is kept; its 'stack' is the books.
  - **Both in-library toggles are gone**; the setting is shared live
    between the two tabs (`lib/boxStyle.ts`), so switching in Settings
    changes the Library without a reload.
  - **The grid got the box's search** (the spec's "with its search"): the
    same field and `searchBox`, spanning every category — the category
    strip hides while it runs — and the same "Search the web for it".
  - **Removed recipes is its own screen** (`app/removed.tsx`), read from
    the server each time it opens, because the phone holds no removed rows.
    Restore is step 6's `restore()`; "Delete forever" confirms in a window
    and then uses the recipe menu's own delete. Neither refunds the free
    recipe (`recipes_used` is monotonic, CLAUDE.md).
  - **An empty library that only had recipes taken out says so**, with a
    button to Removed recipes, instead of looking like everything was lost.
- **Step 8 — the card stack retired: DONE Sep 24. The Recipe Box is
  complete.** Removed, and nothing of it was shared with the books:
  - `components/library/CardStack.tsx` — the deck, its pan/tap gesture and
    its spring and layout constants (GAP, RISE, SHRINK, FADE, SPRING).
  - From `lib/libraryViewMode.ts`: the stack's gesture policy and tuning —
    `dragPosition`, `overscrollPx`, `swipeOutcome`, `stackStep`,
    `stackWindow`, `RUBBER_BAND`, `OVERSCROLL_MAX_PX`, `PEEK`,
    `TAP_SLOP_PX` — and their five tests. What stays there is the box style
    (`parseBoxStyle`), which still reads an old 'stack' choice as the books.
  - `RecipeCard`'s `layout` and `height` props: the 'stack' face and title,
    and the never-built 'shelf'. It is the grid's card now, nothing else.
  - The page-flip test screen (`app/dev/flip.tsx`) and its development-only
    row in Settings.
  - CLAUDE.md's gesture rules, rewritten to point at the books' code
    (Book.tsx, RecipeBox.tsx, lib/recipeBox.ts) instead of the stack's; the
    lessons and the incidents that taught them are unchanged.
  Kept, because the books use them: reanimated, gesture-handler and
  expo-haptics (all were already dependencies).
- **The sheet sweep: DONE Sep 24.** Fixed at the source: the shared
  `Sheet` no longer lets its Modal animate. The scrim fades where it is and
  only the card slides up (and back down on close), so sort, meal types,
  photo and every edit sheet lost the wash at once. The recipe's ⋮ menu and
  its "Delete this recipe?" are now windows, like every dialog that asks
  something. A menu item that opens another dialog opens it from the
  menu's `onClosed` — after the menu's Modal is gone — because iOS can
  refuse, or take down, a Modal presented while another is dismissing.
  Left alone on purpose: ErrorFallback's slide-up details view, which only
  exists in development builds. Also fixed on the way: deleting a recipe
  opened from a link had nothing to go back to and stayed on a recipe that
  no longer existed; it now lands in the library.

## 2. Global recipe search inside the app

**Status:** partially built. The header search bar filters your own saved
recipes client-side and falls through to web search.

**What is missing:** searching across *all* recipes saved by *all* users.
That needs a search index over the `recipes` table — Postgres full-text
search is enough at this scale, and needs no new dependency.

**Design question, now settled — see "Visibility — settled" in #3.**
Libraries stay private; nobody browses anyone else's. What crosses between
accounts is an aggregate count and nothing else. The question was whether
saved recipes are public by default, private by default, or toggled, and it
blocked both this and #3.

**Half-made already, deliberately.** `visibility` (default `private`) and
`share_slug` columns exist so that sharing is not a migration against a live
user base later — but nothing reads them, there is no UI, and the actual
decision is still open. Worth noting the non-technical half: these rows hold
recipe text derived from other people's sites, so "public" is a different
question from "private", and not one the schema answers.

---

## The business model, because it decides several of these

**One free recipe, then an account, then a monthly subscription.** The user
never sees or bears the API cost. It is margin.

Three consequences that should be applied wherever they bite, rather than
re-derived case by case:

1. **The trial exists to convert, not to be fair.** It is not a meter that
   has to be proportionate to what a request cost us. Do not argue about
   whether charging someone for something is "fair" — argue about whether it
   converts, and whether it makes the product feel worth paying for.

2. **The cache is margin, not a courtesy.** Every hit is a recipe served at
   near-zero marginal cost against revenue already collected. Anything that
   raises the hit rate without risking correctness pays for itself, and that
   is why URL normalisation went from "a trade to be careful about" to
   something worth doing straight away.

3. **A user-triggered API call is the user spending my money.** That is a
   different thing from a call the product decided to make, and it wants a
   tighter leash — see the re-extract hatch below, which is signed-in only and
   capped per day for exactly this reason.

What does NOT change: correctness. Serving somebody the wrong recipe costs
trust, and no hit rate pays for it. Every cost decision below is bounded by
that, most explicitly in the deny-list rule for URL parameters.

### Where the money goes — measured, and now recorded

Numbers from the code as it stands. All three tasks run `claude-sonnet-5`.

| path | input | note |
|---|---|---|
| system prompt | ~1,010 tok | every extraction call |
| user scaffold (`CRUST_EXAMPLE`) | ~250 tok | every extraction call |
| JSON-LD extraction | **~1,630 tok** total | the cheap, common case |
| pasted-text extraction | **~6,700 tok** | `MAX_CHARS = 24,000` of prose |
| **`fetchViaClaude`** | **up to ~120k tok** | `max_content_tokens: 40000` x `max_uses: 3` |
| output | ~350-400 tok | a whole tree is small |

**`extraction_events` exists so the tuning starts from data.** One row per
extraction attempt or cache hit, written on `res.on("finish")` so no exit path
can be missed and no latency is added. It answers the two questions that gate
everything below:

```sql
-- what fraction takes the expensive path
select via, count(*) from extraction_events
 where not cached and source = 'url' group by via;

-- how often the repair retry fires
select via, attempts, count(*) from extraction_events
 where not cached group by via, attempts;
```

It is **operational, not behavioural**: host rather than URL, and no trial
id. It had no user id either, as a boundary, until cost made the case for
one (Sep 30, "Launch readiness" below): a nullable `user_id`, nulled when
the account is deleted, read only by the admin cost route as ids.
A 400, 413 or 429 records nothing, because counting requests that never
reached the model would wreck the denominator of every query above.

**The levers, biggest first. Do not pull any of them before the table has a
week of data.**

1. **`fetchViaClaude` is the whale** — one call can cost 20-70x a JSON-LD one.
   Two cheap changes: `max_content_tokens` from 40k to ~15k (a recipe page's
   *recipe* is a few thousand tokens; the rest is navigation and comments) and
   `max_uses` from 3 to 1. Worth knowing the frequency first: if it is 5% of
   extractions it may still be most of the bill, and if it is 40% the fix is
   to make `fetchSource` succeed more often instead.
2. **The retry resends everything.** `MAX_ATTEMPTS = 2`, and attempt 2 sends
   the original conversation *plus* the model's full previous JSON *plus* the
   repair text — so a repair costs more than the original call, and on the
   web_fetch path it re-sends the fetched page. The top few recurring
   validator errors are probably fixable with one sentence in `prompt.ts`,
   which is the cheapest fix in this list.
3. **Model choice per task is untried.** Search is a formatting job wrapped
   around a tool call; it does not obviously need the same model as building a
   tree that must satisfy `validateRecipe` first time. Haiku for search,
   Sonnet for extraction, is the split to test. Do not economise on the tree.
4. **~1,260 tokens of identical prefix on every call wants prompt caching**,
   not trimming. Every rule in `prompt.ts` maps to a `validateRecipe` check,
   so cutting one buys a retry — lever 2 in reverse.
5. **`MAX_CHARS = 24,000` on the text path is NOT a lever.** Truncating a page
   mid-recipe produces a wrong tree, which costs more than the tokens saved.

---

---

## 3. Reuse extracted recipes across users

**The idea:** once anyone has extracted a recipe from a URL, serve that
stored version to the next person instead of paying for extraction again.

**Status:** half-built already. `extraction_cache` is keyed on a hash of
the URL and is not scoped per user, so a second person pasting the same
link already hits the cache. The remaining work is *discovery* — surfacing
"someone already diagrammed this" when the user searches rather than
pastes a link.

**How it should work:**
- Search results check the cache before offering to extract.
- A cached result renders instantly and costs nothing.
- Extraction only ever runs for a URL nobody has diagrammed yet.

**Two things to be careful about:**
- **Corrections must propagate.** If the first person's extraction was
  wrong and they fixed it by hand, later users should get the fixed
  version, not the original bad parse. That means storing edits against
  the canonical recipe, not only on the user's copy.
- **Attribution and licensing.** Serving one user's extraction to another
  is different from caching for one person. The tree is our own structured
  data rather than the source's prose, and every recipe links back to its
  source — worth keeping that invariant as this scales.

### Visibility — settled

**Libraries stay private. Nobody browses anyone else's recipes.** The
`visibility` and `share_slug` columns exist for a possible future
share-a-link feature; they are not the model here.

**Aggregate counts are fine.** "3 other people saved this" is a useful
signal and reveals nothing about who — it is a number, not a list. That
is the whole of what crosses between accounts.

This splits the work into two stages that can ship independently:

**Stage one — cached trees in search results.** ~~A search checks the
extraction cache before offering to extract.~~ **Built.** `/api/recipes/search`
annotates each result with `cached` and stable-partitions the cached ones to
the front; the badge reads **"Instant"**, which describes what the user gets
rather than what happened behind it. Opening one costs no API call and takes
no free extraction.

The annotation runs on every response, including a search-cache hit —
`searchCache` holds a query for 30 days while `extraction_cache` moves under
it constantly, so a flag stored beside the results would go stale in both
directions: a badge promising an instant open that then quietly paid for an
extraction, and a cached tree nobody was told about.

There is deliberately **no "is this URL cached?" endpoint**. The same answer
over an arbitrary list would be a bulk oracle for "has anyone ever extracted
this page", and the only caller is the search response, which already knows
the URLs because it produced them.

*What this exposes*, stated plainly: one bit, "somebody at some point
extracted this page". `meta.cached` already returns that on the paste path,
and ranking cached results first leaks it whether or not a badge exists. It
says nothing about who, and nothing about saving — the saved count is stage
two.

### A cached hit DOES spend the free recipe — decided

If you are here because it looks like the trial is charging for something that
cost nothing to serve: it is, deliberately.

**One free recipe means one, cached or not.** The trial is not a meter on our
cost, so "a cache hit costs no API call" is not an argument about it. The
trial exists to convert, and the wall is the product: someone who views
unlimited free diagrams because they happened to pick popular recipes never
reaches it, and never has a reason to make an account. The better the cache
gets, the more that would erode the funnel — success at #3 quietly dismantling
#7.

This was built the other way first, on the fairness reasoning that charging
for a coincidence is arbitrary. That framing was wrong for a paid product: see
"The business model" above. Do not re-derive it.

**So `requireExtractionAllowance` is middleware**, taken before the handler
and before anything looks in the cache. `storeTrialRecipe` keeps its
insert-once semantics, because a signed-out visitor can only ever have one
successful extraction.

**The per-IP throttle is a different gate and stays behind the cache lookup.**
That one genuinely is about cost — it exists to cap API spend, and a cache hit
has none to cap. Do not collapse the two: they answer different questions.

**Stage two — the count. Built Sep 24, together with a five-result
search** (README "Search"). DECIDED: the "Instant" badge is gone — it
described how the app works, not why anyone would pick a result — and a
result carries one line instead: saved by N people, cooked N times, N%
loved it, derived from `recipes` with no new table. DECIDED: each part has
a floor (3 accounts, 5 cooks, 5 ratings) and below it nothing is said,
because a count of one looks broken and is close to naming a person; at
TestFlight-scale usage that means almost no result carries a line yet,
which is the honest state. DECIDED: search now also returns up to three
cached pages matched on title — the first time a page reaches someone
because somebody ELSE read it, not because the web returned it — so only
pages read from a URL, and only URLs that look public, may surface; the
privacy policy says so. Not yet a RANKING signal: cached results come
first, in title-match order, and the web's keep the web's order.

Ratings (#8) are the natural companion to stage two: "people cooked this
twice" is a better sort than relevance, and better than a raw save count.

### Two pieces of cache work, and the order is the point

Both were surfaced by a real bug: a cookie recipe parsed badly, and
re-submitting the same link produced a *different, correct* tree instead of
the cached one. Neither is built. **The order below is the decision, not an
accident** — doing them the other way round makes the product worse.

**First: a correction replaces the cached tree.**

Today the cached tree and the user's library row are separate copies.
`extraction_cache` is written once by `cacheSet` in `artifacts/api-server/src/routes/recipes.ts`
and never touched again; fixing a recipe in the visual editor (#6) updates
only `recipes.recipe` for that one user. So the next person to paste the same
link still gets the original bad parse — and now indefinitely, since the TTL
is gone, which is what makes `/reextract` load-bearing rather than a nicety.

This is newly worth building because the editor now exists — before it, there
were no corrections to propagate. The open questions come from #6 and should
be settled there first: only a *correction* propagates, never a *fork*; and a
correction should need several independent people making the same fix rather
than one report, which costs nothing to require and stops one confident cook
rewriting a recipe for everyone.

**URL normalisation — built, and it went FIRST after all.**

The order above was written when the worry was blast radius. Two things
changed it. The editor now covers every field in a stored recipe, so a person
who lands on a bad tree fixes it in taps rather than raw JSON. And the
business model says a miss is margin burnt on a page somebody already paid to
read — which makes the hit rate the objective rather than a nice-to-have.

**The design is what makes it safe to ship ahead of correction-propagation:
the raw string is still the identity, and the normalised key is an ALIAS.**
`extraction_cache.hash` is unchanged — `sha256("url:" + raw)` — and the new
indexed `url_key` column holds `sha256("urlkey:" + normalised)`. `cacheGetUrl`
tries the exact key first and only then the alias. If a fold ever proves wrong
for some site, deleting the second lookup is a one-line change and every row
is still correct and still addressable. Nothing has to be migrated to undo it.
See `artifacts/api-server/src/lib/urlKey.ts`.

**Correctness is the constraint and it is expressed as a DENY-LIST.** Query
parameters are kept unless they are on a list of known-inert tracking tokens
(`utm_*`, `fbclid`, `gclid`, `mc_cid`, `_ga`, `amp`, …). Never an allow-list:
`?page=2`, `?print=1` and `?servings=6` select content, and an allow-list gets
that backwards by default — it would silently drop every parameter it had not
heard of, on exactly the pages where the parameter mattered. Three that read
like trackers are deliberately NOT folded — `ref`, `source`, `campaign` — for
the same reason. `artifacts/api-server/src/lib/urlKey.test.ts` has a "must NOT fold" block that
is the real specification.

Two folds considered and rejected: lowercasing the path (hosts are
case-insensitive, paths are not) and stripping a trailing `/amp` path segment
(a path is a path; the `?amp=1` query flag is folded).

**Several raw URLs sharing an alias is the normal outcome**, so the alias
lookup orders by `created_at DESC` — if one of them was re-read because the
tree was wrong, that is the one to serve.

**Extracted trees do not expire.** There was a 30-day TTL; it is gone, not
extended. Recipe pages do not meaningfully change, and every expiry threw away
an extraction already paid for — the good trees along with the bad. The risk
it was insuring against was a bad parse becoming everyone's for a month, and
`/reextract` bounds that directly and on demand, which is strictly better than
a timer that cannot tell the two apart. `created_at` is still written and
still load-bearing: it is what the alias lookup orders by.

**One assumption this touched.** The TTL constant was shared with
`searchCache`, and those two want opposite things. Search results are a list of
live URLs and a dead link is worse than a fresh search, so that cache keeps a
30-day expiry as `SEARCH_TTL_MS`. Removing the extraction TTL without
splitting the constant first would have made search results immortal too.
Nothing else read it.

**The re-extract hatch** (`POST /api/recipes/reextract`) is what bounds the
blast radius that normalisation widens. Anyone who lands on a plainly wrong
tree can make the extractor read the page again, for themselves and everyone
after them. It is **not** correction-propagation and does not pre-empt the
consensus requirement above: it re-runs the extractor rather than propagating
one person's edits, so the worst a single user can do is spend one API call
and replace a machine-generated tree with another. Signed in only, capped at
5/day per user, and the client confirms first because it discards local edits.
The cap is in memory, so a restart resets it — a durable counter is the fix if
that ever matters.

---

## 4. Recipe design tool (premium)

**The idea:** build a recipe from scratch in the diagram rather than
extracting one.

**Why it fits:** the tree is already the source of truth, and
`validateRecipe` already knows what a valid one looks like. A builder is
a UI over operations the data model supports today — add ingredient, add
step, choose inputs, set the root.

**Hard parts, in order:**
- Editing a tree without letting the user create a cycle or a fan-out.
  The validator catches both, but the UI should make them hard to
  express in the first place.
- Undo.
- The branching convention. When someone wants to reserve half a sauce,
  the builder has to guide them into making it a separate section,
  because a rowspan table cannot draw a split.

**Monetization note:** this is the first feature where the value is
creation rather than consumption, which is a reasonable place to put a
paywall. Worth checking whether search + reuse stays free.

---

## 5. Suggest recipe variations on search

**The idea:** search "chocolate chip cookies" and get several distinct
takes — brown butter, chilled overnight, thin and crispy — rather than
ten near-identical blog posts.

**Status:** the search prompt already asks for distinct domains and a
one-line note on what makes each version different. This idea is that,
taken further: cluster by *technique* rather than by source.

**Two ways to do it, in increasing effort:**
- **Prompt-level.** Ask the model to return versions that differ
  meaningfully in method, and say how. Cheap, works now.
- **Structural.** Once #3 is live and many recipes are stored, compare
  the trees directly. Two cookie recipes that differ by a chill step are
  visibly different diagrams. This is the version nobody else can copy,
  because it depends on having the structured data — and it is the
  strongest argument for the whole tree model.

**A third source, better than both:** the forks produced by #6. When a
user marks an edit as "I make it my way," that is a real variation of a
real recipe, cooked by a real person. A corpus of those beats anything
generated, and it accumulates as a side effect of letting people fix
things.

---

## 6. Editing a recipe the app got wrong

**The idea:** when extraction misreads a recipe — a step split that should
be one, an ingredient attached to the wrong step, a label that lost its
temperature — the user can fix it rather than abandoning it.

**Why it matters more than it looks:** every extraction is a model's
interpretation, and some fraction will be wrong. Without editing, a bad
parse means the recipe is useless and the user starts over. With editing,
a bad parse is a minor annoyance. That is the difference between a demo
and something people rely on.

**Related to #4 but not the same.** The premium builder creates from
scratch; this repairs an existing tree. The underlying operations overlap
heavily — reassign a step's inputs, rename a label, split or merge steps,
fix an amount — so building this first makes the builder largely a matter
of starting from an empty tree. Worth sequencing that way.

**Two entry points, same edits underneath:**
- From the diagram: tap a cell to correct its label, amount, or which
  step it feeds.
- From step-by-step mode: an "this isn't right" affordance on the card,
  which is where a wrong interpretation is most likely to be noticed —
  mid-cook, when it matters.

**Hard parts:**
- Every edit must leave the tree valid. `validateRecipe` already knows
  what valid means, so the constraint exists; the work is a UI that makes
  invalid states hard to express rather than merely rejected.
- Undo.

**Correction vs. variation — the user tells us which.** When someone
edits, ask: *"This isn't what the page said"* or *"I make it my way."*
The user knows which it is, and the answer decides whether the edit
propagates to the shared version or stays theirs. This resolves the
canonical-version question that #3 would otherwise force.

Three things the schema has to distinguish, not two: the **canonical
parse**, **corrections** against it, and **forks** that diverge on
purpose.

Two consequences worth designing for:

- **People will pick the wrong option.** Someone who always adds cayenne
  may sincerely believe the recipe was wrong. So the labels must be
  unmistakable — describe the *source*, not the cook — and a correction
  should not propagate on a single report. Several independent people
  making the same fix is a far stronger signal, and requiring that costs
  nothing.
- **Forks are worth keeping, not discarding.** "I make it differently"
  is a real variation of a real recipe, which is idea #5 arriving from
  the other direction: instead of a model generating plausible variants,
  a corpus of ones people actually cook. Better data than anything
  synthesized, and not copyable without this data model.

**Cheap first version — built, and still there:** the JSON tree editor from
the early prototype, behind an "advanced" affordance. Ugly, but it means
nobody has to abandon a recipe, and it stays until the visual editor below
covers adding, deleting, splitting and merging steps.

### Status: the visual editor's first version is built

An **Edit** toggle on a saved recipe's diagram. It does three things — change
an ingredient's amount, unit, name and note; change a step's label; move an
ingredient from one step to another. Tapping still means *mark done*
everywhere else, and edit mode says so loudly, because that is the core
interaction and it must not quietly change meaning.

**The drop rule is the validator, not a copy of it.** `validMoveTargets` in
`lib/recipe-model/src/edits.ts` builds the candidate tree for every step and runs the real
`validateRecipe` on each, so what lights up during a drag *is* what will be
accepted on drop. A re-derived predicate would have started correct and
drifted the first time `computeLayout` gained a rule.

**Press and hold to pick up**, because the diagram scrolls horizontally and a
plain drag is indistinguishable from a scroll. 350ms, abandoned if the finger
moves more than 10px first. A mouse skips the hold entirely.

**Moving the last input out of a step is refused**, with the reason shown
before anything moves — deleting the emptied step would be a destructive
reading of a drag, and deleting steps is not in this version.

**Edits apply immediately, with 50 levels of undo.** A server rejection rolls
back to the last accepted version and says why.

**Step shape is now editable too**: add, delete, split and merge, as op
types against the same `applyEdit(recipe, op)` signature, in the step sheet
edit mode already opens. Split chains rather than branching (the common
failure is one step describing two sequential actions) and the user assigns
which inputs move; **the first half keeps the step's id, and that is derived
rather than preferred** — giving the second half the id would leave a done
step above an undone input on every split of a completed step, breaking the
closure invariant the whole app rests on. Merge keeps the consumer's id and,
by default, its label, with a one-tap choice of either; joining the two
labels is not offered because `validateRecipe` caps a label at eight words,
so joined labels would routinely be refused.

**Ingredients can be added and deleted, and steps carry their time and
temperature.** `addIngredient` / `deleteIngredient` / `setStepFields` —
`setStepFields` replaced `setStepLabel` so a step's label, `minutes` and
`tempF` go through one op with the partial-bag contract the ingredient sheet
already used: absent means leave alone, present-and-null means clear. That is
not granularity fussiness — a sheet commits on blur, and blurring the label
box must not rewrite the time with whatever was in state.

Add is offered from the **step** sheet ("Add an ingredient here"), because an
ingredient has to attach to a step; delete is at the foot of the **ingredient**
sheet. Neither cascades: deleting a step's only input leaves the step with no
inputs, `validateRecipe` says so, and `deleteIngredientBlocker` turns that
into a sentence naming the step and pointing at "delete the step" instead,
which already splices its inputs into its consumer properly. One tap removing
two things is a destructive reading of "delete".

**A validation error may not move a control.** Found while sweeping this: the
sheet is bottom-anchored and capped at 86svh, so an error box appended at its
foot lifted every button by 19px (SE) / 67px (iPhone 13) below the cap, and
pushed them *down* 56px at the cap where the sheet scrolls instead. Blur fires
on pointerdown and React's onClick on pointerup, so committing an invalid
label by tapping "Add an ingredient here" slid "Split…" under the finger
before it lifted — CLAUDE.md's "nothing may resize under a fingertip", with a
sheet instead of a chip. Errors are now positioned absolutely against their
own field (zero movement, measured identical geometry at rest and in error)
and are `pointer-events: none`, so the tap that surfaced the message still
reaches the control it was aimed at instead of being eaten by it.

**Round three: recipe- and section-level fields, and the name link.**
`setRecipeFields` (title, servings, source, sourceUrl, yieldText),
`setSectionFields` (name, header), `addSection`, `deleteSection` and
`reorderInputs`.

*Where they live.* Recipe fields have no cell to be tapped and the top bar
cannot supply one — `.rfx-bar-title` measures **29×16 on an iPhone SE** and is
already truncated, in a bar carrying back, progress, Edit and the overflow
menu at 320px. They are reached from a "Recipe…" button in the edit bar,
which exists only while editing and already announces the mode; appending an
84px button to it cost **0px of height at both 320 and 390**, because the bar
already wraps. Sections keep the tap-the-thing rule: `.rd-section-head` is a
15px line at rest and becomes a 44px button in edit mode.

*Sections are addressed by index, and that is the editor's one asymmetry.*
Every other op takes an id, deliberately, so no array position has to be kept
in sync with the UI. A `Section` has no id — only a name, which is mutable and
may repeat — and adding one means touching `layout.ts` and migrating every
stored recipe. The index is made safe by closing the sheet on any structural
op, so no index outlives the tree it was read from.

*A new section is three fields, not five.* It cannot be empty
(`validateRecipe` wants a step with an input, and an ingredient wants a qty or
a text fallback), so `addSection` builds the minimum: one ingredient at
`qty: 1`, one step consuming it. The amount defaults rather than being asked
for, because one tap of correction in a known pattern beats a five-field form
as a first impression.

**`brokenComponentLinks` is a fix, not only a guard for the new ops.**
`sequence.ts` links a component section to its consumer by NAME. Nothing else
can see that link: `validateRecipe` runs per section, and both sides stay
internally valid when it breaks. **Renaming an ingredient severs it, and that
has shipped** — so the cookie bug (see #6's history and `sequence.ts`) has
been re-creatable by a user in production, silently, since the ingredient
sheet landed. Section rename and section delete add two more ways in; they are
what brought it to light, not what caused it.

The check diffs the real `componentLinks` over the before and after trees
rather than re-deriving the matching rule — same argument as
`validMoveTargets` running the real `validateRecipe`. It reports `gained`
links too, because a rename that creates a match adds an ordering constraint
and can create a cycle, which `sectionOrder` survives by falling back to the
original order, i.e. quietly. It is a **warning, not a refusal**: breaking the
link is sometimes the intent, and refusing would be a parallel predicate
deciding validity, which is the thing `edits.ts` exists not to do.

*The warning shares the field-error slot* — absolutely positioned,
`pointer-events: none`. In flow it moved "Done" by **122px on an SE**, which
is the same defect fixed in the previous round, and it would have straddled a
tap the same way.

**The JSON hatch can now go, and has not been removed.** Every field in a
stored recipe has a visual path — the audit is under "Closed, kept for the
record" below. The standing rule was that the hatch stays until nothing is
left that it can express and the editor cannot; that gate is met. Actually
removing it is a separate call, because it is the last escape route for a
tree the editor somehow cannot fix, and taking it away is outward-facing.

**Available on the free trial recipe too**, since `PATCH /api/trial/recipe`
landed — see "Still open from earlier work".

---

## 7. An account to save, with one free extraction

**Status:** built. The rule: a visitor gets **one free extraction per
browser** and sees the full diagram, interactive. Saving it — and extracting
anything else — needs an account. The demo is untouched: it writes nothing
and costs nothing.

**The distinction that keeps this honest.** The rule is *no anonymous
library* — many recipes, indefinitely, for a browser that never signed in. It
is **not** *no anonymous persistence*: one recipe, pending signup, is the
mechanism that makes the funnel humane. Someone looking at a diagram of a
recipe they chose is at the best possible moment to be asked for an account
and the worst possible moment to lose their work. The trial row is that one
recipe. It is not a library, and deleting it to satisfy a rule it does not
violate would strand exactly the work the rule exists to protect. The same
paragraph is in `artifacts/api-server/src/lib/trial.ts` and `lib/db/src/schema/schema.ts`, because that is
where someone will be standing when they consider "fixing" it.

**Where the counter lives:** an httpOnly cookie plus a `trials` row. Not
localStorage, which the page can edit; not IP, which punishes flatmates,
offices and cafés — one person on a shared network would spend everyone's
trial. A private window still resets it, and that is accepted: this is a
nudge for someone who would otherwise never sign up, not a paywall. What
matters is that the check is **server-side in the extract route**, so a
modified client still gets a 402.

**The allowance is taken before the work and refunded on failure.** Spending
first is what stops two simultaneous requests both coming back free; refunding
is what stops a dead link costing someone their one try.

**What happens after it is spent:** the paste box stays and still accepts a
URL — it routes to sign-up carrying it, through the pending-URL funnel that
already existed. A visitor who has typed a link is never met with a dead end.

**Per browser, forever.** No reset. A resetting trial teaches people to wait
rather than sign up, and makes "why can't I extract?" depend on a date they
cannot see.

**Retired:** the anonymous library, and the "N recipes saved on this device ·
View them" line.

**Not retired: `claimAnonymousLibrary`.** Existing anonymous rows still need
claiming, and dropping the only path that can claim them would strand real
data. It is marked for removal in `artifacts/api-server/src/lib/claim.ts` and comes out only
after a query confirms zero unclaimed anonymous rows:

```sql
select count(*) from recipes where user_id is null and owner_key not like 'trial:%';
```

**Untouched:** the demo, and the pending-URL funnel, which rides in
`auth_states` rather than the anonymous library.

---

## 8. A real recipe library, and a bottom nav

**Status: built, including ratings.** Bottom nav (Find / My Recipes / Settings, hidden
while a recipe is open — cooking gets the full viewport), the library as a
destination with meal-type filter chips and sorting (recently added,
recently cooked, total time, source, meal type), the eight types inferred at
extraction and carried INSIDE the recipe JSON — which is what hands them to
the next user through the extraction cache and through the trial claim for
free — a two-row Primary/Also edit sheet in the recipe's overflow menu, an
untagged bucket for pre-existing recipes, and observed "cooked it" capture:
a timestamp when `done` reaches the full count, deduped within six hours,
merged across devices by `mergeCooked`. Filter chips render only for types
the library actually contains — a chip that filters to nothing is a dead end.

**Ratings: three states, not five.** 👎 / 👌 / 👍 (-1 / 0 / 1, null unrated),
one standing verdict per recipe rather than one per cook. Coarse on purpose:
repeat cooks already outrank opinion in the hierarchy above, so a five-point
scale would add resolution to the weaker input. It appears on the open recipe
beside the meal-type badge, and **only once the recipe has been cooked at
least once** — asking before that collects an opinion about a web page.
Tapping the current rating clears it.

A 👍 marks the library card; **a 👎 never does.** The rating still sorts and
filters, it just does not decorate — a library that shows your rejects back
at you is a worse library. "Favourites first" is an available sort and
deliberately **not** the default: it looks obviously better and has no data
behind it yet, so `added` stays until real libraries exist to judge against.
The rejects rank last under that sort rather than being hidden, because
unfindable is worse than last.

**The idea:** "My Recipes" as a destination rather than a list under the
paste box — browsable, sortable, filterable, with the app's top-level
sections reachable from a persistent bottom bar.

**Why now:** the current library is a grid of cards below the import box,
which works at three recipes and falls apart at thirty. Someone who cooks
from this weekly accumulates a collection, and a collection wants structure.

**What it needs:**

- **Bottom nav, three tabs: Find** (paste a link, search the web, search
  your own), **My Recipes**, **Settings**. Add and Search started as
  separate tabs and merged — both are "get me a new recipe", and splitting
  them asks the user to know which kind of finding they are doing before
  they start.
- Sorting and filtering by meal type, recently cooked, recently added,
  source, and total time.
- Ratings, which are the interesting one — see below.

**Meal types — the eight:** Breakfast, Lunch, Dinner, Dessert, Snack, Side,
Drink, Baking.

Eight fits a filter row on a phone. Deliberately fewer than the obvious
list: appetizers fold into snacks, soups and salads into mains or sides.
Splitting a category later is easy; merging after people have filtered by it
is not.

**A recipe can carry several types with one primary.** Chili is dinner and
lunch; muffins are breakfast and snack. The primary drives sorting and
display, the rest widen filter matches.

**Inferred at extraction, editable by the user.** The model has already read
the page, so one more field is effectively free, and inference means nobody
faces a tagging chore they will skip. The user can change it — which also
makes a wrong guess cheap rather than permanent. Recipes saved before this
ships need backfilling or an "untagged" bucket.

**Ratings are more than a number.** A rating is the first piece of data that
is genuinely about the cook rather than the recipe, and it feeds several
things already in this file:

- It is the honest signal for #3's "corrections must propagate" — a
  correction from someone who has cooked a recipe three times and rated it
  is worth more than one from someone who opened it once.
- It is the ranking signal for #2's cross-user search. "Recipes people
  actually cooked twice" is a better sort than relevance.
- Combined with the forks from #6, it starts to answer which variation is
  worth suggesting in #5.

Worth capturing **"cooked it" separately from "liked it"** — they are
different facts, and the first is the more reliable one because it is
observed rather than reported. The app already knows when someone works
through a recipe's steps.

---

## Known cosmetic issue, tabled: the edge bars on step completion

**Status: tabled as cosmetic, not active work.** Still present after
`41e9633`, still page-coloured. iOS/WebKit only; never reproduced on desktop
or in this container (no WebKit here).

**Symptom:** completing a step that finishes a branch flashes bars at BOTH
edges of the diagram for ~1s. The bars are the colour of the *page*
background, not the card.

**The discriminator — whoever picks this up should start here:** the frame's
own background is opaque card, so any DOM-level cause (a fading cell, a
momentary width mismatch, a shadow) flashes **card**-coloured. **Page**-
coloured bars mean the frame's own paint was absent, which only the
compositor can produce. Check the bar's colour before theorising.

**Three mechanisms were found. Two were real defects, fixed and kept
regardless; the third is where the bug still lives:**

1. **Sticky-column transform** — misdiagnosis. The bars being symmetric
   killed it (an unpinned sticky column cannot produce a right-edge bar),
   and sticky offsets held at 0 in Chromium, measured with the frame
   actually scrolled. The no-transform-in-the-scroller rule was kept as
   prevention; the transform was never needed.
2. **The entrance fade** (`ad437fd`) — real defect, kept. Re-mounted rows
   faded from opacity 0 for a full second at both edges. Now 450ms, from
   0.35, no transform. Would have flashed **card**-coloured, so it was not
   this bug — but it was a genuine both-edges blank.
3. **Compositor tile blanking** (`41e9633`) — the surviving diagnosis,
   consistent with the colour. The collapse resizes the table (419 → 400
   and back, measured), and the composited scroller shows unpainted tiles
   until it catches up. `-webkit-overflow-scrolling: touch` (the legacy
   opt-in with exactly this documented failure mode) was removed; the bug
   survived that, so the scroller is being composited regardless.

**The untried lever: `translateZ(0)` (or `will-change: transform`) on
`.rd-table`**, forcing the table onto its own persistent layer so its tiles
survive the resize. Untried because it is a blind fix from this container —
Chromium cannot reproduce iOS tiling, so there is no way to measure whether
it works or what it costs (memory, paint) except on a real device. If tried:
one change, one deploy, judge on the phone; the standing sweeps guard the
Chromium side.

Also in the file of record: the collapse yanks `scrollLeft` when the
narrower table cannot contain the old scroll position (41 → 22 in one frame,
measured) — inherent to content shrinking, noted in CLAUDE.md.

**The layout-viewport zoom bug is believed fixed** (`6750779`): the drag
ghost, `position: fixed`, followed the pointer past the right edge
(right=462 on a 390px viewport). A fixed element grows neither scrollWidth
nor a scrollbar in Chromium, which is why every h-scroll sweep called it
clean; Safari zooms the layout viewport to fit it. Now clamped. Every other
state tested clean at 390 and 320; if the zoom recurs outside a drag, there
is a second cause still out there.

---

## Suggested order

OAuth and the visual editor's first version are built, so this is what is
actually left, cheapest and most blocking first.

1. ~~**The storage/sync design pass**~~ **Done** — versioned writes with
   409-and-merge, field-level patches, per-entry write serialization, the
   focus refetch, and an element-wise `done` merge with closure repair.
   Verified with two real browser contexts against a real Postgres: the
   clobber scenario, branch-union, and uncheck-resurrection all pass. See
   `lib/recipe-model/src/sync.ts` and CLAUDE.md's sync section.
2. ~~**The library and bottom nav** (#8)~~ **Done** — see the entry,
   ratings included.
3. ~~**Finish editing** (#6) — steps, then ingredients and timings~~
   **Done for everything at or below the step level.** What is left of #6 is
   recipe- and section-level fields: title, servings, source, section header,
   section names, adding/deleting a section, and the section-as-ingredient
   link. That is what still keeps the JSON hatch alive.
4. ~~**Make the trial row patchable**~~ **Done** — `PATCH
   /api/trial/recipe`.
5. ~~**Public/private decision**~~ **Settled** — libraries private,
   aggregate counts only. See "Visibility — settled" in #3. That splits #3
   into stage one (cached trees in search results, no visibility question at
   all) and stage two (the saved count), which can ship independently.
6. **Corrections replace the cached tree, then URL normalisation** (#3, in
   that order — see the reasoning there).
7. **Cross-user search + cache reuse** (#2 and #3 together) — the same
   feature seen from two sides, and it needs the correction path from step 5
   to be safe.
8. **Apple sign-in** (#1) — BUILT; verifying it from a phone is Phase 4's
   "Sign in with Apple must be live on the deployment — VERIFY".
9. **Variations at the prompt level** (#5, cheap version).
10. **Recipe builder** (#4) — mostly falls out of #6 once editing is complete.
11. **Structural variation comparison** (#5, real version) — needs the corpus
    #3 produces.

---

## 9. A loading state for extraction

**Status:** built. `artifacts/reduction/src/components/ExtractionProgress.tsx`. Before it,
an extraction showed a disabled button and nothing else for however long the
model took, which read as frozen at the exact moment a first-time visitor is
deciding whether the thing works.

Five messages, in order, the last one sticking:

> Reading the recipe / Bringing it to a simmer / Cooking it down /
> Skimming the excess / **Down to the essence**

The arc is a reduction going from raw to concentrated, so it reads as progress
without measuring anything. No percentage and no bar — a bar that stalls at
90% is worse than no bar. All four entry points: paste, link, file, a search
result, and `/reextract`.

**Timed, not real, and the blocker is worth recording.** The pipeline does
know when it moves from fetching to structuring to validating. Reporting that
needs streaming, and the cost is not the plumbing — **the HTTP status is
committed before the body starts.** `/api/recipes/extract` signals four
outcomes through status codes the client depends on: 402 `trial_spent` (which
turns the paste box into the sign-up path), 429, 422 and 500. A streamed
response must send 200 before its first stage event, so all four would move
into the body and every call site would stop reading `err.code`/`err.status` —
four entry points and the whole funnel. A job id plus polling needs a durable
job store, because an in-memory one dies on a restart mid-extraction. If
streaming ever happens for another reason, real stages come nearly free; on
its own it is not worth that.

**What makes timed honest** is that the sequence ENDS rather than looping, and
the last message describes what the app did rather than what it is still
doing. That is also what covers the worst case: `MAX_ATTEMPTS = 2` means a
tree failing `validateRecipe` is sent back to be repaired, roughly doubling
the wait, and a sequence that ran out or restarted would pick exactly that
moment to look broken.

**`STAGE_MS` is a placeholder at 3000ms** and is deliberately one named
constant. It was set before `extraction_events` had a single production row,
and raised from 2200 after watching it run — 2.2s read rushed, which is the
only evidence there is so far and is not the kind `ms` will supply.
Retune it from the real distribution — the query is in the file, and the aim
is for the last stage to land near p50 so a typical wait shows the whole arc
and a slow one rests on the final message. Getting it wrong is bounded: too
fast shows all five early and holds, too slow shows two or three. Neither is
broken.

Reserved height on the line, so a message change cannot move anything —
measured stable at 40px across all five messages at 320, 390 and 393. Under
`prefers-reduced-motion` the dots and the search spinner are hidden entirely
and the text change carries the whole signal.

---

## Find: three tabs, and the in-app browser as one of them (Sep 28)

**Built on the phone, Sep 28 — over the air on 1.1.0, plus one server
route.** Find is three folder tabs: **My Recipes / Add New / Browse**. The
scope was the owner's (Sep 28), replacing Phase 3 as first proposed.

- **The tabs.** The Recipe Box book tab's shape, the app's control type,
  44pt tall; on an iPhone SE the three are 277pt of the 288pt its gutters
  leave (measured). Find has no navigator header any more and pays the top
  inset itself, the same on both tab layouts. **Opens on Add New** when the
  app starts; coming back to Find keeps the tab and each pane's state for
  the session (all three stay mounted); nothing is remembered once the app
  closes. Hand-offs win: the Recipe Box's miss opens My Recipes with the
  query, a blocked link and "Browse tab" open Browse on the page.
- **My Recipes** is the Recipe Box's own search (`searchBox` and its result
  row, shared, so the two cannot drift); a tap opens the recipe where the
  box opens a book. The box keeps its own field — two ways into one search,
  deliberately. With no match, **at most two suggestions from the shared
  cache** under "Not in your library. Suggestions from recipes other
  people have saved." — `POST /api/recipes/suggestions`, the cached half of
  search alone: URL extractions only, public-looking addresses only, never
  a paste, photo or browser-read page, usage line only above its floors, a
  page already in the box left out. Signed in only, **not walled** (it
  costs nothing), its own throttle. Opening one is an ordinary link
  extraction — a cache hit — and is walled where it always was: a walled
  account sees the wall and sends nothing.
- **"Search the web" (the model-powered search) is retired from the
  phone's interface.** Browse's address bar searches instead, which costs
  us nothing. `POST /api/recipes/search`, the client's `searchRecipes` and
  `components/SearchBar.tsx` stay; the website still uses the route. **After
  this, the usage line ("Saved by N people…") appears on the phone ONLY on
  My Recipes' suggestions.** (The website's search still shows it.)
- **Add New** is the old Find screen moved: one extraction path, the
  progress line, the 180s wait, the photo errors, the wall in place of the
  controls. New: **Title and From (optional)** under a pasted recipe and
  under a picked photo (not a link), applied on the phone to whatever the
  extraction returns — so a typed title wins on a cache hit too — and never
  sent; and the "Some websites don't work with link extraction…" line, a
  44pt target to Browse that carries a pasted link.
- **Browse.** Address bar (web address or search words; the engine is one
  constant, `SEARCH_ENGINE` in `lib/browseAddress.ts`, **DuckDuckGo** by
  decision — Google is a one-line change, plus privacy.html, which names
  it), reload, a way back to the start screen, back/forward, Open in
  Safari, Extract. Before typing: a line on how it works and **a fixed row
  of six recipe sites — no recent-sites list** (it would be history kept on
  the phone and a policy line; not asked for). **Private, nothing kept once
  the app closes**, as decided for Phase 2; the policy's site-data sentence
  unchanged. **"No recipe found on this page"** before anything is spent
  (`looksLikeRecipe`: recipe JSON-LD anywhere, microdata, a recipe-card
  plugin's container, or an Ingredients heading with three amount-first
  items), with **"Try anyway"** under it. **The wall comes first** for
  Extract and Try anyway — the same `allowed && enforced` from the same
  `entitlementFor` the server's `checkAccess` decides with; the 402 stays
  the backstop. An app without the webview module says Browse needs the
  latest version rather than crashing (`loadPageView.ts`).
- **Titles.** One rule (recipe-model `title.ts`): trimmed, whitespace runs
  collapsed, never empty, **100 characters at most** (From: 80). Rename in
  the ⋮ menu after Edit recipe; the preview's title in its "not saved"
  banner (a blank one asks before Save); the editor's Title field. A rename
  is the editor's own op through the sync engine, so it queues offline, and
  touches only the account's row — never the cache or search (verified by
  reading the paths: a save only reads the cache). **The 100-character cap
  is the phone's, not the server's**: `validateRecipe` still accepts any
  non-empty title, so the website can save longer. **Not in the Recipe Box
  preview sheet**, by decision: a glance-and-go screen, and two ways in are
  enough.

**Only a real iPhone can check:** WKWebView itself — the recipe check on
real sites, back/forward and the edge swipe, Open in Safari, the address
bar's keyboard; memory with a page kept alive in a background tab; the iOS
26 native tab layout (no header — the tabs pay the inset themselves); the
tabs under a thumb. Chromium's preview can only frame pages from its own
origin, so Browse was driven there against local recipe and no-recipe
pages; DuckDuckGo loads in the frame only as far as the address.

**The website has none of this (web parity, logged):** no Find tabs (its
header search is unchanged: the library, then the web, with the usage
line), no Title/From on a paste or photo, no Rename in a menu (its
editor's recipe fields do rename, without the 100-character cap), no
preview-title row, no suggestions route caller. **A Browse tab cannot
exist on the website**: recipe sites refuse to be framed, and a framed
page from another origin cannot be read — the web's answer would be a
bookmarklet (Paprika's way), a separate decision.

## Recipe books the person owns (Sep 29)

**Built, Sep 29 — two hand-run tables, a server Publish, and the phone over
the air on 1.1.0.** The Recipe Box's seven meal-type books became books the
person owns. The decisions, all confirmed before building:

- **One book per recipe**, as before (page numbers and the flip depend on
  it). Meal types stay the extraction's guess and a search tag; the Meal
  types sheet and filter chips are unchanged. Once a recipe has a book,
  editing its meal types does not move it.
- **Existing accounts get today's seven, once.** `GET /api/books` inserts
  the account's row with `ON CONFLICT (user_id) DO NOTHING` — five devices
  loading at once make one row (tested) — and only the request that
  inserted it places the existing recipes, removed ones too, by meal type.
  Same ids, names and colours: nothing looks different until someone
  customises.
- **Other is permanent**: renamed and recoloured, never deleted.
- **Deleting is merging**: a book with recipes asks first where they go
  (another book, a new book made there and then, or Other), and the book
  they go into can be renamed in the same step; an empty book goes at
  once. **No recipe row is rewritten**: the deleted book stays in the list
  as a tombstone that says where its recipes went, and every reader
  resolves through it (recipe-model `resolveBookId`) to a live book or
  Other — so no merge, on any number of devices, can lose a recipe.
- **Restoring a removed recipe** puts it in its book; if that book was
  deleted, where its recipes were sent; Other only when the deleted book
  had no destination (it was empty). Decided Sep 29.
- **Empty books**: a default hides while empty (as the seven always did); a
  book the person made stays on its "Room for one more" page.
- **Names** 1–30 characters, trimmed, unique ignoring case (the title
  rule's own tidy). **Twelve colours**, each with white tab text at 4.5:1 or
  better and visible on both page backgrounds (computed in the test); the
  defaults keep theirs; a new book takes the next unused one.
- **Reordering** by up/down buttons, no dragging. **Long-press on a book
  tab: not built**, by agreement (a 22pt tab that is not a control, on a
  surface that already sorts taps from swipes).
- **Choosing a book when saving**: every path that saves a recipe ends in
  the unsaved preview, whose Save bar is `[book ▾] [Save to Library]`,
  defaulting to where the meal-type guess points (through any merge, else
  Other). One tap on Save is the common case; the chip opens "Save to…"
  with "Create a new book". **Moving later**: ⋮ › "Move to another book",
  a sheet titled "Move to…", the toast "Moved to Soups."
- **Sync**: a recipe's book is a versioned entry field — last change wins
  on a 409. The list is one versioned document with its own queue on the
  same rules (lib/booksQueue.ts). **Delete and merge need a connection**:
  offline they change nothing and say "Connect to the internet to delete
  or merge books." (tested). Add, rename, recolour and reorder wait out an
  offline spell like any edit.
- **A recipe's book is the account's own**: it never reaches the
  extraction cache or anything another account can read.
- **Degrades**: without the tables the phone shows today's seven, Save
  saves without a book, Manage books says books are not available yet
  (verified by renaming both tables under a running server).

**The cap of 12 is a guess, measured in Chromium and still the phone's to
judge.** At 12 books the dot rail is 163pt wide and clears the page buttons
on every profile (an SE leaves 19pt either side); a swipe goes through all
twelve and back round to the first; nothing scrolls sideways. How the
carousel and dots FEEL at 12 — whether finding a book is quick enough, and
whether 12 dots read as a count — is for the owner's phone; the cap may
come down (`MAX_BOOKS` in recipe-model books.ts, one line, and the server
keeps accepting what a merge of two devices produced).

**The website has no books, and that is logged, not fixed.** It never had
the Recipe Box's books; its library is a grid with meal-type chips, and
that is unchanged. It ignores the entry's `book`, cannot see or manage
books, and a recipe it saves has no placement — so the phone shows it where
its meal type points (through any merge) until it is moved. Nothing on the
website can clear a book: it never sends the field.

## The new icon and splash (Sep 29)

The artwork is final and lives in `brand/` (CLAUDE.md "The brand
artwork"); `scripts/brand-icons.mjs` makes every size either side ships.
Replit's agent applied it to the phone first (940a2f9, icon and splash
correct, the Android foreground uncropped by the safe zone, nothing on the
website); this finishes it. Decided:

- **(Superseded the same day: the splash is now plain; see "The opening
  sequence".) The splash is the mark on the ICON's cream, `#efe2c8`, 240pt wide**
  (was the app's tan `#e8d5b2` at 200). The icon zooms into the splash on
  launch, so matching the icon's colour makes that one continuous surface;
  the parchment of the first screen is a shade darker and follows a moment
  later. 240pt spans about half an SE's width (the drawing is ~70% of its
  square) and was small at 200 on a 390pt phone. **Dark mode keeps
  `#131110`**, the app's dark background until Cocoa (Oct 1; the page is
  now `#211a16`, see "Dark mode: Cocoa"): the cream bars and the bottle's
  label sit on the red pot and the orange bottle, never on the background,
  so they stay visible and no dark variant of the artwork is needed.
- **`expo.version` stays 1.1.0.** The rule bumps it for native code a
  bundle might call; an icon and a splash are native but nothing calls
  them, so a bundle is equally safe on a binary with either icon. 1.1.0 has
  not reached the App Store, so the new build is another 1.1.0 build (EAS
  numbers builds remotely).
- **The Android adaptive foreground is the mark at 636/1024, centred**, so
  nothing leaves the 66dp safe circle (measured: 311px from centre against
  a 313px radius), over `#efe2c8`. There is no Android build yet; no
  monochrome (themed) icon and no notification icon either — both are
  Android-only, and the notification one wants a white silhouette, which
  is a new drawing and not a resize.
- **The sign-in screen's mark is an image of the artwork at the same
  64pt.** It reads smaller than the old mark, which filled its square; a
  larger one waits on the item below.
- **Logged, not fixed: on an iPhone SE the sign-in screen's top is cut
  off** — its content is centred and taller than the screen, so the mark
  sits at y=−12 (Chromium, 320×568). It was already so with the old mark,
  at the same size; the fix is a scroll view on the sign-in screen, which
  is auth UI and was out of scope.

**The website (its own commit, a Publish):** the favicon (SVG and a 32px
PNG), the 180px `apple-touch-icon`, the manifest's 192 and 512 and the web
push notification's icon and badge are all the new icon, from the same
script; the nav's mark on the landing page and the signed-in app is
`reduction-mark.svg`, at the same 44px. The favicon is the ICON, cream
square and all, like the app's; the manifest declares no `maskable` icon,
because the artwork reaches the edge of the 40% circle a maskable icon
promises to keep — a maskable one would be the mark scaled down on the
cream, the Android treatment above, when Android Chrome install is taken
up. `theme-color` and the manifest's colours moved from `#F0E2C8` to the
icon's `#efe2c8` (one unit apart). Removed: the old mark's transparent,
dark and inverted SVGs and its 64px PNG, and `public/favicon.svg`,
Replit's orange placeholder, which nothing referenced. Not changed: the
legal pages call the product "Recipe Reduction" in their header where
both apps say "Reduction"; there is no social preview (`og:image`) image
anywhere, and none was added; the push BADGE is the full-colour 32px icon,
where Android draws a badge as a white silhouette (it will show as a
white square there — a silhouette is a new drawing).

**Needs the phone:** the icon on the home screen, in Spotlight, in Settings
and in TestFlight; the splash in light and dark; whether the icon-to-splash
hand-off reads as one surface.

## The opening sequence (Sep 29)

**Built from `docs/prototypes/opening-sequence.html`** (the approved design,
v4): spice and vinegar pour into a bubbling pot, the camera rises to look
into it, dives through the surface, and a bubble pops to reveal the app.
The code is `lib/opening/` (pure, tested) and `components/opening/`; the
artwork is `brand/`'s, as data (`brandShapes.ts`, checked against both brand
SVGs by a test). The particles come from the prototype's own generator and
seed, and a test runs the prototype's script and matches every one.

**When it plays — decided by the owner, implemented exactly:**

- **Full (4.3 s) once**, on the first launch after install; never again,
  updates included. **Quick (2.2 s)** on a COLD start only (a new JS
  process; a return from the background is the same process and never
  plays it), at most once per **24 hours of elapsed time** since either
  version last started. A stored time in the future (the clock moved
  back) counts as elapsed. Never both in one launch; Full stamps the time.
- **Skipped** after a notification tap, a link (the app's scheme with a
  path; there are no universal links yet) or a share (no share extension
  exists yet; the rule is in place for it), and when VoiceOver is running.
- **Reduce Motion** plays the still artwork for 0.5 s and a 0.4 s crossfade
  instead, and counts as the version it replaced.
- **Nothing is decided in the background.** The decision waits until the
  app is active; the stamps are written only when the sequence is on
  screen and its clock has started. A tap anywhere skips (150 ms fade),
  and a skip counts as shown.
- `OPENING_ENABLED` in `lib/opening/config.ts` turns it off for every
  launch, over the air. Settings > Replay intro plays it over Settings
  and changes no stamps.

**Where a cold start lands — on EVERY cold start, not only sequence ones
(decided Sep 29):** signed out, the demo; signed in, the Recipe Box on the
book last open on this device (stored by book ID, the first book when that
one is gone); signed in with nothing saved, the "Nothing saved yet"
invitation. Never the paywall. Never over a notification tap or a link,
never on a return from the background. `LAND_ON_RECIPE_BOX` reverts it to
Find.

**It never delays the app.** The app boots underneath as normal. The native
splash stays up only until the launch is decided (capped at 400 ms once the
app is active). If the app is not ready when the reveal comes due, the
sequence holds on the dark bubbling frame for up to 1.5 s, then reveals
whatever the app is showing. Before sign-in state is known, that is the
page colour with a spinner that appears only after 300 ms, so a quick launch
never flashes one. Measured in Chromium, with every API answer held back 6 s:
the reveal waited 1.5 s and showed the spinner, never a blank screen.

**The testing sheet** is a long press on "Replay intro", for the owner's
account only. The allowlist holds a SHA-256 of the email, not the address;
an account id can be added. It is a convenience, not a security control. It
plays any version, resets either stamp, shows them, and shows the last
run's frame rate: average, worst frame, and frames under 55 fps.

**The timings were tuned by eye in a browser; re-tune them on the phone.**
They are the F and Q objects, verbatim, in `config.ts`. The owner's call
after watching it on the device.

**Kill criterion: 55 fps or better on the owner's iPhone.** The testing
sheet reads it out after any run. If it falls short, cut in this order and
report before anything else: the bubble counts (`BUBBLES`, 26 large + 18
small, cut from the end so the same bubbles remain), then `FADE_LEVELS` (6;
each level is one drawn path for the ripples and one for the bubbles), and
only then consider a pre-rendered animation. About 35 SVG nodes change per
frame, all as path strings, opacities or widths computed on the UI thread;
the shaker and the bottle are separate layers moved by the GPU.

**The one thing only the phone can prove about the drawing: the reveal is
an animated `ClipPath`** (the scene clipped to outside a growing circle,
so the live app shows through). Chromium draws it; react-native-svg on iOS
re-resolving an animated clip each frame has not been seen here. If the
hole does not open on the phone, that is where to look.

**Not built (idea only): land on a recipe that was mid-cook.** Nothing
stored says "mid-cook". An entry has `done`, `timer` and `savedAt`, but no
last-opened time, and nothing records the open screen. A running `timer` is a
strong signal; a partial `done` is weak, since it can sit for days. The
proposal: record the last recipe screen and when it was left (device-only,
one write), and land there if a timer is running, or if it was the open
screen within 3 hours and has partial progress. About a day with tests;
the risk is landing somewhere unexpected.

**The splash is plain (decided Sep 29, reversing the icon's hand-off).**
The sequence starts on empty cream and the pot fades in, and Apple's
guidance is not to brand a launch screen. So the native splash is plain
`#efe2c8` in light mode and plain `#131110` in dark mode. It is dark in dark
mode, not the owner's first lean of cream in both, because the splash shows
on EVERY launch and the sequence on at most one a day: a cream splash would
flash every dark launch to save one fade a day. On a dark-mode launch that
plays the sequence, it opens on `#131110` and fades to cream over 250 ms.
Light mode's cream splash hands over to the app's tan (`#e8d5b2`), a
one-shade step. It is a plain splash by way of a TRANSPARENT image
(`splash-blank.png`, from `scripts/brand-icons.mjs`), not the plugin's
no-image option. In expo-splash-screen 57, that option leaves the iOS launch
screen on the system background (white, or black in dark mode), keeps
constraints naming a view it removed, and leaves Android's theme naming a
drawable it no longer writes. All three were seen in a local prebuild.

**Needs the phone:**

- The frame rate.
- The splash-to-sequence hand-off, in light and dark.
- Reduce Motion.
- The VoiceOver skip, and the notification and link skips (unit-tested only;
  the web build has neither).
- The reveal's clip on iOS.
- How the cadence feels over a day.

## Clear progress returns Step-by-Step to the first card (Sep 29)

**Decided and built (phone, over the air).** Confirming "Clear progress" on
the phone now puts an on-screen Step-by-Step back on its very first card:
the "Before you start" preheat card comes back when the recipe has one, the
view scrolls to the top, and anything that screen remembered is dropped
(the way back to a timer, a "Time's up", unfolded source text). Clear still
writes only `done: []` and `timer: null` through the normal PATCH, so the
cooked history and the rating stay, and the server cancels the timer's
pending notification as before. Cancel changes nothing.

**Where the current card lives: nowhere persistent**, so nothing else
needed resetting. Step-by-Step keeps its position in memory and, whenever
it mounts, starts at the first card not done. A reload or another device
therefore follows the cleared `done` to the first card by itself
(`lib/cookReset.ts`, tested).

**Gap, logged, not fixed: the website.** Its Step-by-Step
(`artifacts/reduction/src/components/StepsMode.tsx`) is separate code with
the same in-memory index, so a Clear there leaves the open card where it
was until the view is left and reopened.

## The guided demo: one instruction at a time (Sep 29)

**Decided and built (phone, over the air).** The demo teaches with a card
under the recipe that says one thing at a time, rings the thing to tap and
dims the rest, and moves on when the demo's REAL state changes the way it
asked. It replaces the coach line and the two small tips, which relied on
small text nobody read. It does not start by itself: the card first offers
"Start the demo" and "Watch instead", and until then the recipe is free to
explore. The same screen serves the signed-out landing, Settings › How it
works and the empty library's "See how it works". It never saves and
never calls the server (CLAUDE.md, "Demo state never persists").

**The six steps, current wording** (tweak in `lib/demoGuide.ts`; each is a
test away from being checked against the word budget):

1. Read — "Read left to right: ingredients feed steps, and steps feed
   later steps." · Next
2. Do — "Tap the ripe avocados to check them off." (the avocados are
   ringed; Oct 1, from a clean start — it was "Tap an ingredient", lime)
3. Do — "Amber means ready. Tap halve and scoop." (Oct 1; it was "Amber
   means ready: everything it needs is done. Tap an amber step.")
4. Do — "Tap the last step. It checks off everything before it." (rest
   10 min, in the finish strip under the table; the page scrolls to it)
5. Do — "Checks cleared. Switch to Step-by-Step, then tap Next Step."
   (the tab is ringed, then Next Step)
6. Finish — "That's it. Add your own recipe." · Find a recipe (signed in)
   or Sign in (signed out) · Replay

Nudge for a tap the step did not ask for: "Tap the highlighted one to go
on." Idle card: "New here? Learn to read a recipe in six short steps."

**Decisions made while building it, and why:**

- **Step 1 was adapted.** The brief's "each column is a step" is not true
  of this diagram (a step's column is set by what it waits for, and the
  last two steps leave the table for the finish strip), so it says how to
  read the arrows instead.
- **Step 5 clears the checks first, and says so.** Step 4 checks
  everything, which would leave Step-by-Step nothing to show; clearing
  silently would look like a bug.
- **A step makes true what it needs.** Entering a step fixes the state it
  depends on (an ingredient left, something amber, the last step not done),
  and a wrong tap that uses that up is kept for a beat, nudged, and then
  put back where the step began. Explored over every state four taps can
  reach (`demoGuide.test.ts`).
- **Back restores the previous step's STARTING snapshot**, not the state
  it was left in; Back from step 1 leaves the guide.
- **Show me appears after 6 seconds idle on a do-step and performs the
  step with the same taps a finger makes**, judged by the same rule, so it
  cannot advance by a route a person could not take. On step 5 it switches
  the tab and marks the first card done from outside Step-by-Step, so the
  card shows as ticked rather than turning; the guide has already moved to
  "That's it" by then.
- **Watch instead was the old autoplay** (narration in the card) until
  Oct 1; it is now the guide played by itself with a visible pointer — see
  "Demo polish", item 2.
- **The ring is drawn by the target** (a solid 3pt ring and a halo that
  breathes, opacity only; static under Reduce Motion), and the target
  scrolls itself into view. See CLAUDE.md, "The demo teaches through a
  wrapper" — the renderers take a `spotlight` of ids and nothing else.
- **The card holds its size**: a line for the nudge whether or not it
  shows, and (since Oct 1, "Demo polish" item 3) an instruction box as tall
  as the longest instruction, so nothing moves under a finger. Every
  button 44pt.
- **The old Reset button is gone**: Replay on the last step and Back cover
  it, and every reachable state is one Back or Replay from the start.

**Phone-only, not provable in Chromium:** VoiceOver reading the card and
announcing each step (`announceForAccessibility`; RN-web has no
announcement API), a double-tap completing each do-step, the halo's
breathing and its stillness under the OS's Reduce Motion (Chromium's
emulated `prefers-reduced-motion` was checked), Dynamic Type at the largest
sizes on an SE, and the native tab layout (iOS 26, no header) above it.

**Gap, logged, not fixed: the website's demo** (`artifacts/reduction/src/
components/DemoCoach.tsx` on the landing page) still teaches with the
coach line and tips. Porting the guide means the web Diagram, StepsMode and
finish strip taking the same `spotlight` and scrolling their own targets;
`lib/demoGuide.ts` is pure and would move to `lib/recipe-model` for both.

## Demo polish (Oct 1)

Four items, phone only, one commit each.

**1. The demo starts with nothing checked** (owner's call: "like a real
recipe"). `DEMO_PRECHECKED` is now empty, and every way in or back to the
start — Start, Replay, Back to step 1, Back out of the guide, Watch
instead, and all three entry points (the signed-out landing, Settings ›
How it works, the empty library's "See how it works") — begins from it,
because they all reset to that one constant. Re-derived from the graph:
on a clean start NOTHING is amber; checking the ripe avocados alone makes
"halve and scoop" the one amber step (no other single ingredient readies
anything; `demoGuide.test.ts` checks each). So step 2 rings the avocados
and step 3 rings halve and scoop, both by name. The guide finds them from
the graph (`starter`: the first step fed by ingredients alone, with the
fewest), not from hard-coded ids, and a test checks the words name them.
Steps 4 to 6 are unchanged.

- Step 2 advances only on the avocados (another ingredient is kept and
  nudged, the avocados still ringed); tapping halve and scoop itself
  checks the avocados WITH the step, which is not what was asked, so it
  is put back. Step 3 advances only on halve and scoop, even when combine
  is amber too (all four vegetables checked).
- A step makes true what it needs: step 3 entered without the avocados
  checks them (keeping any other ingredients); step 2 entered with them
  takes them back and every step.
- Tests: the wrong taps from a clean start (another ingredient first, a
  step that is not ready, halve and scoop on step 2, the last step early),
  Back from every step to that step's starting state (steps 1 and 2 clean,
  step 3 the avocados alone), and, over every state four taps reach, every
  do-step has a target AND Show me completes it.
- **"Amber"** is the word the guide and the web use for the ready state;
  the ready fill is the terracotta warm tint (red in the 5-minute check's
  wording). Left as it is; the owner may prefer "red".

**2. "Watch instead": the guide, played by itself, with a pointer.** It
replaces the narrated autoplay (and its six sentences): watching is the
same six steps, each step's instruction on screen for the whole step, and
the taps are the guide's own Show me actions, so it can only do what a
finger could. `lib/demoWatch.ts` (pure, tested) turns a step into beats —
wait, point, tap, advance — and `DemoScreen` only runs them on timers.

- **The pace is `WATCH_PACE` at the top of `lib/demoWatch.ts`**: 1.5s with
  the instruction alone, then per action a 1s pause, a 1.3s glide and a
  0.7s tap (about 2s an action), 1s to see the result, 4s on step 1. The
  whole tour is 29s in Chromium, iPhone 13 (measured: avocados checked at
  8.5s, halve and scoop at 14.0s, everything at 19.6s, Next Step at 28.0s,
  the final card at 29.0s).
- **The pointer is drawn INSIDE its target**, exactly as the ring is: the
  spotlight gained `pointer: { id, phase, seq, still }` (an id, never a
  position), and the four ring renderers — a diagram cell (both copies in
  the pinned column), a finish-strip step, the Step-by-Step tab, Next
  Step — draw `components/demo/TapPointer.tsx` in themselves. So it
  scrolls with the diagram and the reveal with no measuring. A global
  overlay was not used: it would have to re-measure on every scroll,
  including the reveal's own animated scroll. The hand (react-native-svg,
  already a dependency) glides 18pt in from the upper left so it never
  spills into a later cell, which would draw over it; the ring is sized to
  the cell. The state changes only when the tap's ring has finished.
- **Controls: Back, Pause/Resume, Next**, and "Try it yourself" (the guide,
  at the same step, as it began). Pause holds everything, pointer included;
  Resume replays the interrupted beat. A tap of your own during the tour
  takes over: the guide, at that step, judging the tap like any other. It
  always starts from the clean start and ends on the final card; Replay
  there is the clean start.
- **Reduce Motion: no gliding.** The hand is on the target from its first
  frame (measured: no movement), the ring is drawn still, and every hold is
  longer (`WATCH_PACE_REDUCED`; the tour is 42.5s).
- **VoiceOver: each step is announced as it happens (the card's step
  announcement, and "Tapping ripe avocados." at each tap), the step is
  performed, and the tour does not move on by itself** — the beats carry no
  advance, and the card says "Each step plays, then waits for Next."
  (`useA11yFlags`). RN-web's `isScreenReaderEnabled` answers TRUE in every
  browser, so the web does not ask (it made Chromium wait for Next).

**3. The instruction is set like a Step-by-Step heading.** The heading
face, bold, 22pt (the card heading is 26pt; 22 is what keeps the longest
instruction to three lines on an SE), Dynamic Type to 1.5x, under a green
"Demo" label (the cool "done" tint) and "Step 2 of 6". The instruction's box
is as tall as the longest of the six would be at this width and text size,
measured from an unseen copy of each, so the card is one height on every
step and a new step never moves a button.

| measured (Chromium) | card before | card after | diagram room before | after |
|---|---|---|---|---|
| iPhone SE, landing | 177pt | 212pt | 245pt | 210pt |
| iPhone SE, Settings › How it works | 177pt | 212pt | 229pt | 194pt |
| iPhone 13, landing | 177pt | 212pt | 341pt | 306pt |
| Pixel 5, landing | 177pt | 185pt | 404pt | 396pt |

"Diagram room" is the recipe scroller between the mode tabs and the card.
Lines per step on an SE: 3, 2, 2, 2, 3, 2. No sideways scroll on any
profile, light or dark; every button 44pt. **Nothing was removed:** the line
"Guacamole, as a diagram. Tap any ingredient to check it off." is the
website's (`artifacts/reduction/src/components/DemoCoach.tsx`) and was
never on the phone. The legend under the diagram (not yet / do this now /
done) stays: it is the only place the green "done" state is named. The
pre-start line goes with item 4.

**4. A welcome card opens every run.** The owner's wording, verbatim
(`WELCOME` in `GuideCard.tsx`; change it only with the owner): "Welcome to
Reduction." / the body / "Take a one-minute tour with a real recipe." /
[Start the tour] [Skip], with "Watch instead" as a link below. It replaces
the pre-start card ("New here? Learn to read a recipe in six short
steps."), and it opens every run in all three entry points: the signed-out
landing, Settings › How it works and the empty library's "See how it
works" — and again after Replay, or Back out of step 1, since each is a new
run from the clean start.

- **What Skip does:** on the landing, the welcome closes and the recipe is
  free to explore, with a slim bar (Take the tour, Watch instead) because
  the landing has no other way back to the tour. From Settings or the
  library the card simply closes: the recipe is free to explore, the
  header's back button leaves, and opening the demo again shows the welcome.
- **Size:** title 26pt bold in the heading face, body 17pt, Dynamic Type to
  1.5x; the words (never the buttons) scroll if Dynamic Type outgrows the
  phone. Measured: 330pt tall on an iPhone 13 and a Pixel 5, 378pt on an SE
  (top at y=190 of 568), with no scrolling, no sideways scroll, every button
  44pt, in light and dark. VoiceOver order: the heading, the body, the
  invitation, Start the tour, Skip, Watch instead.
- **"One minute" holds.** Timed in Chromium on an iPhone 13 with real taps,
  each instruction read at 3.5 words a second and 0.8s per tap: the tour is
  21.6s from Start to the final card, 37.5s with the welcome card read
  first; at a slow 2.5 words a second and 1.5s per tap, 31.1s and 53.5s.
  Watching it is 29.0s. No request reached the server during either.

**Gap, logged, not fixed: the website's landing demo still starts with the
avocados checked.** It keeps its own fixture (`artifacts/reduction/src/
data/demo.ts`, `DEMO_PRECHECKED = ["avocados"]`); the phone's
`data/demoRecipe.ts` is a port, not a shared file, so this change does
nothing there. Making it match is a one-line change to that constant plus
re-checking the web coach's lines against it (its opening line is
"Guacamole, as a diagram. Tap any ingredient to check it off.").

## Renaming a recipe: where it is, and a better way in (Sep 29, built)

**All three ways in work** (checked on main in Chromium at iPhone 13,
Pixel 5 and iPhone SE, against the local stack): the saved recipe's ⋮ menu
→ Rename (second item, after Edit recipe; one Window, blank refused in
place, a messy title saved tidied, and offline it waits in the queue and
lands when the network returns); the unsaved preview's title row with its
pencil and "Rename" (44pt, 52pt on an SE where the title wraps; Save
carries the new title); and the editor's Title field (⋮ → Edit recipe →
Recipe… → Title, same rule, blank refused in the field's own slot).

**Discoverability, honestly: the preview's is good, the saved recipe's is
not.** The preview shows the title with a pencil and the word Rename, where
the eye already is. On a saved recipe the title sits in the navigation bar
and does nothing when tapped; Rename is behind ⋮, which reads as "more
options", and the editor's field is three taps deep behind a mode that
changes what tapping means. Someone who wants to fix a title will tap the
title first, and nothing happens.

**Proposal: tap the title on the recipe screen to rename it.** The header
title becomes a button (a `headerTitle` component on the recipe route,
not a change to RecipeScreen) with a small pencil after the text, opening
the SAME TitleWindow the ⋮ item opens — one window, one rule, one write
path. It must be 44pt tall, truncate on one line before the pencil so the
pencil never wraps off, and say "Rename" to VoiceOver. ⋮ → Rename stays,
for anyone who looks there. Risks: an accidental tap costs one Cancel; on
iOS 26 the title is centred and the target is the text's width, which for
a short title may be small (pad it to at least 120pt). No server or model
change; an OTA. Not added to the Recipe Box preview sheet, as asked.

**Built (Sep 29, over the air).** The saved recipe's header title is a
button (`components/recipe/TitleButton.tsx`, the route's `headerTitle`)
with a pencil after the text, opening the same TitleWindow as ⋮ › Rename;
⋮ › Rename and the editor's Title field stay. One line, truncated before
the pencil; 44pt tall and at least 120pt wide; VoiceOver reads a button
"Rename recipe" with the title as its value. Its ceiling follows the
platform's title alignment (`lib/headerTitle.ts`, tested): iOS centres the
title, so it leaves 92pt free on BOTH sides (206pt on a 390pt phone, 136pt
on an SE); Android and the web lead with it, so it runs from the back arrow
to ⋮. Chromium can only exercise the leading case (measured with a 130-
character title beside a real back button: never over the arrow or ⋮, 44pt
tall, no sideways scroll, at all three sizes, light and dark); the centred
iOS layout, VoiceOver and the native header's own sizing of a custom title
are the phone's to confirm.

## Launch readiness (Sep 30)

### 1. Send feedback — built (phone, over the air)

Settings › Send feedback (under Replay intro) opens an email to the legal
pages' contact, `sean@recruitthebench.com`, subject "Reduction feedback",
with three blank lines for the message and then: app version and build,
runtime version, the over-the-air update id (or "none (built-in)"), the iOS
version and the device MODEL. Never the account id, an email address or the
device's NAME (`Device.deviceName` is "Sean's iPhone"; `modelName` is
"iPhone 15"). `lib/feedback.ts` builds it and is tested.

`Linking.openURL` in a try and never `canOpenURL`: for `mailto:` canOpenURL
needs `LSApplicationQueriesSchemes` in the Info.plist, a native change. When
opening throws (no mail app), the address is copied and a toast says so.
When Mail is installed but has no account, iOS itself shows "No Mail
Accounts" and openURL has already succeeded — nothing in the app can see
that case, so the fallback cannot help there.

**Support URL: `/support.html`** (approved and added Sep 30), in the same
static style as the legal pages: the contact address and a pointer to Send
feedback. Privacy and terms link to it. It is linked by FILE name, like the
other two, so it needs no rewrite on Replit's static hosting. App Store
Connect's Support URL = `https://recipereduction.com/support.html`.

### 2. Cost visibility — built (server Publish, after the SQL)

`extraction_events` now records, for every fresh extraction, the signed-in
account (nullable), the prompt and output tokens, and an ESTIMATED cost
(`lib/extractionCost.ts`: $2 in, $10 out, cache write $2.50, cache read
$0.20 per million, for `claude-sonnet-5`, with a test that fails if either
call site's model changes without these). Cache hits record 0; a failed
attempt records what it spent. The eval report now reads the same prices.

Decisions:

- **No new route column.** The `source` column already is the route
  (`url`/`text`/`file`/`page`/`reextract`); a second column saying the same
  thing would only drift.
- **Tokens as well as the cost**, so a price change can be re-costed from
  history rather than being frozen into it. `input_tokens` counts cached
  and uncached prompt tokens together; the cost prices them separately.
- **An unknown cost is null, not zero**: a fresh attempt that failed
  before any model call answered. `unpriced` in the report counts them.
- **The user id is new, and it took a decision** (the table's comment had
  ruled it out). Nulled when the account is deleted; read only by the
  admin route; never joined to an email.
- **Code before SQL is safe**: the writer falls back to the old columns
  (measured against a database without them), the route answers 503, and
  `/api/health` names the four columns.
- **No caps, no behaviour change.** Search (`POST /api/recipes/search`) also
  calls the model and is not in this table; that is a separate question.

`GET /api/admin/costs` is README "Extraction costs". The privacy policy
says so since Sep 30 (Technical records), approved wording.

### 4. Phone QA checklist — written (no code)

`docs/qa/phone-checklist.md`: an 18-item, ten-minute smoke test, then
everything device-only by screen, each item with what to do and what should
happen. It was gathered from this file, CLAUDE.md, MOBILE_PARITY.md, README
and the session reports, with duplicates merged and the automated test that
covers each item's logic named, so those can be skipped. Two stale entries
were found while gathering: §1 and "Suggested order" #8 still say Sign in
with Apple "has not been started" (it is built; Phase 4 is current). Both
corrected Sep 30.

### 3. Seeing problems — audited, proposed (not built)

What exists (Sep 30 audit): no crash reporter anywhere. The phone's root
ErrorBoundary shows "Something went wrong" and logs nothing, so a render
crash reaches nobody; the web's error boundary is written and never
mounted. The server logs through pino (requests) and ~140 `console.*`
lines to Replit's deployment logs, with no error middleware, no log
shipping and no uptime check. `trust proxy` is not set, so `req.ip`, which
the extraction limit and the admin throttle key on, may be the proxy's
address on the deployment — worth one log line to confirm. Usage counts
exist only as `extraction_events` (now with cost) and `access_events`.

Proposed, lightest first: (a) Apple's own crash reports — free, no code;
(b) a `daily_counters` table (day, name, count; no user id) incremented
fire-and-forget by the server, with a closed allow-list client endpoint for
the two starter events and an admin read route; (c) a free uptime monitor
on /api/health at a slow interval, because every ping wakes the Autoscale
deployment. A Sentry-style SDK is costed in the report, not proposed. All
waiting for approval, with a privacy sentence.

### The per-IP extraction limit was one bucket for everyone — fixed (Sep 30)

Measured on the deployment: `req.ip` was `::ffff:127.0.0.1` for every
request (a loopback proxy), so the extraction and search limit (20 fresh an
hour) and the admin failure throttle each treated every user on an instance
as ONE client. Six samples through both hostnames showed the shape of
X-Forwarded-For: `<client>, <load balancer>, <Google proxy 35.191.x>,<a
last hop that changes every request>`, with the load balancer fixed per
hostname — `34.111.179.208` for recipereduction.com, `34.117.33.233` for
recipe-reduction.replit.app (the phone app).

**Decided and built:** `lib/clientAddress.ts` keys on the entry immediately
left of the RIGHTMOST address listed in `TRUSTED_EDGE_IPS` (deployment
secret only), not on a `trust proxy` hop count, which trusts a client-written
entry the day a hop disappears; `req.ip` is untouched. No listed address, no
valid entry left of it, no header or no valid setting: the socket's peer,
i.e. the old shared bucket — it fails shared, never spoofable. IPv6 keys by
/64. The setting is validated at boot (addresses only, comma-separated, at
most 10; anything else refused whole with one warning). A chain with no
listed address logs the load balancer's address to add — named only when a
Google proxy hop shows where it is, so never a client. The admin audit
rows' `actorIp` is now the client key; the rejected-secret log shows an
HMAC of it.

**The anchor check was verified on the deployment through both hostnames
(Sep 30, `b2cb5cb`):** recipereduction.com anchored on `34.111.179.208`
and recipe-reduction.replit.app on `34.117.33.233`, the key's HMAC matched
the owner's public address recomputed by hand, and a forged
`X-Forwarded-For` left it unchanged. The temporary diagnostic route that
checked it (`GET /api/admin/diagnostics/ip`) has been deleted, and with it
its tests; what stays is `lib/clientAddress.test.ts` (the key) and
`routes/clientKey.test.ts` (the admin throttle per client, the extraction
limit per key, and the guard that fails on any `req.ip` in a route).
Limits remain per instance and fail open across instances, as the
process-memory rule allows.

### 3b. Usage counters — built (server Publish, after the SQL)

`daily_counters` (README "Usage counters"): anonymous counts by UTC day and
name. The server counts saves, wall hits by kind and coupon redemptions;
the app may report only the reel's five events. Extractions stay in
`extraction_events` and are shown beside the counts rather than counted
twice. "Paywall shown" is counted as the server's 402 (`wall_hit`), which
is not the same as the wall appearing on a screen: the phone also shows
the wall from its own entitlement check without asking the server. Counting
that would be one more allow-listed name, if wanted.

### 5. Starter recipes reel — built (Sep 30): server Publish, then over the air

Decided Sep 30: data first (pages other people saved and cooked), the
owner's curated list to fill; the search suggestions' privacy rules; every
card already cached; a pinned copy for curated pages (option B); hide and
curate without a deploy through `reel_entries` and admin routes; the
warm-up as an admin route on the deployment (report by default, extract
only with --write, re-read only a named row), called by `scripts/reel.mjs`;
empty for walled accounts; "Loved by Reduction users" only when every card
is data-backed and clears the ratings floor. README "Starter recipes reel".

**On the phone** (`components/reel/`, `lib/reelView.ts`): under the photo
buttons on Add New, and under the empty library's box and its two buttons
— never above anything, so on an iPhone 13 or SE the Add New reel is
reached by scrolling (measured Sep 30: the photo buttons already end at
y=510 of 664 and 532 of 568). The first cards were 140x158pt on our
meal-type art; they became Recipe Box pages the same day (below). "Title,
site" to VoiceOver, a time only when stated, use only when earned.
Hidden while an extraction runs, while the keyboard is up (native only:
Chromium has no soft keyboard), and when nothing qualifies. A tap is the
ordinary link extraction; the preview adds "Saving this uses your free
recipe." for an account with a free recipe left. Counted anonymously:
shown (once a session), tapped and saved, by kind. With Reduce Motion the
scroll does not snap — which only a phone shows, since the web build has
no snapping either way.

**Cards became Recipe Box pages, with pictures (decided Sep 30, after the
first cards reached the phone).** The owner asked for the book page's face
— picture, title, time, serves and steps, first ingredients — and for
"Cooked by N people" and "N likes" as use arrives. That reverses the first
spec's "no third-party photos": a page's picture in a row shown to people
who have not chosen that recipe is closer to a link preview than to their
own copy, so every card credits its site, and `hide` takes a page out
without a deploy if a site objects. The picture is the page's OWN image,
fetched and stored by the server (`reel_photos`); nothing reads anyone's
`recipe_photos` to build a card (README "Starter recipes reel"). "Likes"
replaced the 👍 share on the card: the count of accounts whose latest
rating is 👍, shown from five ratings, with the 60% floor still deciding
whether the page is offered at all.

**On the phone, the card and the ticker (Sep 30).** The card IS the Recipe
Box page's face (`PageFace.tsx`, which the book's pages now draw through —
the book's spread was compared byte for byte before and after the split,
at iPhone 13 and SE). Likes ride the picture as a "👍 N" badge, where a
book page puts its rating, and "Cooked by N people" is the footer's line
above the site: one joined pill did not fit a phone's card. The cards are
as tall as the room left above the tab bar (`reelCardSize`, the owner's
choice: "as big as can fit … without scrolling"), from a floor of 177pt
(158 with no use line) to the height that shows every row; rows arrive in
order — title, time, use and site always, then serves and steps, then
ingredients — and the rest is picture, at most 4:3. Measured at app-sized
screens in Chromium: the empty library shows full cards on an iPhone 13
(164x314), a Pro Max (185x330) and an SE 3rd gen (158x287) with nothing
scrolled; Add New shows a 185x225 card on a Pro Max, and on an iPhone 13
has about 182pt by the owner's screenshot (Chromium's layout of that
screen runs ~63pt taller than the phone's, so only the phone can say);
on an SE it is below the fold, as before.

**The ticker** (the owner's request, Sep 30): the row drifts left at
22pt/s on the UI thread (`tickerStep`, one frame callback), looping over
a second, VoiceOver-hidden set; any touch stops it at once and it resumes
5s after the last one (decided). It never moves under Reduce Motion or
VoiceOver, off screen, on a hidden Find folder, or with too few cards to
loop — and then the cards are shown once. react-native-web answers `true`
to "is a screen reader on?" always, so only the phone's answer is
believed; that cost a round of "the ticker never starts" in Chromium.

**The minimums are PROVISIONAL**, chosen before there was data: cooked by
at least 3 distinct accounts; the 👍 share used (and shown) only from 5
ratings; excluded under 60% 👍 at 5+ ratings; at most 10 cards; the reel
built once an hour per instance. Revisit when the counters show real use.

**Open product question: a starter's save spends the free recipe.** Tapping
a card is free (a signed-in cache hit spends nothing), but saving it is a
save like any other and uses a free account's only recipe. Someone who
saves our pick to see what happens then meets the wall on their own
recipe. Not changed (decided Sep 30); the preview says "Saving this uses
your free recipe" for accounts on the free allowance. Worth deciding
before the wall goes on.

## An over-the-air update that did not show (Oct 1)

**Reported:** an update published Oct 1 did not bring the guided demo
(`61f2b3b`), the rename pencil (`d5cb816`), the starter reel (`c1ce195`),
Send feedback (`72f575f`) or the Clear progress reset (`525da7d`) to the
phone. **Established from the repo:** all five are on `main` and are
ancestors of `b2cb5cb`, which the Replit workspace had pulled by Sep 30
(the deployment's `/api/health` reported it). An iOS export of `main` built
the way the script builds it (`expo export --platform ios`, the production
domain) carries each: "Start the demo", "Send feedback", "Rename recipe",
"Clear progress" and the `starter-reel` reel are all in the Hermes bundle
(the reel's heading text is the server's, so it is not in the bundle). No
package with native code has changed since 1.1.0 (`1f5a82f`, Sep 27), so a
1.1.0 binary can run that bundle. **What the repo cannot show** is what was
published and what is installed; the owner's `eas update:list`,
`channel:view` and `build:list` output decides it (commands in
`docs/next-publish.md`).

Ranked for this setup:
1. **Not cold-started twice.** `checkAutomatically: ON_LOAD` with
   `fallbackToCacheTimeout: 0`: the first launch after a publish downloads,
   the SECOND runs it, and leaving the app in the background is not a
   launch.
2. **The installed binary's runtime is not 1.1.0** (a TestFlight build
   older than Sep 27 is 1.0.0, and builds before Sep 24 have no
   expo-updates at all). An update reaches only its own runtime.
3. **Channel or branch.** The build was made with a profile whose channel
   is not `production`, or the `production` channel points at another
   branch.
4. **A stale checkout** published under a message describing newer work.
   Less likely here (the workspace had pulled past all five), and now
   refused by the script.
5. **A check or download error, or an emergency launch** (expo-updates
   fell back to the embedded bundle after a crash) — now shown on the phone.
6. **The embedded bundle newer than the update.** Ruled out by the symptom:
   the features are missing, so the phone runs something older than them.
7. **Wrong platform.** The script publishes `--platform ios` only.

**Decided and built (Oct 1, phone code, over the air):**
- `scripts/publish-update.mjs` runs `git fetch` and REFUSES when the
  checkout is behind `origin/main` or has uncommitted changes to tracked
  files, unless `--force`; prints commit, channel, runtime version and
  server before uploading; and appends the short commit hash to the
  message (`+changes` when forced dirty).
- Settings ends with "Version 1.1.0 (build N)" for everyone.
- The owner's testing sheet opens with *This launch*: update id (8
  characters) or "Embedded bundle", channel, runtime version, published or
  built time in UTC, last check, "Waiting" when a downloaded update needs
  one more cold start, any check or download error, and an emergency launch
  with its reason. Only what `expo-updates` already reports
  (`useUpdates()`), so no native change and no version bump.
- **Resolved (Oct 1, from the owner's `eas` output):** the Sep 30 update
  (group `15cc87cb`, runtime 1.1.0, iOS, channel and branch `production`)
  was built from `dc85229`, a Replit "Published your App" commit that
  exists only in the workspace and contains all five features. The phone
  is on build 7 (1.1.0, production), whose embedded code predates them.
  Send feedback was showing, so the update was running, and after a
  further close and reopen the guided demo was too; the rename pencil had
  been there all along. Cause: ranking item 1 (the update not yet
  running), with nothing wrong in the repo or the publishing setup. The
  workspace carries Replit's commits that GitHub does not, which is why the
  guard allows a checkout AHEAD of `origin/main` (with a note) and refuses
  only one that is behind.
- Not done: a "check for update now" button, which would need
  `Updates.checkForUpdateAsync`/`fetchUpdateAsync`/`reloadAsync` — allowed
  by the binary, but a behaviour change nobody asked for.

## The amber hint under the diagram is gone (Oct 1)

The owner's call: "Amber means you can do it now. Tap any step further
right to jump ahead…" no longer sits under a saved recipe's diagram, on
the phone (`RecipeScreen`) or the website (`RecipeView`, where it said
"Click"). It was the same hint outside any demo in both places, so both
went. What stayed: edit mode's own line on both clients (edit mode must
never be quiet), the Original recipe card and the source link, the phone's
guided demo (`demoGuide.ts` still teaches amber and jumping ahead; the
phone demo passes its own footer, `CoachLegend`, which was never this
hint), and the website's landing demo (`DemoCoach` tips). Nothing relied on
it: no test or testID named it, VoiceOver now reads the finish strip, then
Original recipe, then the source link, and the gap it leaves is the finish
strip's own margin plus the card's 12pt. Measured in Chromium, the page is
60pt shorter on a 390pt phone and 77pt on an SE. The phone change ships
over the air; the website's ships with the next Publish.

## Dark mode: Cocoa (Oct 1)

**The owner's call, from a mock ("palette B"):** dark mode was too dark and
the diagram's cells did not stand out. Phone app only; light mode is
unchanged value for value. All of it is tokens in `constants/colors.ts`
(`dark`); no component carries a Cocoa value.

| token | before | Cocoa | what it paints |
|---|---|---|---|
| `background` | `#131110` | `#211a16` | the page, headers, the classic tab bar |
| `card` | `#2a2622` | `#3b2f28` | diagram cells, Settings cards, sheets, dialogs, the demo card, the paywall, buttons |
| `muted` | `#2b2723` | `#463930` | the pinned ingredient column, pressed surfaces |
| `border`, `input` | `#3b352c` | `#8f7a69` | cell edges, dividers, card hairlines, the tab bar's top rule |
| `borderStrong` | `#4e463a` | `#a68f7b` | the diagram's outer frame, the ingredient rule, strong rules |
| `text`, `tint`, `foreground`, `cardForeground`, `primary` | `#ece6d9` | `#f6eedd` | text |
| `mutedForeground` | `#a89f8f` | `#c7b9a3` | secondary text |
| `faint` | `#786f60` | `#928472` | small uppercase labels — NOT in the mock: kept at their contrast, which the lighter cards would have cut to 2.6:1 |
| `tabBack` (new) | (`card`) | `#3b2f28` | Find's tabs behind the chosen one |
| `tabBackLine` (new) | (`border`) | `#76624f` | their edge |
| `paper` (new) | `#fbf6ea` | `#ebdfc6` | Recipe Box pages and the reel's cards (light keeps `#fbf6ea`) |
| `paperSpine` (new) | `#f4ecdb` | `#e4d5b7` | the page darkening toward the spine — the same step as light's; not in the mock |
| `toastBg` (new) | `#2a2118` | `#463930` | the toast: the old pill was 1.2:1 against the new page; this is 1.5:1, white text 11:1 |

The new tokens replace literals in FolderTabs, BookPage/PageFace,
StarterReel and Toast; their light values are the old literals. Unchanged
on purpose: `warmBg`/`warmLine`/`warmInk` (the red Oven row and ready
cell), `coolBg`/`coolLine`/`coolInk`/`secondary` (done, and the green
active Diagram/Step-by-Step choice), the danger tokens, colorblind's layer,
the book covers. Those are translucent tints, so they render over the new
cell: a ready cell is `#673b30` (was `#5a342b`), a done cell `#41392c`
(was `#323127`).

**Fixed on the way:** the edit sheet's small labels (Time, Temp, Name,
Amount…) were light-mode literals, dark brown on the dark sheet at 2.5:1;
they now take `mutedForeground`/`faint` (6.7:1).

**Contrast, from the rendered colours** (pixels sampled from the iPhone 13
screenshots match the tokens exactly; translucent tints composited over
what they sit on):

| pair | before | Cocoa |
|---|---|---|
| Body text on page | 15.14:1 | 14.86:1 |
| Body text on diagram cell / card | 12.07:1 | 11.21:1 |
| Body text on pinned ingredient col | 11.92:1 | 9.63:1 |
| Secondary text on page | 7.19:1 | 8.90:1 |
| Secondary text on card | 5.73:1 | 6.71:1 |
| Secondary text on pinned col | 5.66:1 | 5.77:1 |
| Faint label on card | 3.03:1 | 3.55:1 |
| Faint label on page | 3.80:1 | 4.71:1 |
| **Cell edge vs cell** | 1.24:1 | **3.18:1** |
| Cell edge vs pinned col | 1.22:1 | 2.73:1 |
| **Outer frame vs page** | 2.03:1 | **5.59:1** |
| Cell vs page | 1.25:1 | 1.33:1 |
| Inactive tab label on inactive tab | 5.73:1 | 6.71:1 |
| Inactive tab edge vs page | 1.55:1 | 2.97:1 |
| Ready ink on ready cell | 6.83:1 | 6.00:1 |
| Ready ring vs ready cell | 3.49:1 | 3.06:1 |
| Done ink on done cell | 10.56:1 | 9.84:1 |
| Active tab ink on its tint | 8.14:1 | 7.26:1 |
| Paper ink on paper | 14.65:1 | 11.96:1 |
| Paper secondary `#8a7a66` on paper | 3.85:1 | 3.15:1 |
| Paper faint `#a8977f` on paper | 2.63:1 | 2.15:1 |

Every body text clears 4.5:1 and the cell edge clears 3:1. Two things do
not, both on the paper and both the paper's own inks (constants in
`PageFace.tsx`, the same in both themes): its secondary line ("Not cooked
yet", the meta line) was already 3.85:1 on light paper and is 3.15:1 on
`#ebdfc6`, and its faintest ink 2.15:1. OPEN: darken the paper's two inks
in dark mode only, or accept it — not changed, because the paper's
colour was the instruction and the inks were not.

**Left alone:** the meal-type art tiles (illustrations with their own dark
tones), the solid red delete buttons and the white text on book tabs, the
scrims, the badge whites on the paper, Book.tsx's cover shading and rim,
and the opening sequence (below).

**The splash (not changed).** The native dark splash is `#131110` in the
binary; the page is now `#211a16`. On a dark launch WITHOUT the opening
sequence — every launch but at most one a day — the splash hides straight
onto the app: a step from near-black to a visibly warmer brown,
roughly the jump between the old page and the old cards. Options:
1. **`#211a16` in `app.json`'s splash `dark.backgroundColor` in the next
   build** — the right fix, free with a build already planned; a native
   change, so that build bumps `expo.version` (or accepts it on the
   icon-and-splash precedent: nothing a bundle calls). The opening's
   `DARK` constant must change with it.
2. **At app start, `SplashScreen.setOptions({ fade: true, duration: 300 })`**
   before `hideAsync` — JS only, in the binary already: the step becomes a
   300ms crossfade. Costs a third of a second on every launch.
3. Leave it until the next build. Recommended: 3 now, 1 with the next
   build.
**The opening's dark fade needs no change:** it starts on `#131110` to
match the splash it covers, fades to cream, and its end reveals the app
underneath — whatever the page colour is. Only option 1 would move its
start colour.

**The website** has its own dark theme (`index.css`, `[data-theme="dark"]`,
still `#131110`/`#2a2622`), copied once and never shared with these
tokens. Not changed; it would be the same five values in `--page`,
`--card`, the lines and ink if wanted.

**Only the phone can check:** iOS 26's native tab bar and headers (Liquid
Glass takes its colours from the system, not these tokens — Chromium only
ever renders the classic layout); how the splash step looks; legibility on
a real OLED screen across a counter; WebKit's rendering of the hairline
edges at 3x. Chromium (iPhone 13, Pixel 5, SE): the diagram, Step-by-Step,
the Recipe Box, Settings, the ⋮ dialog, the Servings sheet, the guided
demo and the empty library before and after, no page-level sideways
scroll on any.

## Dark mode: the paper's grey text (Oct 1)

**The owner's call:** small grey text on the Recipe Box pages and the
reel's cards must be at least 4.5:1 in dark mode, where the paper is the
darker `#ebdfc6`; light mode stays exactly as it is. The page's greys were
literals in `PageFace.tsx`/`BookPage.tsx`/`StarterReel.tsx`; they are now
tokens, `paperMuted` (the time, "Serves N · N steps", the reel's site),
`paperFaint` ("+N more", the page number, the blank page) and `paperPill`
(the "Not cooked yet" pill's background). Light values ARE the old
literals; `lib/themeTokens.test.ts` pins both rules. The preview sheet does
not draw the paper (it is a theme sheet) and is unchanged.

| on dark paper | before | after |
|---|---|---|
| time, serves, reel site (`paperMuted`) | `#8a7a66` 3.15:1 | `#706150` 4.52:1 |
| "+N more", page number, blank page (`paperFaint`) | `#a8977f` 2.15:1 | `#706150` 4.52:1 |
| "Not cooked yet" on its pill (`#ece3d0`) | 3.26:1 | 4.68:1 |
| ingredient line `#5c4d3c`, title `#2a2118`, reel "Cooked by" `#8a4b2a` | 6.16, 11.96, 5.10 | unchanged |

Sampled from rendered pixels in Chromium (iPhone 13, Pixel 5, SE profiles);
light screenshots before and after are pixel-identical.

- **The lightest passing grey, so at the floor the two greys meet.** Dark
  mode now has one paper grey; the muted/faint step survives in light only.
  Keeping a step would mean darkening `paperMuted` below the floor's
  lightest (about 5:1 for a visible difference), which brings the time line
  close to the ingredient line's ink.
- **The fold.** On a right-hand page the first letter or two sit on the
  shading toward the spine (`paperSpine #e4d5b7`), about 4.1-4.3:1 there.
  Clearing 4.5:1 on the spine colour too needs `#695b4b` (5.0:1 on the
  paper). Not done: the owner asked for 4.5:1 on the paper.
- **Not changed, reported: the "Cooked N× · date" pill** (the book's colour
  on a 12% tint of it) is below 4.5:1 in dark for 10 of 12 book colours —
  Honey 3.07, Fern 3.08, Terracotta 3.53, Teal 3.11, Leaf 3.06, Berry 3.89,
  Slate 3.69, Cocoa 4.53, Raspberry 4.22, Plum 4.68, Caramel 3.81, Olive
  3.70 — and in light for 7 (Honey 3.69, Fern 3.70, Terracotta 4.29, Teal
  3.75, Leaf 3.72, Slate 4.45, Olive 4.46). Dropping the tint alone gains
  0.4-0.7; passing needs a darker ink per colour (up to 22% toward black
  for Honey, Fern, Teal, Leaf), which is a decision about the book colours,
  not a token. **The rating badge** is an emoji on a near-white disc; it has
  no text colour to measure (the reel's like count on it is about 14:1).
- **Light mode, for the owner to decide:** the same greys measure 3.85:1
  (`#8a7a66`) and 2.63:1 (`#a8977f`) on `#fbf6ea`, and the pill 3.26:1.
  4.5:1 would take `#7e6f5d` for both greys (lightness 52 → 48 for the
  muted, a small step; 63 → 48 for the faint, a quarter darker, so the two
  would meet as they now do in dark) and `#726352` for the pill's text.

**Found while measuring, not changed:** on an iPhone SE profile a book page
is too short for its lines — the right page's time line is clipped to a
sliver and the cooked pill overlaps the ingredient line and the page
number, in both themes, before and after this change (`pageLayout`'s
budget). Worth confirming on a real small phone before fixing.

## Find closed the app: a worklet's default parameter (Oct 1)

**Reported:** after the Oct 1 over-the-air update (the first to carry the
reel's Recipe Box cards and ticker, `8de1ebc`), tapping Find closed the app.

**Cause, from the shipped bytes.** The iOS bundle contains:
`function tickerStep_reelViewTs1(offset,dtMs,period,speed=TICKER.speed){const{TICKER}=this.__closure;…`
The worklets plugin unpacks the closure in the body; the default parameter
is evaluated first. StarterReel's frame callback called `tickerStep` with
three arguments, so on the UI thread `TICKER.speed` named a variable that
does not exist — run alone with only its closure, that exact string throws
`ReferenceError: TICKER is not defined` (Hermes: "Property 'TICKER' doesn't
exist"), and an error on the UI thread closes a release build. It fires the
first frame the ticker runs: the reel on screen with enough cards to loop,
Reduce Motion and VoiceOver off — Find › Add New, and an empty library's
reel the same way; light and dark alike; the server's old or new shape
alike. An empty, missing or failing reel never starts the ticker.

**Why nothing here saw it.** Chromium runs worklets as ordinary functions,
where the module scope is present. The full matrix — iPhone 13, Pixel 5, SE;
dark and light; today's shape, the pre-Sep-30 shape, empty, `null`, 404,
500 and a dropped request; Find and the empty library — never crashed, and
the ticker ran in every case with cards. The server was not involved:
`parseReel` gives every field a default, and the Oct 1 `warm` output
("picture: already stored") shows production already serves `f8da606`'s
shape with `reel_photos` in place.

**Fixed:** `tickerStep` takes `speed` as a required argument; the frame
callback passes it, catches anything a frame throws and stops the ticker
for good instead; StarterReel sits in its own error boundary that renders
nothing (render errors only — it cannot see the UI thread);
`lib/workletRules.test.ts` parses every source file and fails on any
worklet with a default parameter (it named exactly this one before the
fix); `lib/themeTokens.test.ts` holds light and dark to the same tokens;
`reelView.test.ts` adds malformed, partial and old-shaped responses. The
fixed bundle's `tickerStep` runs with an empty closure. CLAUDE.md carries
the rule.

**Proposed, not built: a server check in `publish-update.mjs`.** A file
beside it naming the oldest server commit the phone code needs (today
`f8da606`, for the reel cards' summary and pictures), and before uploading:
GET `https://<server>/api/health`, read `commit`, and `git merge-base
--is-ancestor <needed> <live>`; warn — not refuse — when the live server is
older or unknown, and print both. A warning because the phone code is
written to degrade on an older server, and because the deployment's
`commit` is a short hash the workspace may not have fetched.

## Testing updates before they reach other users (Oct 1, built)

**Decided (owner, Oct 1): option A, the owner channel switch**, over a
second TestFlight build on a preview channel (a native build each time,
doubled for every future binary, TestFlight groups to manage) and a
percentage rollout (cannot put an update on the owner's phone first; worth
adding on top after launch). It needs no native change: build 7 carries
expo-updates 57.0.23, whose `setUpdateRequestHeadersOverride` swaps the
`expo-channel-name` header the build already sends.

**Built:** the testing sheet's *Updates from: production / preview*
(`components/settings/ChannelSwitch.tsx`, logic in `lib/updateChannel.ts`);
Settings' version line gains " · preview" off production;
`publish-update.mjs --promote <group>` (`update:republish
--destination-channel production`), refusing a group not on preview or a
commit not on main — Replit's empty "Published your App" commits on top of
main are allowed and named. Tests: `updateChannel.test.ts` (every path,
with the invariant that the phone is never on preview without a
downloaded preview update), `publishGuards.test.ts`.

**What was read in expo-updates' iOS source, not assumed:** the override
lives in UserDefaults and survives restarts; `null` deletes it; it is
accepted only for a header the build already carries; a CHECK stores
nothing, only a fetch records the channel's branch (so preview can be
probed and walked away from); with an override set the build-data wipe is
skipped, and clearing it restores the original header, so no wipe either
way. **The one way to strand the phone** — on preview with nothing to run,
falling back to build 7's own code, which has no switch — is closed by
clearing the override on every path that does not end in a downloaded
update, and by never rolling preview back to embedded. A reinstall from
TestFlight always returns a phone to production (UserDefaults go with the
app).

**Only the phone can prove it:** that iOS accepts the override at all
(docs/next-publish.md "Prove the switch", step 1), the restart, the
channel shown after it, and the way back. If the override is refused, the
fallback is the second TestFlight build (option B).

**Proved on the owner's phone (Oct 1, build 7):** the preview channel set
up (`channel:create preview`, from `artifacts/reduction-mobile` — run once
from the repo root it offered to create a new `@seans-apps/workspace`
project, declined), and the switch works there. From here every update
is preview → the phone → `--promote` (docs/next-publish.md section D).

## The reel shows only cards with a stored picture (Oct 1)

**Decided (owner):** a recipe belongs in the reel only with a real picture
from its own page, stored in `reel_photos` — data-backed and curated alike.
Built in `lib/reelStore.ts`: candidates are filtered on a stored picture
BEFORE the reel is assembled, so a dropped card's slot goes to the next
candidate rather than leaving the reel short; the build still starts
fetching the missing pictures it can (three a build), so a page whose tree
names an image joins a build later. The admin preview (and `reel.mjs
preview`) counts "no stored picture: N" and names those pages; the public
answer never says what was left out.

**Decided: a minimum of three cards, on the server** (`REEL.minCards`).
What the app did with 1 or 2 cards: shown them — `reelVisible` is "any
cards" — as a short static row (two cards never fill even an SE's width, so
the ticker would not run; one card sat alone under the heading). On the
server because the phone already hides on an empty list (tested since Sep
30), so the minimum changes with a Publish and no app update, and an old
binary obeys it too. Below it the preview lists the cards waiting.

## Working lists live in ~/workspace (Oct 1)

Replit clears `/home/runner` between sessions and keeps only `~/workspace`;
`~/reel-urls.txt` vanished that way. **Decided:** `scripts/reel.mjs warm`
defaults to `~/workspace/reel-urls.txt` (the repo root), a missing list is
a refusal that names the path tried and says where lists belong, and
`reel-*.txt` at the repo root is gitignored. Any future owner-side working
file goes in `~/workspace` and in `.gitignore` the same way.

## The warm report says how each page was read (Oct 1)

Two refreshes on Oct 1 cost about 20 cents for nothing: both sites refuse
our server, the fallback read them, and the fallback never records a
picture (`readRecipe.ts`). **Decided and built:** every warm report line
says how the page was last read and flags the fallback ones ("read
through the fallback: no picture can be stored, skip"), with a `hide`
command for each at the end; `--refresh` of such a page is REFUSED out
loud unless `--force`; `--candidates [file]` reports a second list with an
estimated cost per uncached URL (from the last 50 successful reads by the
same path) and never reads or spends. No schema change: the log keeps the
host, so a cached tree's own `image` key (always written by our fetch,
never by the fallback) decides first, and the site's last fresh read
decides for a tree without one. Spend and estimates are printed apart.

## Other sites' pictures shown to everyone (Oct 1, DECIDED and built)

**Decided (owner, Oct 1):** keep the pages' own pictures, as link
previews. Built: the card's site line opens the page (and is a VoiceOver
action on the card); the stored copy is preview-sized, long edge 480
(`REEL_PHOTO_LONG_EDGE`), with older 1024 copies shrunk in place from our
own bytes; `hide --purge` deletes the stored picture (below);
`privacy.html` gains "Suggested recipes" and
`terms.html` gains "Other sites' recipes and pictures" and "Copyright
complaints". Not generated pictures: one labelled with a site's name would
misrepresent that site's dish. Owner-side and not code: register a DMCA
agent with the US Copyright Office under the address the terms name, and
never use a site's picture in App Store screenshots or marketing. The
risk reasoning is in the project notes (`notes/reel-photos.md`); it is not
legal advice, and a lawyer's read was suggested. The history follows.

**The legal wording (approved by the owner, Oct 1).** terms.html's
removal promise is "We aim to act within three business days: we stop
suggesting it and delete our stored copy of the picture." — the deletion
is `hide --purge`, so a removal request is ALWAYS answered with
`--purge`, never a plain hide. Both pages are dated October 1, 2026.

**`hide --purge` (decided by the owner, Oct 1; built).** Plain `hide` is
unchanged: the card goes, the stored picture stays (`a7958af` briefly
made every hide purge; the owner wants the two apart). `hide <url>
--purge` (PUT /reel `{ status: "hidden", purge: true }`) also deletes the
`reel_photos` row, so the photo route answers 404, and writes its own
`admin_events` row (before `hidden`, after `purged`, the URL and whether a
picture was there in the note). **A hidden page is never warmed:** `warm`
— report, `--write` or a forced `--refresh` — is refused for it before
anything is read, curated or stored, so a list still naming a page can
neither unhide it nor bring its picture back; nor does a reel build's
fill fetch it. `unhide` is the only way back, and an unhidden page's
picture is fetched again by a later build or warm, as for any page.

### As proposed

The reel stores a page's own picture on our server and shows it, with the
site's name, to every signed-in user, including people who never saved
that recipe. **Neither legal page says so today.** `privacy.html` covers
a page's picture only as part of YOUR library ("fetch a copy when you save
the recipe … part of your library"); `terms.html` says recipes from other
sites "remain the property of their authors" and are extracted "for your
personal, non-commercial use". Neither mentions a shared reel or a removal
route. Wording is proposed to the owner and waits on approval; no legal
page changes until then (and the owner may want a lawyer to read it).

Found while checking: **`hide` takes a card out of the reel but does not
delete the stored picture.** The reel stops offering it at once on the
instance that served the command, within an hour on every other instance
(`REEL_CACHE_MS`), and a phone that already fetched the reel can show it
for up to an hour more (`FETCH_EVERY_MS`) — so "within two hours,
everywhere". The bytes stay in `reel_photos` and remain readable by any
signed-in user holding the photo URL. A removal request that promises "we
deleted our copy" needs a purge (a `hide --purge` that also deletes the
`reel_photos` row) — proposed, not built.

**Proposed cap: 20 curated entries** (twice `REEL.maxCards`, so hides and
pages that lose their picture have backups). Today there is no cap: every
curated entry is loaded on every build, oldest first by `updated_at`, and
the reel shows at most ten cards, data-backed first, so curated pages past
the tenth slot are loaded and never shown.

**Decided and built (owner, Oct 1): the cap is 20** (`REEL.maxCurated`).
Curating a 21st — `PUT /reel` with status curated (409, code
`curated_full`) or `warm --write` (status "refused", $0) — is refused out
loud BEFORE anything is read, written or spent, and says how to make
room. Re-curating a page already curated (a new note, a re-pin) is not a
21st, and hiding is never capped. Entries already on the list are never
dropped: a list that is past 20 when this ships keeps every entry, and
only new curations wait until it is under 20. `reel.mjs preview` prints
"N of 20 curated".

## Still open from earlier work

- **allrecipes.com cannot be read by the server, by either fetch (Sep
  27).** Our fetch gets 402; Anthropic's web fetch is refused for the
  domain ("permission denied for this domain"), measured on seven links,
  at both effort levels. Nothing on our side of the call changes that, and
  the site is saying no, so there is no workaround to build in the server.
  Today the person is told "This site blocked us from reading the recipe.
  Try pasting the recipe text instead." in about four seconds. The real
  option is a product decision: let the PHONE hand us the page it is
  already showing (a Share-sheet extension, or an in-app browser whose
  page text is sent for extraction), which is how recipe apps generally
  read sites that refuse servers. That is a native feature (a share
  extension means a build and an `expo.version` bump) and a privacy-policy
  sentence. **Decided and under way (Sep 28): an in-app browser**, the
  same mechanism Paprika documents for allrecipes.com (its bookmarklet:
  the person opens the page in a real browser and extracts from there).
  Phase 1, done: the server reads `{ page: { url, html } }`, cached by
  content and never by URL (README "How extraction works"), and a blocked
  URL carries `code: "site_blocked"`; the binary gains
  `react-native-webview` at `expo.version` 1.1.0. Phase 2 (BUILT and PASSED on a real
  iPhone, Sep 28: allrecipes.com loads in the in-app browser with its
  default user agent — no Safari disguise needed — and Extract returns
  the recipe with its own wording; shipped to the 1.1.0 TestFlight build
  over the air, server published at 76f4f48): `app/browser.tsx` and the rescue path — "Open in browser" beside "paste the text
  instead" — and the go/no-go on a phone: allrecipes.com loads in it and
  Extract returns the recipe with its wording. The rescue browser keeps
  nothing between visits; the privacy-policy sentence ships with the
  client that sends pages. **Phase 3 — BUILT Sep 28, over the air on
  the 1.1.0 binary, awaiting the phone** (commits 79de4af, 1cfa2f5,
  7e58794, 8b30b4f, 7c55bec; the section below has what was decided).
- **An ingredient with no amount: "to taste" / "as needed", or blank?
  (Sep 27).** The validator has always required qty or text on every
  ingredient, while the prompt said "no amount → qty null, text null", so
  most extractions paid a second model call to be told to fill `text` in.
  The prompt now asks for "to taste" (seasonings) or "as needed"
  (anything else) up front — no visible change from what the repair pass
  already produced, one call fewer. The other honest answer is to let the
  amount be BLANK when the source gives none: loosen `validateRecipe`'s
  rule and show nothing in the amount column. That changes what a card
  shows and what the editor accepts, so it is a decision, not a fix.
- **How much of a long source step a card shows — a default, not a
  settled decision (Sep 27).** Each Step-by-Step card now shows only its
  own share of a source step (recipe-model `sourceText.ts`). When that
  share is long — a single step carrying a page of advice, like a pizza
  dough's knead step with its poke test and windowpane test — the card
  shows whole sentences up to about 200 characters and a "Show the rest
  of this step" button (`clampSourceText`), and the Original recipe row
  under the card has everything. The 200 and the fold itself were chosen
  to fix the wall of text, not decided: the alternatives are no fold (the
  advice is the recipe's own words), a tighter fold, or asking the
  extractor to mark which sentences are advice. Worth deciding on a real
  phone after some cooking.
- **The web's Step-by-Step still invents "In a bowl" (Sep 27).** The
  phone's lead-in now comes from the vessel the step's own source text
  names, and is plain "Add:" when there is none. The web shows no source
  text (the original-wording gap below), so its lead-in keeps the old
  rule — "In a bowl, add:" whenever the label says "mix", "Add:"
  otherwise — which is the inconsistency reported on the phone. It
  closes with the gap below: pass the wording to the web's StepsMode
  and call `sourceTextsByStep` the way the phone does. The landing
  demo's guacamole reads "In a bowl, add:" today, so that copy changes
  with it.
- **The original-wording screen is phone-only — a known gap, not urgent
  (Sep 25).** The recipe as its source worded it (README "Original
  wording") ships on mobile only: `app/original/[id].tsx`, reached from
  the ⋮ menu and a row under the diagram. The web has no screen for it,
  by decision. What that leaves behind today: the web's saves send no
  `sourceKey`, so a recipe PASTED or PHOTOGRAPHED on the web never gets
  its wording kept; a recipe saved from a LINK on the web is still filled
  in on its first open on the phone (from the cache's wording, or the
  page's JSON-LD), so nothing is lost there. Building it later is a
  client-only job — the server route, storage and gate already exist:
  pass `sourceKey` from the extract response into the save, and render
  `GET /api/library/:id/original` (plus the preview's `original`) with
  the same attribution-first layout and the truncation note. The
  truncation cutoffs (80 steps, 120 ingredient lines, 24,000 characters,
  `ORIGINAL_LIMITS` in recipe-model `original.ts`) are SETTLED as they
  are: no recipe anyone expects to extract comes near them, and they
  exist for the rare runaway case, not to be tuned.
- **A component that joins at the last step gets no finish strip — decision
  needed (Sep 21).** Reported from a real extraction (a copycat lemon loaf
  with a Lemon Glaze section): the main table stayed wide while the last
  steps were left. The derivation (`lib/recipe-model/src/collapse.ts`, shared
  by both renderers) is doing what the web has always done: the strip takes
  only the steps AFTER the last ingredient join, and when the glaze joins at
  the root there is nothing after it, so "bake" and "cool completely" stay
  in the table as a tall chain until they are done and fold into a chip.
  Traced on a loaf-shaped fixture (now pinned in `collapse.test.ts`): the
  main table goes 7 → 4 → 3 → 2 columns as batter, bake and cool are done;
  on a 348px frame the 3-column state already fits, so on THAT shape the
  scroll the report describes is the raw 7-column table before anything is
  done, or a longer chain (cool in pan → turn out → cool → glaze → set)
  than the fixture has. The mobile diagram now prints one `[diagram]` line
  per section in a dev build — columns before/after, what folded, the tail,
  what is not done — so the real recipe's shape can be read from the Metro
  console instead of guessed. The extension on the table, if this is worth
  it: let the walk continue through a step that joins ONLY component
  ingredients (a `componentLinks` name, i.e. another section's output), so
  "pour glaze over" and the single-input chain under it become strip rows
  and the component's ingredient row leaves the table. It changes both
  renderers and the tuck's count, so it is a decision, not a fix.
- ~~**"Unchecking a step turns it red" — it is the ready cue; decision
  needed (Sep 21).**~~ **DECIDED Sep 22: keep it.** It matches the web and
  it is correct — an unchecked step's inputs are still done, so it is
  ready. No change. Left in place as the record of why the report was
  not a bug: Measured in Chromium: a step unchecked after being
  done renders exactly as a never-checked ready step (`warm-bg`
  rgb(249,214,207), a 2px `warm-line` rgb(185,51,38) ring, `warm-ink`
  label; the same on the web), because unchecking leaves its inputs done,
  which is the definition of ready. Nothing is misapplied. What the report
  is really about is the ready palette reading as an error on a phone: the
  terracotta/red pair is the product's signature ("Amber means you can do
  it now" was the hint under every diagram until Oct 1), and colorblind mode already
  swaps it for orange. Options: keep it; soften the warm tokens on mobile
  only (`constants/colors.ts`, no logic); or make the hint copy say "red".
  Not changed, on purpose — it is a colour decision, not a bug.

- ~~**The servings stepper does not exist, and scaling is unreachable.**~~
  **Done.** `artifacts/reduction/src/components/ServingsRow.tsx`, above the first section
  rather than in the badge row — it is the control that changes every number
  in the tables, where the rating and the meal type are standing facts about
  the recipe. It steps by `base/8` rounded rather than by 1, because a
  24-cookie batch stepped by 1 takes twelve taps to halve. `yieldText` shares
  its second line: the source's words at scale 1, the multiplier once scaled,
  never both — a yield line saying "makes 24 cookies" directly above doubled
  amounts is simply false. Correcting `recipe.servings` clears
  `entry.servings`, as decided below. The old CSS was reused with the buttons
  taken from 32x30 to 44px.

  **Two things this surfaced.** Scaled amounts render as `2.81 cup` — its own
  entry below. And correcting `recipe.servings` leaves a `yieldText` that may
  now contradict it; **settled as leave-alone**, because yield text is free
  prose ("makes 2 dozen", "one 9-inch pie", "serves 4-6") and clearing it on a
  guess destroys the source's own words. Yield sits directly under Serves in
  the recipe sheet, so anyone correcting one is looking at the other.

- **Scaled amounts round to numbers no kitchen can measure.** DONE. Doubling a
  recipe turned `2¼ cup` into `2.81 cup` — the first thing anyone saw the first
  time they used scaling, undercutting the feature at the moment it was being
  judged.

  `snapQty(q, unit)` in `lib/recipe-model/src/amounts.ts` is the rule, and it is per-unit
  because the right answer is: a ladder of increments per unit, snap to the
  coarsest rung within 5% relative error. Ordering the ladder by step size
  descending IS the preference order, which is how ⅓ lands ahead of ¼ for cups
  without a hand-written rank. Two ladders are worth remembering the reason
  for: **tablespoons stop at quarters** (⅛ Tbs is 0.375 tsp, which no tool
  expresses, while ¼ Tbs is ¾ tsp, which most spoon sets have), and
  **millilitres drop the 25 that grams keep** (25/50/75 g are the numbers
  recipes are written in; 275 ml is not a line on any jug).

  Three restraints matter more than the ladders:

  1. **`scale === 1` never snaps**, as an identity check rather than a
     tolerance — sound because scale is `servings / baseServings` for two
     integers or the literal 1. `FROZEN_AT_SCALE_1` in `amounts.test.ts` is 324
     rows generated by running the pre-rounding code and pasted as literals, so
     it cannot drift with what it guards. If rendering changes and those fail,
     regenerating the table is almost never the answer.
  2. **An integer is never moved.** 24 g and 3 cups are measurable; snapping
     removes what no tool can express, it does not beautify what is already
     fine. This is what keeps a scaled 240 ml from "helpfully" becoming 250.
  3. **No rung within tolerance renders the exact number.** Snapping is
     opportunistic. `pinch` and countable invert this and always snap, because
     there is no such thing as 0.81 of a pinch or 2.81 onions — the only place
     the tolerance is deliberately ignored.

  **Round for the diagram, stay exact in the editor**, now stated in code
  rather than implied. `EditSheet` called `formatAmount({ ...ing, unit: null })`
  — nulling the unit to drop the label — and that was the sole reason
  unit-keyed rounding could not reach the edit box. It would not have stayed
  harmless: a null unit selects the COUNTABLE ladder, one of the two that snap
  unconditionally, so the coincidence would have flipped straight to
  corrupting. `editableAmount(ing)` replaces it, with the contract that what it
  renders `parseAmount` reads back unchanged.

- **Metric amounts still render as vulgar fractions.** A snapped `7.5 g` shows
  as `7½ g`, because `formatQty` is unit-blind. A scale reads 7.5, not 7½, so
  metric arguably wants decimals always and imperial wants the glyphs.

  Left alone deliberately when the rounding shipped: it is a glyph question
  rather than a value question, and unlike the rounding it would change what an
  **unscaled** recipe shows on screen — the one thing that pass was not allowed
  to touch. Doing it means deciding whether that constraint covers glyphs as
  well as amounts. Cheap either way; just not free.

- **Small volumes have no rung, and the real answer is unit conversion.**
  `0.3 cup` stays `0.3 cup`, because nothing on the cup ladder is within
  tolerance: ⅓ is 11% away and ¼ is 17%. The rounding pass treats that as
  honest-and-unmeasurable beating pretty-and-wrong, which is the right call for
  a rounding pass and not a satisfying answer for the cook.

  The satisfying answer is that 0.3 cup is 5 Tbs — and that is **not a rounding
  tweak, it is a feature**. Two things make it one. It needs a **target-unit
  preference**: which unit to express in is a judgement (5 Tbs or ¼ cup + 2
  tsp?), it differs by ingredient and by cuisine, and it probably needs to be a
  setting rather than a constant. And it **changes what the ingredient says**,
  not just how its number is rounded — the unit in the tree stays `cup` while
  the diagram shows `Tbs`, so the display unit and the stored unit come apart
  for the first time, which touches the editor (what does the unit select show?)
  and the round-trip audit both.

  Worth doing. Not worth smuggling into a rounding change.

- **Historic detail, kept for the reasoning.**
  `entry.servings` was plumbed end to end — `storage.ts` reads and writes it,
  the PATCH carries it, `RecipeView` computes `scale` from it and `Diagram`
  renders every amount through `formatAmount(ing, scale)`. Nothing renders a
  control. `.rd-servings`, `.rd-stepper`, `.rd-step-btn` and `.rd-step-val`
  are all still in `index.css` from an earlier design, and nothing in
  `artifacts/reduction/src/components` uses them. So halving or doubling a recipe is a
  shipped, working, completely unreachable feature.

  **`recipe.servings` and `entry.servings` are different things and one
  control must never write both.** `recipe.servings` is what the recipe makes
  — a correction, and it lives in the recipe sheet as of round three.
  `entry.servings` is what you are cooking tonight, and `scale` is the second
  divided by the first. A single control moving them together would hold
  `scale` at exactly 1 for ever: scaling would silently stop working, every
  amount would look right, and nothing anywhere would report it. The stepper
  to build is the *cooking* one, and it writes `entry.servings` only.

  One decided consequence: correcting `recipe.servings` while `entry.servings`
  is set rebases the scale (8 wanted of a 4-serving recipe is 2×; correct the
  recipe to 6 and it becomes 1.33×, and every amount on screen moves). That
  cannot happen today because nothing sets `entry.servings`. When the stepper
  lands, clear `entry.servings` on a `recipe.servings` correction — the
  target was expressed against a base that no longer means what it meant.

- ~~**`yieldText` is extracted, stored, and rendered nowhere.**~~ **Done** —
  it is the second line of the servings block above, shown at scale 1 and
  replaced by the multiplier once scaled. The decision it was waiting for
  turned out to be "show it", and where fell out of the scaling question
  rather than being chosen: the two are the same fact, so they are one slot.

- **Historic detail on `yieldText`.** `fetchSource`
  pulls it from JSON-LD, `prompt.ts` asks for it, `structureRecipe` keeps it,
  and no component in `client/src` reads it. It is in the recipe sheet as of
  round three so that the editor has parity with the JSON that used to be
  reachable — which means someone can now edit a field that is invisible.
  That wants a decision rather than inheritance: either **show it** (under the
  title on the choose screen, next to servings, is the obvious place) or
  **remove it** from `Recipe` and from the prompt. Showing it is the cheaper
  and probably better answer — "makes 24 cookies" is more useful on a card
  than a bare serving count — but it is a product call, not a cleanup.

- ~~**The trial recipe cannot be edited.**~~ **Done.** `PATCH
  /api/trial/recipe` — its own route rather than a third case in the
  library's `scopeOf`, because widening that predicate would hand a
  signed-out browser the whole library surface (create, delete, list), which
  is the anonymous library #7 retired. The trial id comes from the httpOnly
  cookie only, and `user_id IS NULL` in the WHERE closes the path the moment
  an account owns the row. The edits survive signup for free: `claimTrialRecipe`
  moves *that* row, so there is no second copy to reconcile.
- ~~**Reordering the step-by-step sequence.**~~ **Done** —
  `artifacts/reduction/src/components/ReorderView.tsx`, entered from a Reorder button in
  steps mode. The model is a stored preference the walk consults
  (`entry.order` / `recipes.card_order`, an `OrderPreference` from
  `lib/recipe-model/src/sequence.ts`): section names ranked as a TIE-BREAK inside the same
  topological sort that enforces name links, and branch orders applied by
  building a candidate section and running the same `stepSequence` walk on it
  — so the dependency guarantee is structural, never a promise the preference
  has to keep. Stale entries are inert on read and pruned on write, in the
  same transaction where `done` is reconciled, client and server both.

  Measured before building: branch freedom is ~2^convergences and most
  recipes have 0–1, so the payoff is at the SECTION level (three independent
  sections = 6 orderings) — which is why sections group the list and drag as
  units. It deliberately OVERLAPS the step sheet's Order list: same fact,
  different scope — `reorderInputs` is a correction everyone inherits and it
  moves the diagram rows; `entry.order` is how one person cooks tonight. The
  third instance of the `recipe.servings` / `entry.servings` split.

  Two interaction details worth keeping if this is ever reworked: **the grip
  appears only on rows the walk can actually honour a move of**
  (`branchChoices` / `freeSectionIndices`, from the same module as the walk —
  the validMoveTargets single-authority rule), so movability is visible
  before the gesture rather than discovered at the drop; and the **empty
  state is a real answer** ("every step here depends on the one before it"),
  because a linear or fully-linked recipe has exactly one valid order and a
  list that refused every drag would be worse than saying so.

  The drag is `useIngredientDrag` behind a `resolve` options bag whose
  defaults reproduce the ingredient drag exactly — one implementation of the
  non-passive-touchmove trick, not two. **Worth considering separately: the
  grip-before-gesture pattern is better than the ingredient drag's
  highlight-at-pickup** (movability visible before committing to a hold), and
  the ingredient drag could adopt a subtle affordance in edit mode. Not done
  in this pass; noted so the asymmetry reads as a queue item rather than an
  accident.
- **`Unit` and `UNITS` are two hand-maintained lists that must agree.**
  `lib/recipe-model/src/layout.ts` declares the union type at the top and the runtime set
  near `validateRecipe`, and nothing enforces that they match — a unit added
  to one and not the other either fails to typecheck at the call site or is
  silently rejected by the validator. Deriving one from the other (a `const`
  array, `typeof UNITS[number]` for the type) is a small change now and an
  annoying one once a third list appears. Surfaced when the editor's unit
  picker needed the set at runtime.
- ~~**`recipes.timer` is never cleared when a timer finishes.**~~ **Done
  (Sep 17), on both clients.** The completion transition that fires the
  alert now also writes `timer: null`, once, through the normal
  `onUpdate` / `ifVersion` route; the "Time's up" line stays on screen from
  component state, so clearing the row does not blank what someone is
  reading, and it goes when the step is marked done or a new timer starts.
  Leaving and re-entering Cook mode no longer re-fires an alert for a timer
  that finished yesterday, and the server's PATCH hook cancels the pending
  `timer_notifications` row on the same write.

  The check the entry asked for found a real hole. `mergeEntry` resolved a
  both-changed timer with `mergeTimer`, whose "an explicit cancel wins"
  rule would have let this clear kill a timer another device had JUST
  started (base T1; mine null; theirs T2 → null). The merge is now
  base-aware for that case: a cancel beats the timer it cancelled and
  nothing else, so a null on one side and a new timer on the other keeps
  the new timer, in both directions. Three `sync.test.ts` cases pin it;
  `mergeTimer` itself and its tests are unchanged. Verified on BOTH clients
  in Chromium against the real API: a seeded running timer counted down,
  the alert appeared on the transition, one PATCH landed with
  `timer: null`, the row read null and its pending notification was
  cancelled, and the alert stayed on screen; on mobile, leaving Cook mode
  and returning showed the Start button rather than a stale alert.

  Also in the same commit, two store-passage settings in `app.json`: a
  branded splash (the transparent brand mark on the app's background
  colour, light and dark) where a blank white screen used to show before
  the parchment appeared, and the standard export-compliance declaration
  (`ITSAppUsesNonExemptEncryption: false` — the app uses only standard
  HTTPS), so every TestFlight upload does not stop to ask. Both need a
  native build to see.

  Phase B does NOT depend on this and deliberately does not read that column;
  see `timer_notifications` in `lib/db/src/schema/schema.ts` for the three reasons.

- **Phase B timers: OPEN. The infrastructure is built; the wake-up is not
  paid for.** This is deferred, not solved, and the entry stays here until it
  is.

  **What exists and works:** `push_subscriptions` and `timer_notifications`,
  `artifacts/api-server/src/lib/push.ts` (VAPID send, dead-subscription pruning),
  `artifacts/api-server/src/lib/timerDispatch.ts` (claim, fan-out, retry, sweep), the routes,
  `artifacts/reduction/public/sw.js`, the client subscribe flow, and the Settings control. All of
  it verified against a stub push service over real TLS — sent, pruned on 410,
  retry bounded — and covered by `push.db.test.ts`.

  **Since Sep 10, a second delivery arm for the native app** (see the mobile
  section): an Expo push token in the same table, relayed through Expo's
  push service, needing no configuration at all — so the dispatcher now
  starts whether or not the VAPID keys are set. The wake-up problem below is
  unchanged by it: the arm is how a due timer reaches a phone, not what makes
  it due while the deployment sleeps.

  **What is wired today is a bandaid:** an in-process interval
  (`startTimerDispatch`, 30s, the shape of `startSessionSweep`) that runs only
  while the process happens to be alive. On Autoscale that means while the app
  is being used, plus the keep-warm window. A timer coming due while the
  deployment sleeps fires when someone next opens the app — which is what
  happened before this feature existed, so nothing regressed. What it does buy
  is real: a timer finishing while you are actually cooking now reaches every
  device on the account and reaches a phone whose screen is off, instead of
  only a foreground tab.

  It costs nothing, and it needs **no secret beyond the three push already
  needs** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
  `TIMER_DISPATCH_SECRET` is used in exactly one place — the HTTP dispatch
  route — and leaving it unset makes that route 404. So the paid path is not
  half-built; it is entirely absent until someone sets one variable.

  **The limitation is stated to the user**, in the Timers card in Settings,
  whether or not notifications are switched on: alerts arrive while the app is
  open or has been used recently, and always-on background alerts need a paid
  tier. The first draft of that copy said "even if the app is closed", which
  would have been selling the unbuilt version — the first burnt dinner would
  have been how someone found out.

  **The real fix, for whenever it is worth paying for** (Aug 2026 prices;
  Replit cut cloud pricing on 1 Aug 2026, so anything older is stale):

  | option | $/mo | accuracy |
  |---|---|---|
  | Reserved VM (`gce`), 0.5 vCPU/2 GB | 15 | ~1s — an always-on process can arm an exact `setTimeout` |
  | Autoscale + external cron | ~2 base + 1–3 | ≥60s |

  There is no Scheduled Deployment on this app — checked, only the published
  one — so those are the two. The trap worth remembering: **a 1-minute cron
  against a scale-to-zero deployment keeps the instance warm continuously**,
  so most of Autoscale's saving evaporates and the real gap to a Reserved VM
  is ~$10–12, not $15. Against that, $15/mo is 60% of a Core plan's credit
  pool, and deployments draw from the same pool as Agent usage.

  **Turning it on later is wiring a trigger, not rebuilding.** That is the
  whole reason `dispatchDueTimers()` has no scheduler inside it. Reserved VM:
  change `deploymentTarget` and optionally tighten `DISPATCH_EVERY_MS`, or arm
  exact `setTimeout`s for timers due within the next minute — the interval is
  already correct, it just becomes always-on. External cron: set
  `TIMER_DISPATCH_SECRET` and point something at `POST /api/timers/dispatch`.
  A job that runs a command imports the function directly and needs no secret
  at all. None of those touch the dispatcher, the tables, or the send path.

  **What is deliberately not built.** The service worker has NO `fetch`
  handler. A fetch handler is what turns a service worker into a cache, and a
  cache is what strands people on a three-deploys-old build with no way to
  tell them. iOS requires a *registered* worker for push, not one that
  intercepts requests. Offline support is its own decision with its own
  versioning story — not a side effect of wanting timers to buzz. The cost is
  that Android Chrome will not consider the app installable (it wants a fetch
  handler; the 192px icon it also wants exists since Sep 29 — `artifacts/reduction/public/brand/` has 32/180/192/512). iOS uses the
  180px `apple-touch-icon`, which exists, so the target platform is
  unaffected.

  **What could not be verified in the container**, and has to be checked by
  hand on a real device: that an iPhone actually receives a push, on either
  arm. WebKit is not installed here, Expo's push service and the deployed
  site are unreachable from the agent proxy, so what is proven is
  registration, subscription round-trip, the claim/fan-out/prune logic, the
  Expo request shape against a stub, and the config posture — not delivery.

- **The subscription paywall: BUILT, SWITCHED OFF.** One recipe per free
  account, $1.99/mo unlimited. Every line of it ships inert: with
  `PAYWALL_ENFORCED` unset and no `enforce_override` rows, the gate computes
  its decision, logs it, and allows the request.

  **Fair-use clause added; no cap exists (Sep 28).** The Terms now say a
  subscription is unlimited for normal personal use and reserve the right to
  limit, slow or suspend automated, excessive or abusive use, unreasonable
  load, or a sign-in shared between many people. Nothing in code counts or
  limits anything. If a cap is added later, update the paywall and Settings
  wording in the same commit.

  **What "one recipe" means, precisely**, because each of these was a decision
  rather than a detail:

  - **One EVER, not one at a time.** `account_access.recipes_used` is
    monotonic; deleting a recipe does not hand the slot back. A row count over
    `recipes` would have, and would have turned the free tier into an
    unlimited carousel.
  - **One across the WHOLE free experience.** The pre-signup trial's recipe
    becomes the account's one recipe, because the signup claim spends a unit
    of allowance in the same transaction that moves the row. Not one before
    signing up and another after.
  - **Blocked at the earliest point**, which is search and extraction, not
    save. An extraction someone cannot use is an API call bought for nothing,
    and a wall hit after the work reads as a bait-and-switch. Search is walled
    for the same reason: paying for a list of results nobody can act on is
    money spent to make the wall feel softer.
  - **Their own recipe is untouched.** Viewing, cooking, editing, scaling and
    deleting it are ungated, and so is `GET /api/library`. The app does not
    go dead — that is the difference between a limit and a dead end.

  **The sign-out loophole is closed.** Without the spend inside the claim
  transaction, a fresh cookie plus a second extraction plus a sign-in hands an
  already-full account another recipe, repeatable for as long as you have
  patience. The second trial is refused and its row stays PARKED — reclaimable
  the moment they subscribe, never deleted. Three tests fail if the spend is
  removed; that was checked by removing it.

  **Provider-agnostic, and not speculatively.** The App Store requires IAP for
  subscriptions that unlock in-app functionality and Play requires Play
  Billing under the same category of rule — but neither is a MIGRATION, because
  a subscription bought on the web must keep working forever. Each store adds
  a provider; three live at once is the expected end state. `provider` is an
  open string and `provider_ref` holds whatever that provider calls a
  subscription, so `google_play` is an adapter file and a new value — no
  schema change, no migration, proven by a test that entitles an account
  through a provider no code mentions. The rule that makes it hold is in
  CLAUDE.md: only `artifacts/api-server/src/lib/billing/stripe.ts` may touch the Stripe SDK.

  **Grace is the provider's retry window, not a timer here.** Stripe's default
  dunning is 8 attempts over roughly two weeks and the end state is a
  Dashboard setting — both changeable by the account owner. `past_due` maps to
  `grace` and stays there until the provider says the subscription ended, so
  there is no local constant to drift.

  **Two coupon mechanics, deliberately not unified.** "N recipes free" is a
  usage grant and adds to `recipe_allowance` — the same and only allowance the
  free tier runs on. "Free months" is a billing discount and is a native
  Stripe promotion code entered in Checkout, with no table here: mirroring
  Stripe's discount engine locally would be a second billing system doing
  worse what the first already does, and it would need building a third time
  for Apple. Redemption is offered in both places it is wanted — at the wall,
  where intent is, and in Settings, where someone given a code last week goes
  looking.

  **What has NOT been verified, and cannot be from this container:** live
  Stripe Checkout, a real card, a real Stripe-delivered webhook, and the
  signature verification against a genuine payload. What IS proven is the
  entitlement arithmetic, the monotonic counter, the concurrent-spend guard,
  the claim/loophole behaviour, the kill switch in both directions, shadow
  logging, coupon redemption including the once-per-account index, and the
  Stripe status translation. **Before switching anything on**, run a test-mode
  checkout end to end and confirm a webhook writes a `subscriptions` row.

  **The App Store adapter is now built** (Sep 10): `artifacts/api-server/src/lib/billing/apple.ts`
  and `routes/billingApple.ts` — signed-transaction verification, Server
  Notifications V2, the status translation (billing retry and grace period
  are `grace`, Apple's window, never a timer here), and the account binding
  through `appAccountToken`. What is still to build is the client purchase
  handler registered through `setPurchaseHandler` (Phase 3 in the mobile
  section) and the App Store Connect setup the README lists. Nothing else
  moved — that was the point of the seam, and it held: not one line of
  entitlement.ts changed. Unverified, and unverifiable from the container: a
  real Apple-signed payload; the preflight's test notification is the first
  exercise of that.

### Closed, kept for the record

- **The JSON hatch reached parity** at the close of round three. It has NOT
  been removed — that is still a decision to take. The audit:

  | field | reached by |
  |---|---|
  | `title`, `servings`, `source`, `sourceUrl`, `yieldText` | recipe sheet |
  | `mealTypes` | its own sheet |
  | section `name`, `header` | section sheet |
  | add / delete section | recipe sheet / section sheet |
  | ingredient `qty`, `qtyMax`, `unit`, `name`, `text`, `note` | ingredient sheet |
  | add / delete ingredient | step sheet / ingredient sheet |
  | step `label`, `minutes`, `tempF` | step sheet |
  | add / delete / split / merge step | step sheet |
  | `inputs` membership | drag, or the move list |
  | `inputs` order | the order list in the step sheet |
  | section `root` | derived by add/delete step |

  Two things the hatch could express that are deliberately not gaps.
  **Cross-section ingredient moves** stay refused by `moveIngredient`, because
  `deleteIngredient` + `addIngredient` reaches the identical tree — the same
  composition argument that keeps the ops from cascading. And **`qty` and
  `text` set together** cannot be produced by `parseAmount`: measured across
  33 stored shapes, the only true loss in the amount round-trip is that
  `{qty: 2, text: "2 heaping"}` commits back as `{qty: 2, text: null}` — but
  `formatAmount` returns early on a non-null `qty`, so that text is already
  invisible everywhere in the app, `prompt.ts` tells the model not to produce
  it, and the hatch was the only thing that could. The other two drift classes
  are a repair (`text: "2"` becoming `qty: 2`, which makes it scalable) and
  display rounding **bounded at 0.02 of a unit** by `formatQty`'s snap
  tolerance, which renders identically before and after.

- **Pass 3 visual polish** shipped (`9dd9221`): two-layer warm shadows, more
  surface contrast, a stronger ready state, done receding further, louder
  ingredient amounts. The corner treatment it was waiting on was signed off.
- **The card-order invariant** is guaranteed and tested, and it was not
  extraction variance. The walk was sound; the bug was that sections were
  emitted in array order, so a component section ("Dry ingredients") could be
  cooked after the section consuming it. `lib/recipe-model/src/sequence.ts` now orders
  sections by the name link `prompt.ts` asks for, and `sequence.test.ts`
  fixes the invariant against fixtures and 100+ generated trees.

