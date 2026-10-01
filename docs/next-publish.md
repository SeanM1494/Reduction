# Next Publish — saved Sep 30, updated Oct 1

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
| the docs commit that updated this file | Nothing that runs: this file | Nothing |

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
git log --oneline -7
```
Must list `4ccd674`, `f2df1cb`, `5f881f3`, `8de1ebc` and `f8da606`; the top
line is the docs commit that updated this file. Note the top line's short
hash: steps 6 and 7 must show it.

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
https://recipereduction.com/support.html each open their page.

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

**13.** The over-the-air update (the new reel cards and the ticker) — which
also proves updates still work without the Expo Go build:
```sh
cd ~/workspace/artifacts/reduction-mobile
```
```sh
npx -y eas-cli whoami
```
Must print `seans-apps`; if not, `npx -y eas-cli login --no-browser` first.
```sh
node scripts/publish-update.mjs --message "Reel cards as Recipe Box pages with pictures; ticker"
```
Prints `server       recipe-reduction.replit.app` and `reaches      builds of
version 1.1.0`, then EAS's output ending in an update group ID. Close the
TestFlight app completely and reopen it, twice: Find › Add New shows the
new cards under the photo buttons, drifting sideways.
