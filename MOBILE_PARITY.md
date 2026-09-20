# Mobile parity audit — web vs. native, feature by feature

Taken Sep 19 against `artifacts/reduction` (web) and `artifacts/reduction-mobile`
(native), by reading both codebases side by side. Every row was checked against
the actual code; where a delegated read disagreed with the file the file won
(one claim that the diagram's press-and-hold was shorter on mobile was wrong:
`HOLD_MS` is 350 on both). Read with ROADMAP's mobile section, which records
the phases and the calls that were made on purpose; this file records what the
port still lacks, and the decision taken on it.

**Decision (Sep 19):** items 1, 3, 9 and 10 below are fixed before App Store
submission (all four closed Sep 20) — they are what a reviewer or a first user hits within a minute.
Items 2, 4, 5 and 11 follow soon after launch (all four closed Sep 20). Everything else waits.

## Missing entirely on mobile

Ordered by how much a user notices. The first four were not logged anywhere as
deferred before this audit.

| # | Feature | Web | Mobile state |
|---|---|---|---|
| 1 | **Progressive collapse, finish strip and handoff in the diagram** | `Diagram.tsx` folds a finished branch into one chip once its sibling inputs are done, pulls the tail steps (bake, chill, slice) out of the table into a numbered strip with their minutes, and tucks the table away once every ingredient has combined | **CLOSED Sep 20.** The derivation moved into `lib/recipe-model/src/collapse.ts` (under test, pinned to the web's behaviour) and both renderers call it. `DiagramView` draws chips that reopen on tap, a table that fills the frame once it is chips alone, the tucked card with Show diagram / Tuck the diagram away, and `FinishStrip.tsx`: numbered rows with minutes that toggle, open the step sheet in edit mode, and take a drop from the drag. No height animation (first cut). |
| 2 | **Search** | `SearchBar.tsx`: local filter over title, source and ingredient names, plus "Search the web" with "Instant" badges for cached pages | **CLOSED Sep 20.** `components/SearchBar.tsx` at the top of the Find tab: `searchLibrary` (in `lib/libraryView.ts`, under test) over the library, the web row from three characters, result cards with the Instant badge, a picked result extracted into the draft with its own wait line and its own error. |
| 3 | **Extraction progress messages** | `ExtractionProgress.tsx`: five rotating stage lines at 3s over the 10–30s wait (ROADMAP #9) | **CLOSED Sep 20.** `lib/extractionStage.ts` (the web's stages verbatim, under test) and `components/ExtractionProgress.tsx`, under the paste box's and the photo picker's own buttons, fixed height, live region. |
| 4 | **Account ID with copy button** | `AccountId.tsx` in Settings, plus the "N recipes in your library" line | **CLOSED Sep 20.** `components/settings/AccountId.tsx` (expo-clipboard, required lazily so a dev build without the module falls back to the share sheet) and the count line in the Account card. |
| 5 | **Theme control** | Light / Dark / Colorblind, persisted (`ThemeToggle.tsx`, `lib/theme.ts`) | **CLOSED Sep 20.** An Appearance card in Settings with System / Light / Dark / Colorblind (System is the visible form of the web's unmade choice — DECIDED Sep 20, keep it: people expect an app to respect the system theme by default, and showing that as a real choice is more honest than the web's silent tracking; not worth matching the web here), stored in AsyncStorage (`lib/theme-context.tsx`, rule in `lib/themePolicy.ts` under test); the colorblind layer is the web's blue/orange tokens over either base, and a ready cell or strip row also carries the web's triangle mark. |
| 6 | **Read the page again** (re-extract) | Menu item with a confirm sheet and the progress line (`RecipeView.tsx`) | `reextract` in `lib/api.ts`, no caller, no menu item. |
| 7 | **Save as Image** | Menu item; `lib/exportImage.ts` renders a PNG at 2x | No view-shot or sharing dependency. Nothing. |
| 8 | **PDF and other file uploads** | The file input accepts PDF, PNG, GIF and WebP | Camera or photo library only, re-encoded to JPEG (`lib/photo.ts`). No document picker. |
| 9 | **Sign-in resilience** | Offers only the providers `/api/auth/providers` reports configured; maps six server `auth_error` codes to specific sentences (`SignIn.tsx`) | **CLOSED Sep 20.** Providers asked at boot and on the screen; Google gated, Apple "Coming soon" when unconfigured, a hint when neither; the six codes in the web's sentences (`lib/authErrors.ts`, under test). Unknown (unreachable) offers both enabled. |
| 10 | **Diagram accessibility** | Cells are `role=button` with `aria-pressed` and a title; keyboard operable | **CLOSED Sep 20.** Cells, chips and strip rows are toggle buttons with a label of the form "3 ripe avocados, not yet / ready / done", a checked state and the web's hint ("Edit …" buttons in edit mode); a chip says how many steps it folds; the measuring layer and the scroller's copies of the sticky column are hidden from readers so nothing is read twice; the rating is a toolbar of toggle buttons; meal types are a radiogroup and checkboxes; the servings Reset is a 44px button that costs the block no height. Verified through Chromium's ARIA tree; the VoiceOver pass needs the phone. |
| 11 | **The paywall's "Open my recipe" door** | Names the kept recipe and offers a button to open it (`Paywall.tsx`) | **CLOSED Sep 20.** The Find tab hands the wall its newest recipe and a 44px "Open my recipe" button opens it; the lead line now follows the context as the web's does ("Adding a new recipe needs a subscription."). SubscribeBox and the purchase seam untouched. |
| 12 | Hold-progress ring during press-and-hold | `is-pressing` ring over the 350ms hold | Haptics only; nothing paints during the hold. |
| 13 | Card sweep animation; diagram entrance fade and height animation | Yes | The sweep is logged as deferred in ROADMAP. The others were not logged. |
| 14 | Find tab error dismiss | Alert with an × | The error clears only on the next attempt. |

**Deliberately not ported**, recorded in ROADMAP ("Deliberately NOT ported"):
the landing page chrome, the JSON hatch (the visual editor reached parity with
it), the pre-account free trial and `lib/pendingUrl.ts`, the service worker and
the web-push install instructions. **Not applicable on touch:** hover preview
of a tap's blast radius, tooltips, keyboard undo, the print stylesheet.

## Ported but different

Recorded in ROADMAP and marked veto-able there: delete is confirmed in a sheet;
the recipe opens on its stored mode tab instead of the chooser; the Library
shows a sort control and a count instead of a title.

Not recorded before this audit, each worth a decision:

- **Extraction does not save.** The web adds the recipe to the library the
  moment extraction returns (`addRecipe` in `App.tsx`). Mobile shows a draft
  with "Save to Library", and the free recipe is spent on the save. The Sep 19
  entitlement bug came from exactly this difference.
- **Paywall copy ignores context.** Closed with item 11 (Sep 20): the lead
  line follows the context as the web's does.
- **Settings plan line.** "Free recipes used" vs. the web's "Free — 0 of 1
  recipes left". Same fact, less information.
- **Servings Reset is inline text**, not a 44px button (`ServingsRow.tsx`).
  Breaks the touch-target rule in CLAUDE.md.
- **Timer completion** is a haptic on mobile and a web notification on the
  web; background alerts come from server push on both. Mobile also clears a
  step's timer on "Next Step" in the same write, which the web does not — an
  improvement, keep it.
- **Paste has no minimum length** on mobile; the web requires 40 characters
  before "Diagram it" enables.
- **Sync notices** show per screen on mobile and as one banner on the web.
  Same events, different placement.
- **Manage subscription** goes to the App Store page for Apple, the website
  for web-bought, the Stripe portal on the web. Correct per guideline 3.1.1.
- **Uncheck cascade.** The web walks the single parent chain; mobile clears
  the full downstream set. In a tree these are the same set.

## Ported and working

Verified equivalent: the library filter chips, six sorts and the card token for
token (`lib/libraryView.ts` under test); every one of the 14 edit ops in
`lib/recipe-model/src/edits.ts`, every blocker and link-consequence warning,
undo 50 deep, the edit bar; the press-and-hold drag with the validator's own
targets and page auto-scroll; Cook mode including timers, the parallel-work
suggestion, the finish card and the cooked stamp; the Reorder view writing
`entry.order`; servings stepping by base/8; the three-state rating gated on
cooked; meal types; the demo with coach, tips, legend and "Watch it"; coupon
redemption in both places; notification tap opening the recipe; sync with the
409 merge and the tree-conflict notices; the source link as a 44px row; the
error boundary and not-found.

**Mobile has what the web does not:** the 5-minute offline write window, the
disk read cache, pull-to-refresh, camera capture with on-device downscale,
temperature on cook cards, haptics, sign-out confirmation, StoreKit, native
tabs.

## Sizing and order for the pre-submission four

Estimates are for this container's workflow: build, node tests where the piece
is pure, Chromium at the three phone profiles, then the phone for what only a
phone can tell. Total about four to five working days.

**Build order: 3 and 9 first (one day together, both shippable to the dev
build at once), then 1, then 10** — 10 last so the finish strip and the
collapsed chips from 1 are labelled once rather than twice.

### Item 3 — extraction progress messages: about half a day

`lib/extractionStage.ts`, pure, under a node test: the five `STAGES` and
`STAGE_MS` copied verbatim from the web (the copy is load-bearing; ROADMAP #9
carries the retune query), and the stage-index rule (advance every 3s, stop on
the last, reset when inactive). `components/ExtractionProgress.tsx` renders it
with `accessibilityLiveRegion="polite"` at a fixed height, mounted under the
Find tab's button and inside `PhotoPicker` while `busy`. Verified in Chromium
against a slowed extract mock.

### Item 9 — sign-in resilience: about half a day

`fetchProviders` in `lib/api.ts`; `auth-context` loads it at boot beside the
billing config. `SignInScreen` follows the web's rule: Google only when
configured, Apple rendered disabled with "Coming soon" when not (guideline 4.8
means both must be configured before submission anyway — this makes a
misconfigured server visible on the phone instead of a 503 behind a working
button), and the web's hint when neither is. The six server codes on the deep
link (`declined`, `expired`, `bad_callback`, `exchange_failed`, `start_failed`,
`not_configured`) map to the web's sentences from `SignIn.tsx`. Verified in
Chromium with a providers stub.

### Item 1 — collapse, finish strip and handoff: two to three days

The only one with a design step. The derivation — tail extraction, the
sibling-group collapse rule, `treeDone` — lives inside the web's `Diagram.tsx`
component, not in the model package, so the first move is to lift it into
`lib/recipe-model/src/collapse.ts` as a pure function of `(section, done,
expanded)` returning `{ tail, collapsedIds, treeDone }`, pinned by a test
against the web's current output on the guacamole fixture and random trees, and
to make the web `Diagram` call it. That is what stops the two renderers
drifting. Then mobile: pass `collapsedIds` to `computeLayout` (the geometry and
the cell already carry the collapsed kind), an `expanded` set with tap-to-expand
on a chip, a `FinishStrip` component (numbered, minutes through
`formatMinutes`, ready / done / pending states, tap toggles, edit-mode tap
opens the step sheet, and a drop target for the drag — the tail is steps like
any other), the tucked card with "Show diagram" and the "Tuck the diagram away"
button. No height animation in the first cut: the web's measured height swap is
the pattern CLAUDE.md warns about twice, and a `LayoutAnimation` pass can
follow once the geometry is right. The drag's hit-testing (`dragMath.ts`, rows
measured in window space) has to include the strip rows. The demo coach depends
on none of this on either side (checked). Verification: the node test for
structural identity, Chromium at three profiles sampling mid-collapse, and the
phone for feel.

### Item 10 — accessibility: about one day, after item 1

`DiagramCell`: `accessibilityRole="button"`, a label of the form "<name>,
ready" / "done" / "not yet" ("Edit <name>" in edit mode), and
`accessibilityState.checked`; a collapsed chip says "<label>, N steps folded,
expand"; the strip items the same as cells. `RatingControl` becomes a group of
three buttons with `selected` state — `radiogroup` misdescribes a clearable
control. `SheetOption` gains a role prop so `MealTypeSheet` can mark the
primary row `radio` and the "Also" row `checkbox`, each with `checked`.
`ServingsRow`'s Reset becomes a 44px `SheetButton`. Verified through Chromium's
accessibility tree (RN web maps these roles to ARIA); the VoiceOver pass itself
needs the phone.
