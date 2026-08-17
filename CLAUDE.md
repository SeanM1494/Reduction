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

`npm test` reports **13 passing and 7 skipped without a database**. The seven
are the claim's transactional guarantees in `server/lib/claim.db.test.ts` —
all-or-nothing rollback, idempotent repeat claims, never taking another
user's rows — and they skip when `DATABASE_URL` is unset or unreachable so
the suite stays green on a machine without Postgres.

**They have been run against a real database and all seven pass: 20 passing,
0 skipped.** So a skipped count of 7 means "no database here", not "unproven"
— no need to flag it as an outstanding risk again. Do re-run them with
`DATABASE_URL` set after changing anything in `claim.ts`, since a skipped
rollback test proves nothing about a change made after it last ran.

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
- The fold budget below is part of this rule, not a separate concern.

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
4. Re-measure the fold (below).
5. Check the same screens on the deployed site once it ships.

## The landing page fold budget

Measured against the **browser viewport**, which on a phone is not the screen.
An iPhone 13 is a 390×844 device and a **390×664** viewport once Safari's URL
bar and toolbar are showing. Every number here is a viewport number.

The requirement: **the whole demo diagram visible without scrolling.** A
first-time visitor who has to scroll to see the thing the page demonstrates
has already been failed by it.

### The page has two reading orders, and both are deliberate

`.rd-landing-flow` is a flex column with explicit `order` on each block:

| | desktop | phone (≤520px) |
|---|---|---|
| notes (saved-on-this-device / signed-out) | 2 | 1 |
| hero (title + subheading) | 1 | 3 |
| demo | 3 | 2 |
| call to action | 4 | 4 |

On a phone **the diagram is the hero**. A 664px viewport cannot hold copy and
a legible diagram both, and the demo makes the argument the copy was only
describing — so the pitch moves below it, where scrolling is expected and
height is free. Neither order is inherited from the other; changing one does
not silently change the other.

Two consequences to keep in mind when editing:

- **The coach line is the headline on a phone.** Its empty state is the first
  sentence anyone reads, which is why it names the dish ("Guacamole, as a
  diagram. Tap any ingredient to check it off.") rather than being a bare
  instruction. Keep it to two lines at 390px.
- **The section head is hidden on the landing page** at ≤520px. "01 Guacamole"
  is desktop chrome above a diagram that is now the first thing on the page.
  `Diagram.tsx` renders it and is off limits, so it is hidden in CSS, scoped
  to `.rd-landing` where there is one section and nothing to enumerate.

### Where it stands

Diagram bottom vs viewport. "With note" is a returning visitor, who also gets
the saved-recipes line above the demo:

| device | viewport | ends | with note | result |
|---|---|---|---|---|
| iPhone 13 Pro Max | 428×746 | 616 | 647 | fits, +130 / +99 |
| Pixel 5 | 393×727 | 616 | 647 | fits, +111 / +80 |
| **iPhone 13** | **390×664** | **616** | **647** | **fits, +48 / +17** |
| 360 wide | — | 667 | 698 | needs more height than 360px phones have |
| Galaxy S9+ | 320×658 | 758 | 789 | short by 100 / 131 |
| iPhone SE | 320×568 | 758 | 789 | short by 190 / 221 |

The inversion took the requirement at 390px from **695px to 616px**. Before
it, the most common iPhone was 30px short even with a compressed hero.

### The floor is 385px wide, not 360

Two cliffs, both measured by sweeping widths at a fixed height:

- **Below 385px** the `≤380px` block narrows the ingredient column
  (`.rd-ing { min-width: 84px; max-width: 104px }`). Names wrap more, rows
  grow, and the table gets **51px taller** — the rule trades horizontal width
  for vertical height, which is backwards now that the constraint is vertical.
  Requirement jumps 616 → 667.
- **Below ~355px** the demo header row wraps to two lines: 667 → 706.

So **385×616 is the supported floor**, and every common phone at 390px and up
clears it. 320–380px devices are explicitly **not a target**: they need their
own layout, and the `≤380px` rules above are the first thing to revisit when
that happens. Do not let them constrain this layout.

### Re-measuring

```js
// in a device-profile context, on the landing page
const r = document.querySelector('.rd-table').getBoundingClientRect();
({ bottom: Math.round(r.bottom), viewport: window.innerHeight })
// bottom must be <= viewport, at every device profile above
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
