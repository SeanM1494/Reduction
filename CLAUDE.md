# Working in this repo

Architecture, scripts and deployment are in `README.md` — this file is for
constraints that are easy to break without noticing, because nothing in the
build fails when you do.

**Read `ROADMAP.md` alongside this file.** It is the feature queue: what is
being built next, in what order, and what each item actually requires — the
constraints and open decisions, not just the titles. This file says how to
work in the repo; that one says what the work is for, and several entries
carry decisions that are cheap to make now and expensive to retrofit.

## How work gets committed

**Commit directly to `main` and push.** Do not create a branch, and do not
open a pull request, unless explicitly asked for one. The stacked-branch
workflow this repo used earlier is retired: it cost a round trip per change
and, twice, merged a stale head — a pull request opened at one commit and
merged at that same commit while later work sat unnoticed on the branch.

**Run `npm run check` and `npm test` before every commit.** Both must pass
first. Not after, not "it typechecked earlier" — before.

### What the test counts mean

`npm test` has exactly three legitimate outcomes, and the difference between
them is the whole point:

| result | meaning |
|---|---|
| ***n* pass, 27 skipped** | no `DATABASE_URL`, or nothing listening. Fine. |
| ***n*+27 pass, 0 skipped** | a database with a current schema. This is the real gate. |
| **failures naming a missing table** | a reachable database whose schema is behind `shared/schema.ts`. Run `npm run db:push`. |

The total grows as suites are added — pin your expectation to the **skip
count**, not the pass count (an earlier version of this table hard-coded
23/39 and went stale within a week, so treat the number above as needing an
edit whenever a database-backed suite is added). The 27 are four suites:
`claim.db.test.ts` (the anonymous library), `trial.db.test.ts` (the free
extraction), `cache.db.test.ts` (the URL alias and the "Instant" badge) and
`extractionLog.test.ts` (the cost table). The first two are transactional
guarantees — all-or-nothing rollback, idempotent repeats, never taking another
user's rows. The third is a promise about correctness: that a normalised URL
never serves a different page. The fourth guards a denominator — a cache hit
that recorded a `via` would silently corrupt every "what fraction" query the
table exists to answer. **The full suite — 180 tests at the time of writing —
has been run against a real Postgres and passes 180/0.**

**`npm test` must never be run against production.** It reads `DATABASE_URL`,
which on a deployed host is the live database — so running the suite there
points every database-backed test at real data. That happened once. Nothing
was damaged, because each suite works inside its own random namespace
(`test-owner-<uuid>`, `cache-test.invalid`, a random trial id) and deletes only
what it made — but one test did leave a row behind, and "scoped" is not the
same as "safe against production". `server/lib/testdb.ts` now refuses a
non-local `DATABASE_URL` outright, before connecting, unless
`ALLOW_REMOTE_TEST_DB=1` is set. It throws rather than skipping, for the same
reason a missing table does.

**A skip must only ever mean "there is no database".** It used to be able to
mean "there is a database but it is missing the table I was about to test",
because each suite probed by selecting from its own table and reported the
failure as "no reachable DATABASE_URL". That shipped: `trials` existed in
`shared/schema.ts` and not in the database, so all nine trial-claim tests
reported themselves skipped **in the same run where the library claim's
tests passed against the same database in the same process** — a green suite
over a completely untested claim path, on the second of the two places in
this codebase where a bug loses someone's data.

`server/lib/testdb.ts` is now the single gate for both suites and asks the
two questions separately: `select 1` for "is there a database" (schema-
independent, so no migration can make it lie), and `information_schema` for
"is its schema current" — where a missing table **throws** and never skips.
If you add a database-backed suite, use that gate and name the tables it
needs.

**A stale schema is the first thing to suspect when something works locally
and 500s in production.** It is what broke Google sign-in: `createAuthState`
began writing `auth_states.trial_id`, the column was never pushed, and the
insert failed into the `start_failed` branch.

