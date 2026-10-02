# Next Publish — recipe notes (Oct 2)

One SQL line, one pull, one Publish, then the phone update. From a fresh
Replit shell, in order; each block is one command and what it should print
is under it. The SQL comes FIRST, before the pull: the new server reads a
`recipes.notes` column, and against a database without it every recipes
query fails and every library shows empty (CLAUDE.md "A new column's DDL
runs BEFORE the deploy"). The workspace's own dev server uses production's
database too, which is why it is before the pull and not only before the
Publish.

| Commit | Ships | Needs |
|---|---|---|
| `3909d43` Notes: a person's own notes on a recipe | Server: `recipes.notes` (`{ text }`) rides the library PATCH, both devices' edits kept on a merge; `/api/health` checks the column. Website: "Your notes" under a saved recipe, Edit/Save in place; privacy "Your recipes and cooking progress" and "Deleting your account" mention notes, dated October 2. Phone: ⋮ › Notes, the note under the diagram and above Step-by-Step's first card, a one-line strip at the top of the diagram where it costs no room, a margin line on the Recipe Box page, Recipe Box search matches notes. README "Recipe notes" | Step 2's SQL **before** the pull; this Publish; the phone part rides the next over-the-air update (preview, then promote — step 10 on) |
| `5f0524a` Notes: a note on any step, on its card | Server: the same `recipes.notes` column also takes `steps` (a note per step id); a tree edit that deletes a step moves its note into the recipe's note. Website and phone: a note on each Step-by-Step card ("+ Add a note to this step", or the note with Edit), step notes listed under the recipe's note. No new SQL | This Publish (server FIRST: the old server refuses a step note with a 400); the phone part rides the same over-the-air update |
| the docs commit that wrote this section | Nothing that runs | Nothing |
| `34405fa` Privacy: say what push, search and the extraction log already collect | Website only: `privacy.html` says timer notifications store the device's model and app version (the browser's user agent on the web), that search words go to Anthropic without the account and results are kept up to 30 days, and that the extraction log records the website's name. Wording only, matching what the code already did | This Publish; nothing on the phone |
| `65e0146` Icon: the plain pot with steam | Website: favicon, home-screen icon and nav mark become the new pot. Phone: the app icon and the sign-in mark, which are in the BINARY, so they reach phones only with the next native build (the launch build). The opening sequence is unchanged | This Publish for the website; the launch build for the phone. No `expo.version` bump (nothing a bundle calls) |
| `a614705` Opening sequence: the pot without its bars | Phone only: the intro's pot loses the four bars, matching the new icon; the pour is unchanged | The next over-the-air update (preview, then promote); nothing on the server |

The only native change is the icon, which waits for the launch build; nothing here needs an `expo.version` bump.

**1.**
```sh
cd ~/workspace
```

**2.** The notes column, on production, BEFORE the pull (safe to run
twice):
```sh
psql "$DATABASE_URL" -c "alter table recipes add column if not exists notes jsonb"
```
Prints `ALTER TABLE` (or `NOTICE … already exists, skipping` on a second
run).

**3.**
```sh
git pull
```
A fast-forward; among the files, `lib/recipe-model/src/notes.ts`.

**4.**
```sh
git log --oneline -15
```
Must list `3909d43` and `5f0524a`. Note the TOP line's short hash: steps 7 and 8 must
show it.

**5.**
```sh
node scripts/check-workspace-links.mjs
```
Prints nothing (no new packages). If it names anything, run `pnpm install`
and then this again.

**6.** Deployments → **Publish**. Wait for it to finish.

**7.** Health through the website's hostname:
```sh
curl -s https://recipereduction.com/api/health; echo
```
`"commit"` must be the hash from step 4, and `"schema":{"ok":true,"missing":[]}`.
If `missing` names `recipes.notes`, step 2 did not run against this
database: run it now.

**8.** Health through the phone app's hostname:
```sh
curl -s https://recipe-reduction.replit.app/api/health; echo
```
The same commit and `"missing":[]`.

**9.** The website, by hand: open https://recipereduction.com, sign in,
open a saved recipe. Under it: "Add a note" with an **Add** button. Add a
line, **Save**; reload the page and it is still there. Then:
```sh
curl -s https://recipereduction.com/privacy.html | grep -c "notes you write"
```
Prints `1`.

**10.** The phone update, to preview first:
```sh
cd ~/workspace/artifacts/reduction-mobile
```
```sh
node scripts/publish-update.mjs --channel preview --message "Recipe notes and step notes"
```
Its `commit` line must match the hash from step 4. Copy the **Group ID** it
ends with.

