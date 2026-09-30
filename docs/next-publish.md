# Next Publish — saved Sep 30

The owner's steps for the Publish that is pending, saved to do later. Run
them in order from a fresh Replit shell. Each block is one command; what it
should print is under it.

The deployment was last published at `4e29e89`. This Publish brings:

| Commit | Ships | Needs |
|---|---|---|
| `f8da606` Server: reel cards carry the book page's summary, counts and picture | Reel cards gain servings, steps, first ingredients, "cooked by" and likes; each page's own picture is stored in `reel_photos` and served at `/api/reel/photo/…`; the warm-up stores curated pictures; `/api/health` checks the new table | The `reel_photos` SQL **before** the pull (step 2) |
| `8de1ebc` Phone: reel cards are Recipe Box pages, drifting | Nothing on the server — phone code | The over-the-air update, after the Publish (step 8) |
| `5f881f3` Server: retire the IP diagnostic's tests | Nothing that runs: tests, one comment, ROADMAP | Nothing |

Also waiting on the owner, not part of these commits: the two privacy-page
wording edits proposed on Sep 30 (the reel now *shows* counts and page
pictures on Add New).

---

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

**3.** Pull:
```sh
git pull
```
Prints a fast-forward; among the files, `artifacts/api-server/src/lib/reelPhotos.ts`.
```sh
git log --oneline -6
```
Must list `5f881f3`, `8de1ebc` and `f8da606` (the top line may be a later
docs commit, such as the one that added this file). Note the top line's
short hash for step 5.

**4.** Deployments → **Publish**. If it fails at the phone app's Expo Go
preview build ("Metro timeout"), publish once more; if it fails that way
twice, ask Claude to apply the prepared change that takes that build out of
publishing (planned Sep 30, not yet made).

**5.** Check the deployment:
```sh
curl -s "$PUBLIC_BASE_URL/api/health"; echo
```
`"commit"` must be the hash `git log --oneline -1` printed, and
`"schema":{"ok":true,"missing":[]}`. If `missing` lists `reel_photos`,
step 2 did not run.

**6.** Store the reel's pictures (no model calls — $0):
```sh
node scripts/reel.mjs warm ~/reel-urls.txt --write
```
Each page prints `cached $0.000` and a `picture:` line: `stored`, `could
not be fetched` or `the page names none`.

**7.** List the picture links:
```sh
curl -s -H "x-admin-secret: $ADMIN_SECRET" "$PUBLIC_BASE_URL/api/admin/reel" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const c of JSON.parse(s).preview.cards)console.log(c.title+"\n  "+(c.photo?process.env.PUBLIC_BASE_URL+c.photo:"(no picture)"))})'
```
Each title with a `https://recipereduction.com/api/reel/photo/…?v=1` link, or
`(no picture)`. Open the links in a browser signed in to recipereduction.com:
each should be that recipe's own photo.

**8.** The over-the-air update (the new cards and the ticker on phones):
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
version 1.1.0`, then EAS's output ending in an update group ID. Then close the
app completely and reopen it, twice.