**Report the commit hash after every push**, so it can be verified against
what actually landed rather than trusted.

**Database snapshots live outside the repo.** `*.sql` is gitignored. A dump
is a copy of production user data, it is stale the moment it is written, and
a repo is the wrong home for either property — take one before every
`db:push`, keep it somewhere else.

## This app is mobile-first

It will ship as an App Store app, and most real use is a phone propped on a
counter in a kitchen. That is the primary target, not a narrow case to
accommodate afterwards.

- **A feature that works on desktop and not on mobile is not done.** Not
  "done with a known issue" — not done.
- **Touch targets are at least 44px.** A 31px control is a desktop button
  that happens to be on a phone.
- **Inputs are at least 16px font-size.** iOS Safari zooms the page toward
  any focused input below that, and the user has to pinch back. There is a
  floor rule (`input, select, textarea { font-size: 16px }`) in index.css,
  but `font: inherit` in a class resets it — so any new input class must
  declare 16px itself. Never "fix" this with `maximum-scale` on the viewport
  meta; that disables pinch zoom for people who need it.
- Legibility at arm's length across a counter, and reach for one thumb, beat
  desktop density every time they conflict.
- The landing page section below is part of this rule, not a separate concern.

### Verify on a real phone viewport, and on production

Three mobile-only bugs have reached production, and every one of them was
invisible in a resized desktop window. A narrow desktop window fires the same
media queries but gets none of the rest: no touch, no mobile user agent, no
device pixel ratio, and — the one that actually bit — **no browser chrome
eating the viewport**.

**A phone's screen height is not its viewport height.** An iPhone 13 is
390×844 as a device and **390×664** as a browser viewport once Safari's URL
bar and toolbar are showing. Measuring against 844 measures a viewport no
phone user ever has. Playwright's device descriptors already carry the right
numbers, so use those rather than a hand-typed viewport:

```js
import { chromium, devices } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ ...devices['iPhone 13'] }); // 390x664, touch, dpr 3
```

Check at minimum **iPhone 13** (390×664), **Pixel 5** (393×727) and
**iPhone SE** (320×568) — the SE is the one that exposes wrapping. Chromium
and Playwright are preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`)
so this needs no dependency in `package.json`. **WebKit is not installed**, so
a Safari-only bug cannot be reproduced in this container at all — that is a
gap to close on the deployed site, not to assume away.

Local passing is necessary and not sufficient: the last three mobile bugs all
passed locally and reached production anyway.

**Two verification gaps exist in this container, and neither should be assumed
away:**

- **WebKit is not installed** — only Chromium. An "iPhone 13" here is a
  Chromium engine at an iPhone's viewport, touch and pixel ratio. It catches
  layout and interaction bugs; it cannot catch a Safari-only rendering or JS
  bug, which is the engine most of this app's users will actually run.
- **The deployed site is unreachable from here.** The agent proxy answers
  403 to CONNECT for `recipe-reduction.replit.app` — a blanket outbound
  policy denial, the same answer it gives `www.google.com`. So "verify on
  production" cannot be done from this container and has to be done by hand,
  or the proxy policy has to allow the host.

State which of these applied when reporting that something is verified.

### Pre-commit, for any visual or interaction change

On top of `npm run check` and `npm test`:

1. Load the changed screen at **iPhone 13, Pixel 5 and iPhone SE** device
   profiles, not a resized window.
2. Confirm no page-level horizontal scroll:
   `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
   Ignore elements inside an `overflow-x` ancestor — the diagram scrolls
   inside `.rd-frame` on purpose. **A `position: fixed` element is not one of
   those**: it is not clipped by any ancestor's overflow, and it grows neither
   `scrollWidth` nor a scrollbar in Chromium, so this check calls it clean
   while Safari zooms the whole layout viewport out to fit it. That is exactly
   how the drag ghost reached production — see below. Only treat an ancestor
   as clipping when the element is not fixed, or when that ancestor has a
   `transform`/`filter`/`perspective` (which makes it the containing block).
