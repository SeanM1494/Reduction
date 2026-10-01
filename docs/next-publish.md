# Next Publish — saved Sep 30, updated Oct 1 (twice)

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

**11.** Store the reel's pictures (no model calls — $0):
```sh
node scripts/reel.mjs warm ~/reel-urls.txt --write
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
