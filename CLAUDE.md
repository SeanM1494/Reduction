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

### Where it stands

Measured with Playwright device descriptors, hero-lite in place:

| device | viewport | diagram ends | result |
|---|---|---|---|
| iPhone 13 Pro Max | 428×746 | 696 | fits, 50px spare |
| Pixel 5 | 393×727 | 695 | fits, 32px spare |
| **iPhone 13** | **390×664** | **694** | **short by 30px** |
| Galaxy S9+ | 320×658 | 871 | short by 213px |
| iPhone SE | 320×568 | 871 | short by 303px |

So at 390–430px wide the page needs about **695px of viewport height**. The
most common iPhone gives 664. Hero-lite took the gap from 148px to 30px, and
30px is the last of what tuning can do.

### The 320px cliff

320px is not "a bit narrower", it is a different layout. Three things wrap at
once — the nav to two rows (124px), the demo header to two rows (72px), the
coach line to three lines (48px) — and the table grows taller as its columns
narrow. The requirement jumps from 695px to 871px, which no 320px phone has.

**320px is not a target.** Treat ~360px as the floor for this layout and
design the small-phone experience separately rather than pretending one
layout serves both.

### What sits above the diagram, and what it costs

At 390px, hero-lite:

| | |
|---|---|
| nav | 72px |
| hero (one line, subheading hidden) | 25px |
| demo header row (mode toggle, Watch it, Reset) | 33px |
| coach line | 32px |
| section head ("01 Guacamole") | 15px + 12px margin |
| the diagram itself | 445px |

The `≤520px` block in `index.css` has already spent the obvious savings: the
tip slot reserves no space, tips overlay rather than displace (measured: in
flow a two-line tip pushed the diagram down 57px and back up on dismissal),
the controls stay on one row, the brand wordmark is dropped so sign-in fits
in the nav, and the hero is one line with no subheading.

There is nothing cheap left. Closing the last 30px means removing an element,
not tightening one — which is a design decision, and the reason a phone-first
reordering (diagram first, copy below it) is worth considering over further
compression.

If something must go below the fold, the legend goes first and the diagram
never does.

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