3. Confirm every control you touched is at least 44px tall and actually
   reachable — `page.tap()`, not `page.click()`, so a `:hover`-only
   affordance is caught.
3b. **Sample after every interaction and during animations, not only at
   rest.** Record `innerWidth`/`innerHeight` once at load and compare on every
   sample: a zoomed layout viewport reports larger numbers than the device
   profile, which is the cheapest detector there is (it is how the SE toolbar
   overflow was caught — `innerHeight` read 682 instead of 568). The states a
   rest-only sweep never reaches are the ones that shipped: mid-drag,
   mid-animation, edit mode, and an expanded finish strip.
4. Re-measure the landing page collapsed (see below).
5. Check the same screens on the deployed site once it ships.

## Two things WebKit punishes that Chromium forgives

Both were found by cooking on a real iPhone, and neither reproduces on
desktop or in this container.

**The bars flashing at both edges when a step completes were the entrance
fade itself.** Completing a step that finishes a branch re-keys rows, and
every re-mounted cell ran `rd-swap-in`: 1s, from opacity 0, with a 6px
translateY. The collapsed chip mounts against the left edge over the
ingredient column and the consuming op cell reaches the right edge — measured
mid-animation at opacity 0.28, chip at left=6, op cell at right=384 on a
390px viewport. Two near-invisible regions, one per edge, healing after
exactly a second. The same collapse also changes the frame's real
`scrollWidth` (419 → 400, measured, on any recipe wider than the table's
400px min-width), and iOS flashes scroll indicators when a scroller's content
size changes — stacked on the fade, that is the "bar" report. The fade now
runs 450ms, from 0.35, and moves nothing.

Two lessons that outlive the bug. **First: this was misdiagnosed once**, as
WebKit unpinning the sticky column under an animated transform. That story
explained a left-edge artifact and could not explain a symmetric pair —
and the "verification" that blessed it measured sticky offsets at
`scrollLeft: 0`, where a sticky column and a static one are identical.
Measure sticky integrity with the frame actually scrolled. **Second: keep
transforms out of the scroller anyway.** The sticky unpin never reproduced in
Chromium (offsets held at 0 throughout, measured scrolled), but transform on
sticky is a real WebKit bug class and the entrance fade never needed to move.
That ban is prevention, not the diagnosis.

**A collapse also yanks `scrollLeft`** when the narrower table cannot contain
the old scroll position (41 → 22 in one frame, measured). Inherent to content
shrinking; noted so a future "table jerks sideways on completion" report
starts here rather than from zero.

**A `position: fixed` element painting past the right edge zooms the page.**
The drag ghost followed the pointer unclamped and reached `right=462` on a
390px viewport. Chromium neither scrolls nor grows `scrollWidth` for a fixed
element, so every h-scroll check passed; Safari scales the layout viewport
down to fit, and the diagram suddenly spans the screen with no margin until
the user pinches back. `useIngredientDrag` clamps the ghost to the viewport,
and the offsets it clamps against are the same ones `.rd-drag-ghost` carries
in CSS — change one and change the other.

## The landing page: the demo is opt-in

