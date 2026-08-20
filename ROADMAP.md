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

It is **operational, not behavioural**: no user id, no trial id, and host
rather than URL. That is a boundary, not an oversight — a column identifying a
person would turn it into a record of what people read, with a retention
policy attached, in exchange for answering nothing it does not already answer.
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
See `server/lib/urlKey.ts`.

**Correctness is the constraint and it is expressed as a DENY-LIST.** Query
parameters are kept unless they are on a list of known-inert tracking tokens
(`utm_*`, `fbclid`, `gclid`, `mc_cid`, `_ga`, `amp`, …). Never an allow-list:
`?page=2`, `?print=1` and `?servings=6` select content, and an allow-list gets
that backwards by default — it would silently drop every parameter it had not
heard of, on exactly the pages where the parameter mattered. Three that read
like trackers are deliberately NOT folded — `ref`, `source`, `campaign` — for
the same reason. `server/lib/urlKey.test.ts` has a "must NOT fold" block that
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
8. **Apple sign-in** (#1) — no rush until the App Store build is real, and it
   needs an https callback on a verified domain, so it cannot be done here.
9. **Variations at the prompt level** (#5, cheap version).
10. **Recipe builder** (#4) — mostly falls out of #6 once editing is complete.
11. **Structural variation comparison** (#5, real version) — needs the corpus
    #3 produces.

---

## 9. A loading state for extraction

**Status:** built. `client/src/components/ExtractionProgress.tsx`. Before it,
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

## Still open from earlier work

- ~~**The servings stepper does not exist, and scaling is unreachable.**~~
  **Done.** `client/src/components/ServingsRow.tsx`, above the first section
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

  `snapQty(q, unit)` in `shared/amounts.ts` is the rule, and it is per-unit
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
  `client/src/components` uses them. So halving or doubling a recipe is a
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
  `client/src/components/ReorderView.tsx`, entered from a Reorder button in
  steps mode. The model is a stored preference the walk consults
  (`entry.order` / `recipes.card_order`, an `OrderPreference` from
  `shared/sequence.ts`): section names ranked as a TIE-BREAK inside the same
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
  `shared/layout.ts` declares the union type at the top and the runtime set
  near `validateRecipe`, and nothing enforces that they match — a unit added
  to one and not the other either fails to typecheck at the call site or is
  silently rejected by the validator. Deriving one from the other (a `const`
  array, `typeof UNITS[number]` for the type) is a small change now and an
  annoying one once a third list appears. Surfaced when the editor's unit
  picker needed the set at runtime.
- **`recipes.timer` is never cleared when a timer finishes.** Small, real,
  and independent of Phase B. `StepsMode`'s completion effect fires the
  in-page banner and nothing else — it does not PATCH, so the row keeps a
  past `endsAt` for ever. Two visible consequences: `notifiedForRef` is
  component-local, so leaving and re-entering steps mode re-fires the alert
  for a timer that finished yesterday; and every recipe anyone has ever timed
  carries permanent stale state.

  The fix is to write `timer: null` once, on the same transition that already
  fires the notification. What makes it worth its own line rather than a
  drive-by: it is a WRITE on a path that currently only reads, so it has to
  go through the normal `onUpdate` / `ifVersion` route, and `mergeTimer`
  already has an opinion about a null timer (an explicit cancel wins over a
  running one). Clearing on completion looks identical to a cancel from
  another device's point of view. Probably fine — both mean "this timer is
  over" — but it wants checking against `sync.test.ts` rather than assuming.

  Phase B does NOT depend on this and deliberately does not read that column;
  see `timer_notifications` in `shared/schema.ts` for the three reasons.

- **Phase B timers: OPEN. The infrastructure is built; the wake-up is not
  paid for.** This is deferred, not solved, and the entry stays here until it
  is.

  **What exists and works:** `push_subscriptions` and `timer_notifications`,
  `server/lib/push.ts` (VAPID send, dead-subscription pruning),
  `server/lib/timerDispatch.ts` (claim, fan-out, retry, sweep), the routes,
  `public/sw.js`, the client subscribe flow, and the Settings control. All of
  it verified against a stub push service over real TLS — sent, pruned on 410,
  retry bounded — and covered by `push.db.test.ts`.

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
  handler and a 192px icon; `public/brand/` has 32/64/180/512). iOS uses the
  180px `apple-touch-icon`, which exists, so the target platform is
  unaffected.

  **What could not be verified in the container**, and has to be checked by
  hand on a real device: that an iPhone actually receives a push. WebKit is
  not installed here and the deployed site is unreachable from the agent
  proxy, so what is proven is registration, subscription round-trip, the
  claim/fan-out/prune logic and the config posture — not delivery.

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
  cooked after the section consuming it. `shared/sequence.ts` now orders
  sections by the name link `prompt.ts` asks for, and `sequence.test.ts`
  fixes the invariant against fixtures and 100+ generated trees.

