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
| **23 pass, 16 skipped** | no `DATABASE_URL`, or nothing listening. Fine. |
| **39 pass, 0 skipped** | a database with a current schema. This is the real gate. |
| ***n* failures naming a missing table** | a reachable database whose schema is behind `shared/schema.ts`. Run `npm run db:push`. |

The 16 are the two claim suites — `claim.db.test.ts` (the anonymous library)
and `trial.db.test.ts` (the free extraction). Both are transactional
guarantees: all-or-nothing rollback, idempotent repeats, never taking another
user's rows. **All 39 have been run against a real Postgres and pass.**

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

## This app is mobile-first

It will ship as an App Store app, and most real use is a phone propped on a
counter in a kitchen. That is the primary target, not a narrow case to
accommodate afterwards.

- **A feature that works on desktop and not on mobile is not done.** Not
  "done with a known issue" — not done.
- **Touch targets are at least 44px.** A 31px control is a desktop button
  that happens to be on a phone.
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
   inside `.rd-frame` on purpose.
3. Confirm every control you touched is at least 44px tall and actually
   reachable — `page.tap()`, not `page.click()`, so a `:hover`-only
   affordance is caught.
4. Re-measure the landing page collapsed (see below).
5. Check the same screens on the deployed site once it ships.

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
