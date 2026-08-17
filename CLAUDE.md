# Working in this repo

Architecture, scripts and deployment are in `README.md` — this file is for
constraints that are easy to break without noticing, because nothing in the
build fails when you do.

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

## The landing page has a fold budget

`LandingPage.tsx` has one hard layout requirement: **the whole demo diagram
must be visible without scrolling on a 390×844 phone** (iPhone 12/13/14
class, the narrowest common size). A first-time visitor who has to scroll to
see the thing the page is demonstrating has already been failed by it.

As of the coaching layer this passes with roughly **43px to spare** — the
diagram ends at 801px of 844. That is not much. Anything that adds height
above the diagram spends it:

- hero title or subheading copy that wraps to another line
- the coach line in `DemoCoach.tsx` growing past one line
- another control in the demo header, or a longer label that wraps the row
- padding or margin changes on `.rd-landing-hero` / `.rd-landing-demo`

**So: re-measure at 390×844 after changing any landing page copy or spacing.**
Wrapping is the usual culprit, and it is invisible on a desktop browser — the
same sentence that fits on one line at 1100px takes three at 390px.

The `≤520px` block in `index.css` already spent the obvious savings: the tip
slot does not reserve space, the controls stay on one row, the hero is
tightened, and tips overlay the diagram rather than displacing it (measured:
in flow, a two-line tip pushed the diagram down 57px and back up on
dismissal). There is no easy padding left to reclaim. If something has to go
below the fold, the legend goes first and the diagram never does.

### Re-measuring

Build, serve, and read the diagram's bottom edge against the viewport:

```js
// with the app served, in a 390x844 browser at the landing page
const r = document.querySelector('.rd-table').getBoundingClientRect();
({ bottom: Math.round(r.bottom), viewport: window.innerHeight })
// bottom must be <= viewport
```

Chromium and Playwright are preinstalled in Claude Code web sessions
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), so this can be scripted with
`npx playwright` without adding a dependency to `package.json` — the app
itself must stay dependency-free here. In a normal browser, devtools device
emulation at 390×844 is equivalent.

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
