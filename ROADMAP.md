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

**Apple has not been started.** It needs an https callback on a verified
domain, so it cannot be tested locally. Required if this ships to the iOS App
Store alongside another provider, which is the plan.

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

**Stage one — cached trees in search results.** A search checks the
extraction cache before offering to extract. A match renders instantly,
costs no API call, and exposes nothing about anybody: it is the same
cached tree a URL paste already serves today, surfaced somewhere new. No
visibility question arises, so this needs no further decision.

**Stage two — the count.** "3 other people saved this" as a ranking
signal and a badge on a result. This is where one account's behaviour
becomes visible to another, in aggregate only. Needs a saved-count per
canonical recipe, which is derivable from `recipes` rather than a new
table.

Ratings (#8) are the natural companion to stage two: "people cooked this
twice" is a better sort than relevance, and better than a raw save count.

### Two pieces of cache work, and the order is the point

Both were surfaced by a real bug: a cookie recipe parsed badly, and
re-submitting the same link produced a *different, correct* tree instead of
the cached one. Neither is built. **The order below is the decision, not an
accident** — doing them the other way round makes the product worse.

**First: a correction replaces the cached tree.**

Today the cached tree and the user's library row are separate copies.
`extraction_cache` is written once by `cacheSet` in `server/routes/recipes.ts`
and never touched again; fixing a recipe in the visual editor (#6) updates
only `recipes.recipe` for that one user. So the next person to paste the same
link still gets the original bad parse, for the rest of the 30-day TTL.

This is newly worth building because the editor now exists — before it, there
were no corrections to propagate. The open questions come from #6 and should
be settled there first: only a *correction* propagates, never a *fork*; and a
correction should need several independent people making the same fix rather
than one report, which costs nothing to require and stops one confident cook
rewriting a recipe for everyone.

**Then: URL normalisation.**

There is none at all. The key is `sha256("url:" + the raw string)`, so a
trailing slash, a `utm_`/`fbclid` parameter, `http` vs `https`, `www.` or a
`#fragment` each pay for a fresh extraction — and are also why the same link
can come back as two different trees on two submissions.

**Why it waits.** Normalising multiplies cache hits, and until corrections
propagate it multiplies the blast radius of a bad parse along with them: a
fresh extraction costs pennies, while a wrong tree that everyone inherits for
30 days is a bad experience for every future user of that URL. Once a
correction can replace the cached version, more hits are straightforwardly
good and this becomes a tidy-up rather than a trade.

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
`shared/edits.ts` builds the candidate tree for every step and runs the real
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

**Still only reachable through the raw JSON editor**, which is why it stays,
now labelled *Advanced: edit raw data*: adding, deleting, splitting and
merging steps, and fixing a bad root. Those are the repairs that make a
recipe unusable rather than merely wrong. They are the next op types in
`shared/edits.ts`, against the same `applyEdit(recipe, op)` signature.

**Not available on the free trial recipe.** It has no library row to write
to — App's trial branch deliberately does not POST or PATCH, because the
server already parked the recipe under the trial id. Editing it would change
the screen and nothing else, and signing up would claim the parked copy,
discarding every edit at the moment the user was promised their work was
safe. Making the trial row patchable is the fix; hiding the button is the
honest stopgap.

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
paragraph is in `server/lib/trial.ts` and `shared/schema.ts`, because that is
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
data. It is marked for removal in `server/lib/claim.ts` and comes out only
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
   `shared/sync.ts` and CLAUDE.md's sync section.
2. ~~**The library and bottom nav** (#8)~~ **Done** — see the entry,
   ratings included.
3. **Finish editing** (#6) — adding, deleting, splitting and merging steps.
   These are the repairs that make a recipe *unusable* rather than merely
   wrong, and they are the only reason the raw JSON hatch still exists. New
   op types against the existing `applyEdit(recipe, op)` signature.
4. **Make the trial row patchable**, so the one free recipe can be edited.
   Small, and it is precisely the recipe someone would want to correct.
5. ~~**Public/private decision**~~ **Settled** — libraries private,
   aggregate counts only. See "Visibility — settled" in #3. That splits #3
   into stage one (cached trees in search results, no visibility question at
   all) and stage two (the saved count), which can ship independently.
6. **Corrections replace the cached tree, then URL normalisation** (#3, in
   that order — see the reasoning there).
7. **Cross-user search + cache reuse** (#2 and #3 together) — the same
   feature seen from two sides, and it needs the correction path from step 5
   to be safe.
8. **Apple sign-in** (#1) — no rush until the App Store build is real, and it
   needs an https callback on a verified domain, so it cannot be done here.
9. **Variations at the prompt level** (#5, cheap version).
10. **Recipe builder** (#4) — mostly falls out of #6 once editing is complete.
11. **Structural variation comparison** (#5, real version) — needs the corpus
    #3 produces.

---

## Still open from earlier work

- **The trial recipe cannot be edited.** Disabled deliberately: the trial
  recipe has no library row, so an edit would change the screen only, and
  signup would then claim the parked server copy and discard it — at
  exactly the moment the app promises the work is safe. The fix is making
  the trial row patchable. Worth doing: someone's one free recipe is
  precisely the one they would want to correct.
- **Reordering the step-by-step sequence.** A list view of collapsed
  steps, drag to reorder. Note that card order is *derived*, not stored —
  so a drag can only reorder branches that are genuinely interchangeable
  (the salsa chain vs. the mash chain). Anything else would be a change to
  the tree, which is what the diagram editor already does.
- **`Unit` and `UNITS` are two hand-maintained lists that must agree.**
  `shared/layout.ts` declares the union type at the top and the runtime set
  near `validateRecipe`, and nothing enforces that they match — a unit added
  to one and not the other either fails to typecheck at the call site or is
  silently rejected by the validator. Deriving one from the other (a `const`
  array, `typeof UNITS[number]` for the type) is a small change now and an
  annoying one once a third list appears. Surfaced when the editor's unit
  picker needed the set at runtime.
- Phase B timers: service worker + Web Push for notifications when the
  app is closed. Needs a Reserved VM or external cron, because a
  sleeping Repl cannot fire a scheduled push.

### Closed, kept for the record

- **Pass 3 visual polish** shipped (`9dd9221`): two-layer warm shadows, more
  surface contrast, a stronger ready state, done receding further, louder
  ingredient amounts. The corner treatment it was waiting on was signed off.
- **The card-order invariant** is guaranteed and tested, and it was not
  extraction variance. The walk was sound; the bug was that sections were
  emitted in array order, so a component section ("Dry ingredients") could be
  cooked after the section consuming it. `shared/sequence.ts` now orders
  sections by the name link `prompt.ts` asks for, and `sequence.test.ts`
  fixes the invariant against fixtures and 100+ generated trees.