The page is a welcome line, an invitation, and the account path. The demo
sits behind **"See guacamole as a reduction (demo) →"** and is collapsed by
default. The account path is now a working paste box plus a sign-up button,
because the free extraction is taken from there (ROADMAP #7).

**This retired the fold budget rather than trimming it.** Collapsed, the page
clears the fold on every profile — but the trial's paste box and account
button cost the smallest phone about 56px, so an iPhone SE is back to a thin
margin and is the one to watch.

| device | viewport | collapsed page ends | spare |
|---|---|---|---|
| iPhone 13 Pro Max | 428×746 | 465 | +281 |
| Pixel 5 | 393×727 | 477 | +250 |
| iPhone 13 | 390×664 | 477 | +187 |
| Galaxy S9+ | 320×658 | 544 | +114 |
| iPhone SE | 320×568 | 544 | +24 |

**The SE's 52px of nav headroom has now been spent, so it is gone.** The
trial's paste box stacks (input on its own line, button beneath) because
side by side the input starved to 26px; stacking costs 52px, and the SE did
not have it. It was paid for by unwrapping `.rd-nav` at ≤380px — the brand
(44px) plus `.rd-nav-right` (252px) plus padding came to more than 320px, so
the row wrapped and cost 52px. Tightening the theme toggle's padding and
type took nav-right to 230px and the nav from 124px back to 72px.

**During an extraction the SE overflows, on purpose.** The progress line
(`ExtractionProgress`) is 40px plus margin below the CTA form, which pushes
"Create an account or log in" from y=500 to y=560 on a 568px viewport —
measured. The form itself does not move, because the line is inserted after
it, and the button is not something anyone needs mid-wait. A permanently
reserved slot would have spent the SE's remaining headroom for a line that is
absent most of the time, so the line renders only while running. Its own
height is fixed, so the message changing moves nothing.

**So the SE is at +24 with no cheap reclaim left.** The next one is real
design work, not a trim: the landing copy, or a small-phone layout. Measure
before adding anything above the call to action.

Expanding scrolls the invitation to the top of the viewport and the demo
unfolds beneath it. The diagram then ends at roughly the fold (666 against
664 on an iPhone 13) — a page someone has explicitly asked to see is allowed
to scroll, which is the freedom the collapsed default buys.

**There is no order fork any more.** One reading order serves phone and
desktop, because the diagram no longer has to be first to be seen. If you
find yourself adding `order` back to `.rd-landing-flow`, the fold pressure
has returned and something above the invitation has grown.

### How the collapse works, and why not with JavaScript

`.rd-demo-panel` is a grid that interpolates `grid-template-rows` from `0fr`
to `1fr`. No JavaScript measures a height or writes an inline style.

That is deliberate. The pattern of measuring `scrollHeight`, writing
`height` + `overflow: hidden`, and clearing both on `transitionend` breaks
whenever the event does not arrive — a hidden or backgrounded element never
fires it — and leaves a stale height behind that reads as a card clipping its
own content. `Diagram.tsx` uses that pattern for its own height swap and now
carries a timeout fallback for exactly this reason. Do not add a second one.

**The second way that pattern bites: it measures its own animation.** While a
run is in flight the element carries an inline `height`, so `scrollHeight`
reports the animation's current value rather than the content's. Diagram's
effect has no dependency array — it runs on every commit, and a hover is a
commit — so any commit landing inside the animation window fed the animation
back in as the next target. Measured on the guacamole demo at 390px: the
handoff tap read a 474px target for a 60px chip, skipped the transition
because target equalled start, left the stale height on, and then teleported
the finish strip **414px** when the fallback timer wiped it; the next two taps
re-inflated the container to 474px around that 60px chip and held it 1.4s.
Both taps had to be made twice.

So if you touch that effect, keep its two rules: **clear the inline styles
before measuring**, and **animate from the previous commit's content height,
or from the pinned height if a run is already going** — never from a fresh
`getBoundingClientRect()`, which in a layout effect has already relaid out to
the target and would animate from the target to itself.

**Nothing may resize under a fingertip.** `.rd-finish.is-focus` used to grow
every chip's padding and label on the same commit as the tap that completed
the tree — 34ms after the tap, with two steps still left to tap on the chips
that moved. Keep `is-focus`, and anything like it, non-geometric: no padding,
margin, font-size or transform change while a sequence is still in progress.
A layout shift between taps is fine if it is smooth; one during a tap is not.

The panel stays mounted while collapsed, so demo progress survives a close
and reopen; `visibility: hidden` applies after the collapse finishes so
nothing inside is tabbable or announced while it is shut.

### Viewport units: svh, not dvh

`svh` is the **small** viewport — the one with Safari's toolbars showing. It
is both the honest worst case and stable, where `dvh` changes as the toolbar
hides and drags the layout with it mid-scroll. `.rfx-page` uses `100svh`.

A Chromium device descriptor models a fixed height that approximates `svh`,
which is why a measurement here can still read a little optimistic against a
real iPhone. Prefer a layout that responds to the unit over one fitted to a
number.

### The floor

**385×616 was the floor while the demo was always open.** With it collapsed
the page fits every device tested, including 320px ones, so there is no
width floor for the landing page itself.

Two cliffs still exist and matter for the *expanded* demo and for any other
screen:

- **Below 385px** the `≤380px` block narrows the ingredient column
  (`.rd-ing { min-width: 84px; max-width: 104px }`). Names wrap, rows grow,
  and the table gets 51px taller — that rule trades horizontal width for
  vertical height, which is backwards when the constraint is vertical. It is
  the first thing to revisit when small phones get their own layout.
- **Below ~355px** the demo header row wraps to two lines.

### Re-measuring

```js
// in a device-profile context, on the landing page
const cta = document.querySelector('.rd-landing-cta').getBoundingClientRect();
({ collapsedEnd: Math.round(cta.bottom), viewport: window.innerHeight })
// collapsed, this must fit with room to spare on every profile
```

## Cooking order is not section order

**A step never appears in the card sequence after a step that consumes its
output.** `shared/sequence.ts` owns that, and `sequence.test.ts` asserts it
against fixtures and 100+ randomly generated valid trees.

There are **two** kinds of dependency and only one of them is an edge:

- Inside a section, `inputs` names them. Sorting `computeLayout`'s cells by
  (column, row) respects them — but not for the reason StepsMode used to
  claim. Its comment said columns were "1 + max(column of inputs)", which was
  true of an earlier pass and stopped being true when layout began packing
  steps **as late as possible**. The conclusion survived by luck: late packing
  puts every input at exactly its consumer's column minus one, so ascending
  column order is still producer-first. If you change the column passes,
  re-check this — the tests will catch it, the old comment would not have.
- **Between sections there is no edge at all**, because ids never cross a
  section boundary. The link is by *name*: `prompt.ts` tells the model that a
  separately-made component becomes its own section and then appears as an
  ingredient in the consuming section "with a name matching the earlier
  section". Nothing used to order by that.

That second one shipped. A cookie recipe came back as `Dough` then `Dry
ingredients`, with Dough consuming an ingredient named "Dry ingredients".
`validateRecipe` returned no errors and the diagram drew two correct tables —
so it looked fine everywhere except the one place it mattered, where
step-by-step said bake first and mix the dry ingredients last. **A valid tree
and a correct diagram are not evidence that the order is right.**

`sectionOrder` is a stable topological sort over those name links: a recipe
with no components comes out untouched, and a cycle (which a bad parse can
produce) falls back to the original order rather than hanging or dropping a
section.

**Any edit that changes a name can break that link, and nothing else in the
codebase can see it.** `validateRecipe` runs per section, so when the link
goes both sections stay valid, the diagram stays correct, and the only symptom
is step-by-step quietly reordering. Three edits reach it: renaming a section,
deleting a section, and — the one that shipped first and went unnoticed for a
round — **renaming an ingredient**. `brokenComponentLinks(before, after)` in
`shared/edits.ts` is the guard, and it works by diffing the real
`componentLinks` over both trees rather than re-deriving the matching rule, so
what the warning says is what `sequence.ts` will do. If you add an op that can
touch a name, route it through `linkConsequence` and show the result before
the commit. It is a warning and not a refusal on purpose: breaking the link is
sometimes the intent.

## The URL cache: two keys, and one of them is an alias

**This app is paid — one free recipe, then an account, then a subscription —
and the user never bears the API cost.** That single fact decides more than it
looks like it should, so it is worth carrying into any change here: a cache
hit is margin, a cache miss is margin burnt on a page somebody already paid to
read, and a call the *user* triggers is the user spending money on your
behalf. See ROADMAP's "The business model" section before arguing about
whether something is fair to charge for — the question is whether it converts,
not whether it is proportionate.

`extraction_cache` has **two** keys per row:

- `hash` — `sha256("url:" + the raw string)`. **The identity.** Unchanged
  since the cache was written, so every stored row stays addressable.
- `url_key` — `sha256("urlkey:" + normalizeUrl(raw))`, indexed. **An alias.**

`cacheGetUrl` tries the exact key first and only then the alias, and that
order is the safety property, not a micro-optimisation: it means turning
normalisation off is deleting one lookup, with nothing to migrate and no row
made unreachable. Keep it that way. If you find yourself writing the
normalised key into `hash`, stop — you have just made every fold permanent and
irreversible.

**The parameter rule is a DENY-LIST and it must stay one.** Query parameters
are kept unless they are on a list of known-inert tracking tokens. An
allow-list would drop every parameter it had not heard of, which is the
default that serves page 1 to someone who asked for `?page=2`, or a 4-serving
tree to someone who asked for `?servings=8`. `server/lib/urlKey.test.ts` has a
"must NOT fold" block; it is the specification, and a change that makes it
fail is a change that serves the wrong recipe. `ref`, `source` and `campaign`
are deliberately not folded despite reading like trackers.

**Several raw URLs sharing one alias is normal**, so the alias lookup orders
by `created_at DESC` — a page re-read through `/reextract` should win over the
older tree it was re-read to replace.

**Extracted trees never expire, and a cached hit still spends the free
recipe.** Two decisions that look like mistakes and are not. The TTL is gone
because an expiry throws away an extraction already paid for and cannot tell a
good tree from a bad one, while `/reextract` can. The trial charges for a
cached hit because it is not a meter on our cost — it exists to convert, and
someone who never reaches the wall never makes an account. `SEARCH_TTL_MS`
still expires *search results*, which are live URLs and do rot; do not confuse
the two caches.

**Corrections still do not propagate between users**, and that is what the
re-extract hatch bounds: `POST /api/recipes/reextract` re-runs the extractor
and evicts the cached row, signed in only and capped per user per day, because
it is the one route where a user can spend the API budget on purpose. It does
not propagate anyone's *edits* — see ROADMAP #3 for why that still needs
several independent people making the same fix.

## Sync: the server detects, the client resolves

Two devices on one account are a real scenario, and the write path is built
for it — see `shared/sync.ts` for the model and `sync.test.ts` for the
proofs. The rules that must survive any refactor:

- **Every PATCH sends only the fields that changed, plus `ifVersion`.**
  Sending unchanged fields is how a stale device used to clobber a fresh one:
  a mode tap carried yesterday's `done` with it. A stale `ifVersion` gets a
  409 *with the current row*, and the client three-way-merges (base =
  `lastSynced`, which is exactly the base a three-way merge needs) and
  retries. The server never merges — resolution needs the tree and the
  user's intent, which only the client has.
- **`done` merges element-wise against the base, then closure-repairs.**
  Additions from both sides survive (union); a removal by one side beats the
  other's unchanged copy (that is an explicit un-check, honoured in both
  directions); and `enforceClosure` then retracts any completion built on a
  retracted input — the app's own uncheck cascade, applied to the merge.
  Plain union was tried first and resurrection of un-checks is why it lost.