**11.** On the phone (on preview: fully close and reopen, twice), the
5-minute check further down ("The 5-minute check on the phone"), plus:
open the recipe from step 9 — its note is under the diagram (pulled from
the server, written on the website); ⋮ › **Notes**, add a line, **Done**;
Step-by-Step shows the note above the first card; the Library page for
that recipe ends its ingredients with a ✎ line; searching the Recipe Box
for a word only in the note finds it. Then a step note: Step-by-Step, on
any card **+ Add a note to this step**, type a line, **Done** — the card
shows it as "Your note", and it is listed under the recipe's note.

**12.** All good:
```sh
node scripts/publish-update.mjs --promote <the Group ID>
```
Not good: do NOT promote, and tell Claude what you saw.

---

# Earlier: the reel's legal pages, purge and cap (Oct 1, evening — published Oct 1)

One pull and one Publish, from a fresh Replit shell, in order. Each block
is one command; what it should print is under it. **Two SQL steps.** 1b,
BEFORE the pull, creates the `crash_reports` table (new code needs it
before it runs, CLAUDE.md "A new column's DDL runs BEFORE the deploy").
7b, after the Publish, raises existing accounts to the new three free
recipes and changes no schema. Nothing else touches the database
(`reel_photos` already exists and already has `width`/`height`).

**Until step 5's Publish is live and steps 6–7 show its commit, do NOT add
a third pictured page to the reel** (no `reel.mjs warm --write` of a new
URL). Three cards is the minimum, so a third picture would switch the reel
ON for everyone while the live server still runs the old code: legal pages
that do not mention it, no `hide --purge`, and 1024px copies.

The workspace is at `2a4a641` ("Published your App", on top of `d1a87f0`).
The pull brings, oldest first:

| Commit | Ships | Needs |
|---|---|---|
| `a7958af` Reel: pictures as link previews, and the legal pages say so | Server: reel pictures stored at 480px (1024px copies shrunk in place by the next reel builds, no re-fetch). Website: privacy "Suggested recipes"; terms "Other sites' recipes and pictures" and "Copyright complaints"; both dated October 1. Phone: the card's site line opens the page | This Publish; the phone part rides the next over-the-air update (preview, then promote — "D" below) |
| `df8dfeb` Reel: hide --purge deletes the stored picture; plain hide keeps it | Server + `scripts/reel.mjs`: `hide <url> --purge`; a hidden page is never warmed | This Publish |
| `691cdb5` Terms: a removal request is acted on within three business days | Website: the terms' removal sentence | This Publish |
| `9b8c5c7` Reel: the curated list holds at most 20 | Server + `scripts/reel.mjs`: the 21st curation is refused | This Publish |
| the docs commit that wrote this section | Nothing that runs | Nothing |
| `727b3e7` Web: the landing demo starts with nothing checked | Website: the landing demo opens with nothing checked; the avocados make "halve and scoop" the one amber step | This Publish |
| `df4a092` Web: the demo's coach line is a step instruction, like the phone's | Website: "Demo · Step 1 of 4" over a bold instruction in the landing demo; the two tips are gone | This Publish |
| Billing: three free recipes, up from one | Server: a new account gets 3 free recipes (`FREE_RECIPES`), shared by every way in: link, text, photo, reel starter, the website's signed-out try once claimed; the 402 messages say "free recipes". Website: paywall, landing line after the try, trial bar, terms "The free recipes and subscriptions". Phone: paywall, Settings ("2 free recipes left"), the reel preview's line | This Publish, then step 7b's SQL for EXISTING accounts; the phone part rides the next over-the-air update (preview, then promote) |
| `1e316d7` Contact address: admin@recipereduction.com everywhere | Website: privacy, terms (removal requests, copyright agent) and support mail to the new address. Phone: Send feedback addresses it too | This Publish; the phone part rides the next over-the-air update (preview, then promote) |
| Photos: recipes saved before pictures get their page's picture | Server: `/photo/from-source` reads the page (schema.org `image` or `og:image`, no model call, no free recipe) when a recipe has a source URL but no image URL. Website: cards ask for it. Privacy: "Recipe pictures" says so | This Publish; the phone part rides the next over-the-air update (preview, then promote). On preview: an old recipe's card shows its page's picture after a moment |
| `e6d5e74` Phone: Recipe Box pages fit small phones and large text | Phone only: on a short page (320pt wide with two or more books, or large Dynamic Type) rows give way in order — short pill, one ingredient line, no serves line, no ingredients — and nothing overlaps; bigger phones at the default text size unchanged. ROADMAP "Recipe Box pages on small phones" | Nothing on the server. Rides the next over-the-air update (preview, then promote — "D" below). On preview: three or more books, then Settings › Accessibility › Display & Text Size › Larger Text turned up — no overlaps |
| the docs commit that added steps 10–19 | Nothing that runs: owner steps that replace the reel's two pages with no picture (focaccia, garlic knots) with pictured ones | Steps 10–19, only after step 9 |

