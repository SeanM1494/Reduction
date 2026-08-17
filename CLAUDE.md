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

Local passing is necessary and not sufficient: verify the deployed URL too,
because the last three mobile bugs all passed locally.

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

## The landing page has a fold budget

`LandingPage.tsx` has one hard layout requirement: **the whole demo diagram
must be visible without scrolling on a phone**. A first-time visitor who has
to scroll to see the thing the page is demonstrating has already been failed
by it.

**This is currently NOT met, and the reason is worth knowing.** The budget was
measured for a long time against 390×844 — the iPhone 13's *screen*. The real
Safari viewport is 390×664. Against the correct number the diagram ends at
812px, which is **148px below the fold**; on an iPhone SE (320×568) it is over
400px below. It passed every check because every check used the wrong height.

What sits above the diagram, on a phone, and what each costs:

| | |
|---|---|
| nav | ~72px |
| hero title + subheading + margins | ~169px |
| demo header row (mode toggle, Watch it, Reset) | ~43px |
| coach line | ~33px |
| section head ("01 Guacamole") | ~27px |

Anything that adds height above the diagram spends budget that is already
overdrawn: copy that wraps to another line, the coach line growing past one
line, another control in the demo header, padding changes on
`.rd-landing-hero` / `.rd-landing-demo`.

The `≤520px` block in `index.css` already spent the obvious savings: the tip
slot does not reserve space, the controls stay on one row, the hero is
tightened, tips overlay the diagram rather than displacing it (measured: in
flow, a two-line tip pushed the diagram down 57px and back up on dismissal),
and the brand wordmark is dropped so sign-in fits in the nav. There is no easy
padding left — closing a 148px gap means giving something up, and that is a
design decision rather than a tuning one.

If something has to go below the fold, the legend goes first and the diagram
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