- **Writes are serialized per entry** (one in flight, newest queued), or
  cooking taps race their own `ifVersion` and pay a pointless 409 each.
- **A tree conflict is never quiet.** Mine-wins is the rule, but it is the
  one rule that can discard real work, so both devices are told: the winner
  at merge time, the loser at its next focus refetch (`onSyncNotice`).
- **The focus refetch is load-bearing.** It is what makes most conflicts
  never exist; do not remove it as a "redundant" fetch.

## The visual editor

`shared/edits.ts` is the whole model: `applyEdit(recipe, op)` is pure, and one
op type per operation. Adding, deleting, splitting and merging steps are new
op types against that same signature, not a rewrite.

**A sheet's error message may not take up space.** `.rd-sheet-scrim` is
`align-items: flex-end` and `.rd-sheet` is capped at `86svh`, which makes the
sheet move in two different directions when something is inserted into its
flow: below the cap it grows upward and lifts everything above the insertion
point (19px on an SE, 67px on an iPhone 13, measured); at the cap it scrolls
instead and pushes everything below the insertion point *down* (56px on an
SE, which put "Delete step" partly off screen). Both are larger than the 44px
targets they move, and both straddle a tap — blur fires on pointerdown and
React's `onClick` on pointerup — so committing an invalid label by tapping a
button under it slid a *different* button under the finger before it lifted.
Field errors are therefore `position: absolute` against their own field, and
`pointer-events: none` so the tap that revealed the message still lands on
what it was aimed at. If you add a field to `EditSheet`, wrap it in `Field`
rather than rendering a message inline.