| `632f3bc` Crash reports: the phone and the website report their own errors | Server: `POST /api/crash` (scrubbed, anonymous reports, signed in or not, 10 an hour per client, 5,000 a day in all, kept 90 days) and `GET /api/admin/crashes`; `/api/health` checks `crash_reports`. Website: the root error boundary is mounted and reports, with a styled "Something went wrong" and a Reload button; privacy "Technical records" gains the crash-report sentence. Phone: the root error boundary, uncaught JS errors (a fatal one is sent at the next launch) and emergency launches are reported. README "Crash reports" | Step 1b's SQL **before** the pull; this Publish; the phone part rides the next over-the-air update (preview, then promote). Owner: App Store Connect › App Privacy gains Diagnostics › Crash Data — not linked to the user, not used for tracking, App Functionality |

Another thread may push to `main` in between; its commits come with the
pull and are fine. What matters is that the commits above are listed.

**1.**
```sh
cd ~/workspace
```

**1b.** The crash-report table, on production, BEFORE the pull (safe to
run twice):
```sh
psql "$DATABASE_URL" <<'SQL'
create table if not exists crash_reports (
  id bigserial primary key,
  at timestamptz not null default now(),
  fingerprint text not null,
  kind text not null,
  platform text not null,
  name text not null,
  message text not null,
  stack text not null,
  route text,
  app_version text,
  runtime text,
  update_id text,
  channel text,
  os_version text
);
create index if not exists crash_reports_at_idx on crash_reports (at);
create index if not exists crash_reports_fingerprint_idx on crash_reports (fingerprint);
SQL
```
Prints `CREATE TABLE` and two `CREATE INDEX` (or `NOTICE … already exists,
skipping` on a second run).

**2.**
```sh
git pull
```
A fast-forward; among the files, `artifacts/reduction/public/terms.html`
and `artifacts/api-server/src/lib/reelPhotos.ts`.

**3.**
```sh
git log --oneline -8
```
Must list `9b8c5c7`, `691cdb5`, `df8dfeb` and `a7958af` above `2a4a641`.
Note the TOP line's short hash: steps 6 and 7 must show it.

**4.** Nothing new to install, but the check is cheap:
```sh
node scripts/check-workspace-links.mjs
```
Prints nothing when every dependency is in place. If it names anything,
run `pnpm install` and then this again.

**5.** Deployments → **Publish**. Wait for it to finish.

**6.** Health through the website's hostname:
```sh
curl -s https://recipereduction.com/api/health; echo
```
`"commit"` must be the hash from step 3, and `"schema":{"ok":true,"missing":[]}`.

**7.** Health through the phone app's hostname (the app talks to this one):
```sh
curl -s https://recipe-reduction.replit.app/api/health; echo
```
The same commit and `"missing":[]`. A different commit here means this
hostname still serves the old deployment — wait a minute and repeat.

**7b.** Existing accounts get the three free recipes too (new accounts
already do, from the code). Safe to run twice: it only raises an
allowance below 3, so an account a coupon already took to 3 or more keeps
what it has:
```sh
psql "$DATABASE_URL" <<'SQL'
update account_access set recipe_allowance = 3, updated_at = now() where recipe_allowance < 3;
alter table account_access alter column recipe_allowance set default 3;
SQL
```
Prints `UPDATE n` (the number of accounts raised; `UPDATE 0` on a second
run) and `ALTER TABLE`. Then:
```sh
psql "$DATABASE_URL" -c "select recipe_allowance, count(*) from account_access group by 1 order by 1"
```
No row with a `recipe_allowance` below 3.

**8.** The new wording is live (each should print `1`):
```sh
curl -s https://recipereduction.com/terms.html | grep -c "three business days"
```
```sh
curl -s https://recipereduction.com/privacy.html | grep -c "Suggested recipes"
```
```sh
curl -s https://recipereduction.com/terms.html | grep -c "three recipes free of charge"
```
```sh
curl -s https://recipereduction.com/privacy.html | grep -c "short technical report"
```

**8a.** The crash reports can be read (empty is fine):
```sh
curl -s -H "x-admin-secret: $ADMIN_SECRET" "$PUBLIC_BASE_URL/api/admin/crashes?days=7"; echo
```
Prints `{"days":7,"total":0,"groups":[]}` or, if anything has broken since,
the groups. A `schema_behind` answer means step 1b did not run.