**That applies to anything that appears next to a field, not just errors.**
The link-consequence warning was written in flow first and moved "Done" by
122px on an SE — same defect, different colour. `Field` takes a `notice` as
well as `messages`, and both share the one absolute slot.

**Not everything in the editor hangs off a cell.** Ingredients and steps are
tapped directly; a section is tapped by its title (`.rd-section-head` becomes
a 44px button in edit mode); and the recipe's own fields are reached from a
button in `.rd-editbar`, because the bar title is 29x16 on an SE and there is
no room in that bar to make a target out of it. Section ops are addressed by
INDEX rather than id — the one asymmetry in `edits.ts` — so the section sheet
closes on any structural op and no index outlives the tree it came from.

**Never re-derive what is a legal edit.** `validMoveTargets` builds the
candidate tree for every step and runs the real `validateRecipe` on each. That
is deliberately more work than checking the two or three invariants by hand,
and it is the point: what lights up during a drag is what will be accepted on
drop, because it is the same call. A hand-written predicate would start
correct and drift the first time `computeLayout` gains a rule, and the symptom
would be a highlighted target that refuses the drop.

**The drag must not reflow anything.** The source cell stays where it is and a
fixed-position ghost follows the pointer. Moving the real `<td>` would relayout
a rowspan table under a fingertip — see the handoff section above for what that
costs. Measured: 68 frames of drag, one distinct table layout.

**`touch-action` cannot solve the scroll conflict, so do not reach for it.**
Set up front it kills frame scrolling in edit mode; set at pickup it does
nothing, because the browser latches `touch-action` when the gesture starts.
The working lever is a non-passive `touchmove` listener on `document` calling
`preventDefault`, attached at pickup — which only works because pickup requires
the finger to have stayed within 10px, inside the browser's own pan slop, so no
native scroll has begun yet. Suppressing native scroll for the whole drag is
also why the drag has to scroll the page itself near the viewport edges: on an
iPhone SE the next step down is already off screen when an ingredient is
centred.

**Edit mode must never be quiet.** Tapping a cell means *mark done* everywhere
else in the app. When it temporarily means something else, the bar, the frame
outline and the hint all say so — someone who wanders in and taps around must
not be left wondering why nothing checks off.

**No edit cascades.** Deleting an ingredient that is a step's only input
leaves the step with no inputs and `validateRecipe` refuses it, with
`deleteIngredientBlocker` turning that into a sentence that names the step
and points at "delete the step" — which splices its inputs into its consumer.
One tap removing two things is a destructive reading of "delete", and the
un-cascading version composes: the two-tap path reaches the same tree.

**The recipe screen has ~240px of headroom left on an iPhone SE, and that is
the budget for anything new above the diagram.** Measured: the bar (65px),
the rating and meal-type row (44px + margin) and the servings block (81px)
put the first table at **y=327 of 568**, and the table itself is ~181px, so it
ends at 508. That is most of the room gone. Anything else wanting to sit above
the diagram — a note, a timer, a second control — has to either replace
something or go somewhere else, and the honest options are the overflow menu,
the edit bar (which exists only in edit mode and already absorbed a button at
zero cost), or below the diagram. Measure before adding, and say the number.