**8b.** The website's demo, by hand: open https://recipereduction.com
signed out (a private window), tap "See guacamole as a reduction (demo)".
Nothing is checked, and the line reads "Demo · Step 1 of 4 / Tap the ripe
avocados to check them off." Tap the avocados: "halve and scoop" is the
only amber step and the line moves to Step 2. If the old line ("Guacamole,
as a diagram…") shows, the browser has the old page cached: reload.

**9.** The owner's list, with the cap:
```sh
node scripts/reel.mjs preview
```
The last line reads `Owner list: N of 20 curated, M hidden.` If N is above
20, nothing was dropped — new curations are refused until it is under 20.

Only now may a third pictured page be added. To answer a removal request
from here on: `node scripts/reel.mjs hide <url> --purge` (never a plain
`hide`: the terms promise our copy is deleted).

### After step 9: swap the two pages with no picture for pictured ones

*(Oct 2: the Publish above is live, so these steps are free to run. Whether
they have been run is not recorded; `node scripts/reel.mjs preview` prints a
"No stored picture" list, and focaccia or garlic knots still on it means
not yet.)*

The focaccia and garlic-knots pages are on the curated list but can never
show (neither has a stored picture: their sites refuse our server, and
the fallback that read them never records one), so they hold two of the 20 slots for nothing. These steps take
them off and add pictured pages in their place. **Only after step 9**: the
first new picture can switch the reel on for everyone. About 50 cents in
model calls for the eight candidates below; every other step is free.

**10.** From the workspace (a new shell starts elsewhere):
```sh
cd ~/workspace
```

**11.** The pages that cannot show:
```sh
node scripts/reel.mjs preview
```
Under "No stored picture" it names the focaccia and the garlic knots
(nothing else should be there). Note the `N` in the last line, `Owner
list: N of 20 curated`.

**12.** Find their lines in your list:
```sh
grep -n -i -E "focaccia|knot" reel-urls.txt
```
Two lines, each a URL. Run step 13 once for each of those two URLs.

**13.** Take one off the reel for good (no picture is stored, so there is
nothing to purge):
```sh
node scripts/reel.mjs hide PASTE-THE-URL-HERE
```
One line of JSON with `"ok":true` and `"status":"hidden"`.

**14.** Delete those two lines from the list file (it removes only lines
naming focaccia or knots, the two step 12 showed):
```sh
sed -i -E '/focaccia|knot/Id' reel-urls.txt
```
Prints nothing. Running step 12 again prints nothing.

**15.** The replacement candidates, in a file of their own (`reel-*.txt`
is gitignored, so this stays out of the repo):
```sh
cat > reel-replacements.txt <<'EOF'
https://www.recipetineats.com/easy-yeast-bread-recipe-no-knead/
https://tastesbetterfromscratch.com/no-knead-bread/
https://www.onceuponachef.com/recipes/white-chicken-chili.html
https://www.recipetineats.com/roast-chicken/
https://joyfoodsunshine.com/best-pancake-recipe/
https://tastesbetterfromscratch.com/our-favorite-banana-bread/
https://cookieandkate.com/amazing-chocolate-chip-cookies/
https://www.onceuponachef.com/recipes/banana-pancakes.html
EOF
```
Prints nothing.

**16.** The free report (reads nothing, spends nothing):
```sh
node scripts/reel.mjs warm --candidates reel-replacements.txt
```
One line per URL: `cached` or `would_extract` with an estimate. Any URL
with a ⚠ "read through the fallback" note is a site that refuses our
server: delete that line from `reel-replacements.txt` (it could never get
a picture). If `N − 2 + the lines left` is over 20, delete lines from the
bottom until it is not.

**17.** Add what is left to your list:
```sh
cat reel-replacements.txt >> reel-urls.txt
```
Prints nothing.

**18.** Extract the new pages once and store every curated page's picture:
```sh
node scripts/reel.mjs warm --write
```
The new URLs say `extracted` and, under each, `picture: stored`. Any that
says `picture: the page names none` or `could not be fetched` instead:
`node scripts/reel.mjs hide <that url>` and delete its line from
`reel-urls.txt`.

**19.** The reel now:
```sh
node scripts/reel.mjs preview
```
At least three cards, none marked `no picture`, and nothing under "No
stored picture". The cards on the phone follow within the hour (the
server's reel cache), or after the app is fully closed and reopened.

The phone's half of `a7958af` (the site link) goes out over the air
AFTER step 7, the usual way: "D. From now on: every update" below.

---

# Earlier: the Sep 30 / Oct 1 Publish (done)

One pull and one Publish for everything pending, from a fresh Replit shell,
in order. Each block is one command; what it should print is under it.

The deployment was last published at `4e29e89`. The pull brings, oldest
first:

| Commit | Ships | Needs |
|---|---|---|
| `f8da606` Server: reel cards carry the book page's summary, counts and picture | Reel cards gain servings, steps, first ingredients, "cooked by" and likes; each page's own picture is stored in `reel_photos` and served at `/api/reel/photo/…`; the warm-up stores curated pictures; `/api/health` checks the new table | The `reel_photos` SQL **before** the pull (step 2) |
| `8de1ebc` Phone: reel cards are Recipe Box pages, drifting | Nothing on the server — phone code | The over-the-air update after the Publish (step 13) |
| `5f881f3` Server: retire the IP diagnostic's tests | Nothing that runs: tests, one comment, ROADMAP | Nothing |
| `f2df1cb` Docs: the pending Publish's steps | Nothing that runs: the first version of this file | Nothing |
| `4ccd674` Publishing: stop building the static Expo Go bundle | The Publish no longer builds or serves the Expo Go page and bundle at `/reduction-mobile/` (the step that timed out on Sep 30). Nothing else changes; the Run button is untouched | Nothing |
| `9bb34d5` Docs: one pull and one Publish | Nothing that runs: the second version of this file | Nothing |
| `84aa85d` Phone: say which code is running, and publish only a current checkout | `scripts/publish-update.mjs` refuses a checkout behind `origin/main` or with uncommitted changes, prints commit/channel/runtime/server, adds the short hash to the message. Settings ends with "Version 1.1.0 (build N)"; the owner's testing sheet opens with *This launch* | The over-the-air update (steps 13–16) |
| `f489ecb` Remove the amber hint under a saved recipe's diagram | The phone's hint (over the air) AND the website's (this Publish) | The Publish (step 5) for the website; the update for the phone |
| `9c56ecb` Phone: dark mode is Cocoa | The phone's new dark palette | The over-the-air update |
| the docs commit that updated this file | Nothing that runs: this file | Nothing |

No commit in this list changes native code, so none needs a new build or
an `expo.version` bump. The one native thing still waiting is the dark
splash colour (ROADMAP "Dark mode: Cocoa"), for the next build.

**Revert of the Expo Go change, if it is ever wanted back:**
`git revert --no-edit 4ccd674` — then Publish. (Tell Claude, so GitHub gets
the same revert.)

**The one thing that could not be checked before this Publish:** whether
Replit requires a mobile artifact to have a production block. If it does,
the Publish shows it in one of three ways, and in every case the live site
and API stay on `4e29e89`, because a failed Publish replaces nothing:
- an error naming `reduction-mobile` or its production/build settings,
  before or at the start of the build;
- the old `@workspace/reduction-mobile … build` / `Starting Metro` lines in
  the build log anyway (Replit filled in a default — the change had no
  effect, and the old timeout risk is back);
- the deploy step failing while waiting for a service on `/reduction-mobile/`
  (port 20274) to answer.
Any of those: run the revert above and Publish again.

Also waiting on the owner, not part of these commits: the two privacy-page
wording edits proposed on Sep 30 (the reel now *shows* counts and page
pictures on Add New).

---

## Before the Publish

**1.** Go to the workspace:
```sh
cd ~/workspace
```

**2.** The SQL, on production, BEFORE the pull (safe to run twice):
```sh
psql "$DATABASE_URL" <<'SQL'
create table if not exists reel_photos (
  url_key text primary key,
  image_url text not null,
  bytes bytea not null,
  media_type text not null,
  width integer not null,
  height integer not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
SQL
```
Prints `CREATE TABLE` (or a `NOTICE … already exists, skipping`).

**3.** Record what `/reduction-mobile/` answers today — the Expo Go landing
page, whose text includes "Preview this app on your phone" (the website's
HTML never contains it):
```sh
curl -s https://recipereduction.com/reduction-mobile/ | grep -c "Preview this app on your phone"
```
```sh
curl -s https://recipe-reduction.replit.app/reduction-mobile/ | grep -c "Preview this app on your phone"
```
Today each should print `1`. (A `0` here means that hostname does not route
the Expo Go page at this path; note it — step 9 still expects `0`.)

**4.** Pull:
```sh
git pull
```
Prints a fast-forward; among the files,
`artifacts/reduction-mobile/.replit-artifact/artifact.toml` and
`artifacts/api-server/src/lib/reelPhotos.ts`.
```sh
git log --oneline -11
```
Must list `9c56ecb`, `f489ecb`, `84aa85d`, `9bb34d5`, `4ccd674`, `f2df1cb`,
`5f881f3`, `8de1ebc` and `f8da606`; the top line is the docs commit that
updated this file. Note the top line's short hash: steps 6, 7 and 15 must
show it.

**5.** Deployments → **Publish**. In the build log there should be **no**
`@workspace/reduction-mobile` build step and no `Starting Metro` or `Metro
timeout` lines. If the Publish fails, see "The one thing that could not be
checked" above.

## After the Publish

**6.** Health through the website's hostname:
```sh
curl -s https://recipereduction.com/api/health; echo
```
`"commit"` must be the hash from step 4, and `"schema":{"ok":true,"missing":[]}`.

**7.** Health through the phone app's hostname (the app talks to this one):
```sh
curl -s https://recipe-reduction.replit.app/api/health; echo
```
The same commit and `"missing":[]`.

**8.** The website: open https://recipereduction.com — it loads; then
https://recipereduction.com/privacy, https://recipereduction.com/terms and
https://recipereduction.com/support.html each open their page. Open a saved
recipe in Diagram view: there is no "Amber means you can do it now…" line
under the diagram any more (edit mode still shows its own line).

**9.** The Expo Go page is gone (whatever status code the site's catch-all
answers with, its text must not be there):
```sh
curl -s https://recipereduction.com/reduction-mobile/ | grep -c "Preview this app on your phone"
```
```sh
curl -s https://recipe-reduction.replit.app/reduction-mobile/ | grep -c "Preview this app on your phone"
```
Each must print `0`.

**10.** Sign-in on the TestFlight app: Settings › Sign out, then sign in with
Google (and Apple, if it is on). It returns to the app, signed in, with the
library there.

**11.** Store the reel's pictures (no model calls — $0). The list lives at
`~/workspace/reel-urls.txt` (Replit clears the home folder between
sessions, so `~/reel-urls.txt` does not survive; the script now defaults to
the workspace copy and says so if it is missing):
```sh
node scripts/reel.mjs warm --write
```
Each page prints `cached $0.000` and a `picture:` line: `stored`, `could
not be fetched` or `the page names none`.

**12.** List the picture links:
```sh
curl -s -H "x-admin-secret: $ADMIN_SECRET" "$PUBLIC_BASE_URL/api/admin/reel" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const c of JSON.parse(s).preview.cards)console.log(c.title+"\n  "+(c.photo?process.env.PUBLIC_BASE_URL+c.photo:"(no picture)"))})'
```
Each title with a `https://recipereduction.com/api/reel/photo/…?v=1` link, or
`(no picture)`. Open the links in a browser signed in to recipereduction.com:
each should be that recipe's own photo.

## The rule: the server first, then the phone

**Every over-the-air update waits for the server Publish it depends on, and
for that Publish's health check.** Deployments › Publish, then both health
checks (steps 6 and 7) showing the commit you pulled and `"missing":[]`,
and only then `publish-update.mjs`. A phone update reaches every installed
app within two launches; a server it expects but does not have is a broken
app on every one of them. (The Find crash of Oct 1 was not this — see
ROADMAP "Find closed the app" — but it is the order that keeps the next
one from being.)

## If an update breaks the phone: rolling back

Read-only first, from `~/workspace/artifacts/reduction-mobile`:
```sh
npx -y eas-cli update:list --branch production --limit 5 --non-interactive
```
The newest group is the bad one; the one below it is the last that worked
(on Oct 1 that is `15cc87cb-eb2c-4963-84cd-4f86e32da7e3`, "Starter reel on
Add New…", published Sep 30 from `dc85229`).

Either, ONLY with the owner's go-ahead:
```sh
npx -y eas-cli update:republish --group 15cc87cb-eb2c-4963-84cd-4f86e32da7e3 --message "Roll back to Sep 30 (Find crash)" --non-interactive
```
— publishes that group's exact bundle again as the newest update: phones go
back to the Sep 30 app (losing whatever came after). Or:
```sh
npx -y eas-cli update:roll-back-to-embedded --branch production --runtime-version 1.1.0 --platform ios --message "Roll back to the build's own code" --non-interactive
```
— phones run the code built into their binary (build 7: Sep 29, older
than the Sep 30 update — the guided demo, reel and Send feedback go too).

**On the preview channel** (from Oct 1, only the owner's phone listens):
pull a bad preview update back by republishing a good group there —
```sh
npx -y eas-cli update:republish --group <a good group id> --destination-channel preview --message "Preview: back to <what>" --non-interactive
```
or simply tap **Back to production** in the testing sheet if Settings still
opens. **Never `roll-back-to-embedded` on preview**: build 7's own code has
no channel switch in it, so the phone would sit on preview with no way
back but deleting the app and reinstalling it from TestFlight (which also
works, always: it deletes the saved channel).

Verify: `update:list` again shows the new group on top with that message;
on the phone, open the app WITHOUT touching the broken screen, fully close
it, open it again — the second launch runs the rollback. A bad update that
crashes only on one screen does not trigger expo-updates' own automatic
rollback (that covers a crash during launch), which is why the phone needs
those two launches.

## The over-the-air update

Why the last one did not show is not visible from the repo: every feature
is on `main` and a bundle built from `main` contains them all (ROADMAP "An
over-the-air update that did not show"). Steps 13–14 read what was
published and what is installed; paste their output to Claude. They change
nothing.

**13.** Go to the app's folder:
```sh
cd ~/workspace/artifacts/reduction-mobile
```
```sh
npx -y eas-cli whoami
```
Must print `seans-apps`; if not, run `npx -y eas-cli login --no-browser`
first.

**14.** Read-only, five commands — paste all the outputs back:
```sh
npx -y eas-cli update:list --branch production --limit 10 --non-interactive
```
Each update's message, runtime version, platform, created time and group
id (this list does NOT print the commit — the next command does). *Look
for:* runtime `1.1.0`; platform `ios`.
```sh
npx -y eas-cli update:view <the newest Group ID from the list> --json
```
*Look for:* `"gitCommitHash"` — it must be `c1ce195` or later for the
guided demo, rename, reel and Send feedback to be in it — and
`"isGitWorkingTreeDirty"`.
```sh
npx -y eas-cli channel:view production --non-interactive
```
Which branch the `production` channel serves. *Expect:* branch
`production`.
```sh
npx -y eas-cli build:list --platform ios --limit 5 --non-interactive
```
Each build's version, build number, runtime version, channel, profile and
commit. *Look for:* the build on your phone (TestFlight shows its build
number) — it must say version `1.1.0`, runtime `1.1.0`, channel
`production`. A `1.0.0` build never receives a `1.1.0` update.
```sh
npx -y eas-cli env:list --environment production
```
Whether EAS holds an `EXPO_PUBLIC_DOMAIN` for production (the script sets
one itself; a different stored value is worth knowing about).

**15.** Publish. The script now runs `git fetch` first and REFUSES if this
checkout is behind GitHub or has uncommitted changes:
```sh
node scripts/publish-update.mjs --message "Version line and update status, amber hint removed, Cocoa dark mode"
```
Prints, before uploading:
```
  commit       <the hash from step 4>  Docs: …
  channel      production
  runtime      1.1.0 (reaches only builds of version 1.1.0: …)
  server       recipe-reduction.replit.app
  message      Version line and update status, amber hint removed, Cocoa dark mode (<hash>)
```
then EAS's output ending in an update group ID. The commit must be the
hash from step 4. If it refuses with "behind origin/main", run `cd
~/workspace`, `git pull`, then `cd ~/workspace/artifacts/reduction-mobile`
and step 15 again. If it refuses over uncommitted changes, run `git status
--short` and send Claude the output — do not reach for `--force`.

**16.** On the phone: **fully close the app (swipe it away in the app
switcher) and reopen it, TWICE.** The first launch downloads the update;
the second runs it. Then:
- Settings, at the very bottom: **"Version 1.1.0 (build N)"** — N is the
  TestFlight build number. If that line is missing, the update is not
  running yet: close and reopen once more.
- Long-press **Replay intro** (owner only) › *This launch*: Running
  `Update xxxxxxxx` (the first 8 characters of the group or update id from
  step 15), Channel `production`, Runtime version `1.1.0`, Published
  today's time in UTC, Update error `none`. `Embedded bundle` means the
  update has not run; `Waiting` means one more close and reopen.
- The guided demo (Settings › How it works) starts with "Start the demo";
  a recipe's title has the rename pencil; Find › Add New shows the reel.
- A saved recipe's Diagram has no amber hint under it.
- In dark mode (Settings › Appearance › Dark): the warm brown page, cells
  with visible edges, cream-but-darker Recipe Box pages.

---

## The Find crash fix (Oct 1) — the next update

The update from step 15 closes the app when Find opens (ROADMAP "Find
closed the app"). Until the fix is on the phone, **Settings › Accessibility
› Motion › Reduce Motion ON** stops the ticker, and Find works.

**1.**
```sh
cd ~/workspace
```
**2.**
```sh
git pull
```
If it stops with "divergent branches": `git pull --no-rebase --no-edit`.
**3.**
```sh
git log --oneline -15 | grep "ticker can no longer close"
```
Must print the fix commit's line: `<hash> Phone: the reel's ticker can no
longer close the app`.
**4.** No server Publish is needed for this one — it is phone code only,
and the server already serves what it reads. Check anyway (the rule above):
```sh
curl -s https://recipe-reduction.replit.app/api/health; echo
```
`"schema":{"ok":true,"missing":[]}`.
**5.**
```sh
cd ~/workspace/artifacts/reduction-mobile
```
```sh
node scripts/publish-update.mjs --message "Fix: Find no longer closes the app (reel ticker)"
```
Its `commit` line must match `git log --oneline -1`.
**6.** On the phone, open the app WITHOUT tapping Find, fully close it, open
it again; then Find › Add New: the reel shows and drifts, nothing closes.
Then turn Reduce Motion back off if you turned it on, and check again.

---

## The channel switch (Oct 1): ship it, set it up, then the new flow

From here every update goes **preview → your phone → promote**. The commit
that adds the switch is the LAST update published straight to production
(it cannot be tested on preview: the switch is what it adds).

### A. Ship the switch (once)

**1.**
```sh
cd ~/workspace
```
**2.**
```sh
git pull
```
If it stops with "divergent branches": `git pull --no-rebase --no-edit`.
**3.**
```sh
git log --oneline -15 | grep -i "owner channel switch"
```
Prints the commit: `<hash> Phone: owner channel switch (preview / production) and promote`.
**4.** Health first (the rule above; nothing on the server changes here):
```sh
curl -s https://recipe-reduction.replit.app/api/health; echo
```
`"missing":[]`.
**5.**
```sh
cd ~/workspace/artifacts/reduction-mobile
```
```sh
node scripts/publish-update.mjs --channel production --message "Owner channel switch; promote flow"
```
**6.** On the phone: fully close and reopen the app, twice. Long-press
Replay intro: under *This launch* there is now **Updates from:
production** with a **Use preview** button.

### B. One-time setup: the preview channel

**1.**
```sh
cd ~/workspace/artifacts/reduction-mobile
```
**2.**
```sh
npx -y eas-cli channel:create preview
```
Prints that channel `preview` was created and pointed at a new branch
`preview`. (If it says the channel already exists, go on.)
**3.**
```sh
npx -y eas-cli channel:view preview --non-interactive
```
Must show `Branch preview` under the channel. If no branch is listed:
```sh
npx -y eas-cli channel:edit preview --branch preview
```
and run step 3 again.

### C. Prove the switch before relying on it

**1. Empty preview first.** Testing sheet › **Use preview**. Expect:
"Preview has no update for this version yet. Staying on production." —
and *Updates from* still says production, Settings has no "· preview".
**2.** Put the same code on preview:
```sh
node scripts/publish-update.mjs --channel preview --message "Preview check"
```
It ends with an update **Group ID** and the promote hint.
**3.** Testing sheet › **Use preview**. Expect: "Checking preview…", then the
app restarts by itself. Then: Settings ends **"Version 1.1.0 (build 7) ·
preview"**; *This launch* shows Channel `preview` and an update id that
starts with the id the publish printed; *Updates from* says **preview —
only this phone**.
**4.** **Back to production**. Expect: a restart; *Updates from:
production*; no "· preview". If the first launch after it shows an older
app (no version line), fully close and reopen once: that is one launch of
the build's own code while production's update downloads.
**5.** Tell Claude what each step showed. If step 1 says "Could not switch
(…)", the iOS override was refused: the switch is unusable on this build
and nothing changed — the fallback is a second TestFlight build on the
preview channel (ROADMAP "Testing updates before they reach other users").

### D. From now on: every update

**1.** `cd ~/workspace`, `git pull`, `git log --oneline -1` (note the hash).
**2.**
```sh
cd ~/workspace/artifacts/reduction-mobile
```
```sh
node scripts/publish-update.mjs --channel preview --message "What changed"
```
Its `commit` line must match the hash from step 1. Copy the **Group ID** it
ends with.
**3.** On the phone: already on preview → fully close and reopen, twice;
on production → testing sheet › **Use preview**. Then the 5-minute check
below.
**4.** All good:
```sh
node scripts/publish-update.mjs --promote <the Group ID>
```
It prints the group, branch `preview`, the commit (with `[on-main]` or
`[empty-on-main]`), the message and runtime, then copies the same bundle
to production. It refuses a group that is not on preview, a commit that is
not on main, and a commit this checkout does not have (run `git pull`).
`--dry-run` shows what it would do.
**5.** Not good: do NOT promote. Fix forward (a new preview publish), or
pull the preview back (the rollback section above), or **Back to
production** on the phone.

### The 5-minute check on the phone (step D3)

On preview, in this order — each line is what it should look like:

1. **Settings, bottom:** "Version 1.1.0 (build 7) · preview". Testing
   sheet: *This launch* — Update, not Embedded; Channel `preview`; Update
   error `none`.
2. **Find › Add New:** opens; the reel of cream recipe pages under the
   photo buttons drifts slowly sideways; touching it stops it; it drifts
   again about 5 s after.
3. **Find › My Recipes and Browse:** both open; the tabs switch without a
   flash.
4. **Library:** the Recipe Box opens on a book; swipe a page, swipe to
   another book; tap a page — the preview window opens.
5. **One saved recipe:** opens on Diagram; tap a ready (red) step — it
   turns green; Step-by-Step shows the next card; Clear progress empties
   it; the title has its pencil.
6. **The demo** (Settings › How it works): opens on "Welcome to
   Reduction." with Start the tour, Skip and Watch instead; nothing on the
   recipe is checked (0/12). Start the tour: step 2 rings the ripe
   avocados; tapping them makes halve and scoop the one amber step. Back
   to the welcome, then Watch instead: a hand glides to each thing and
   taps it; Pause holds it; it ends on "That's it".
7. **Dark mode** (Settings › Appearance › Dark): warm brown page, cells
   with visible edges, Recipe Box pages cream; back to your usual setting.
8. **Fully close and reopen once more:** it opens normally (no crash on
   launch).

Anything closes the app or looks wrong: do not promote.