**The servings stepper writes `entry.servings` ONLY**, and lives above the
first section rather than in the badge row — it is the control that changes
every number in the tables, not a standing fact about the recipe like the
rating and the meal type. It steps by `base/8` rounded, not by 1: a serves-4
dinner still steps by 1, but a 24-cookie batch stepped by 1 takes twelve taps
to halve and produces multipliers no kitchen can measure.

**`recipe.servings` and `entry.servings` are different numbers and one
control must never write both.** `recipe.servings` is what the recipe makes
(a correction, edited in the recipe sheet); `entry.servings` is what you are
cooking tonight; and `scale` — which every amount in the diagram is rendered
through — is the second divided by the first. Wire one stepper to both and
`scale` is pinned at exactly 1 for ever: scaling stops working, every amount
still looks right, and nothing reports it. Correcting `recipe.servings` clears `entry.servings` in the same update
(`applyOp` in RecipeView): "8" expressed against a base of 4 meant double, and
against a corrected base of 6 it silently means 1.33x, moving every amount on
the page because of an edit to a different field.

**`minutes` and `tempF` are the only numbers in a stored recipe that
`validateRecipe` has no opinion on**, and they are now typed by hand. Render
them through `formatMinutes`/`stepMinutes` in `shared/amounts.ts`, never
`step.minutes ?` — a string is truthy, which is what every call site used to
test, and `"12 min" * 60_000` is the NaN that reaches the timer.

**Editing is on for the trial recipe, and that took a server route.** It has
no library row, but it does have a row — parked under the trial id until
sign-up claims it — and `PATCH /api/trial/recipe` writes to that one. So an
edit made before signing up is the edit the account gets. The trial id comes
from the httpOnly cookie and never from the body, and the WHERE clause keeps
`user_id IS NULL`, so a claimed trial is refused rather than written to by
whoever still holds the old cookie.

### Writes are confirmed, not assumed

`saveLibrary` advances `lastSynced` per entry only when that entry's write
resolves, and `onSyncFailure` reports the rest. Before the editor this barely
mattered — the JSON editor validated before saving, so a 422 was close to
unreachable, and failures went to `console.error` while `lastSynced` recorded
them as synced, meaning they were never retried. A live editor makes that path
reachable, and an edit that silently vanishes is the worst thing this file can
produce. If you add a writer, make sure a rejection rolls the entry back to
`lastAcceptedEntry(id)` and tells the user.

## The demo teaches through a wrapper, not a fork

`DemoCoach.tsx` is a layer *around* `Diagram.tsx` and `StepsMode.tsx`. It
reads the same `done` set they are driven by and derives everything else from
the recipe graph. It must not:

- query or depend on Diagram's DOM or class names (an earlier design anchored
  tips to `.rd-op.is-ready`; that couples the coaching to markup that is free
  to change)
- import `shared/layout.ts`
- fork or modify Diagram, StepsMode or RecipeView

`RecipeView` in particular is a page shell around an `Entry` — back link,
delete, clear progress — so it cannot be reused for the landing demo. Card
mode there is `StepsMode` driven by a synthetic in-memory entry that never
reaches `storage.ts`.

## Demo state never persists

Landing page progress lives in component state and dies with the component:
no API calls, no rows, nothing in the library. The single exception is the
pending recipe URL (`lib/pendingUrl.ts`), which is in `sessionStorage`
because it has to survive the navigation that sign-up will eventually be.
