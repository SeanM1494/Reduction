---
name: Anonymous per-browser ownership + hardcoded demo-record id collision
description: A "first-run demo record" with a literal hardcoded id (e.g. "seed") is not safe under a bare id PK when ownership is scoped by a per-browser key instead of accounts.
---

In an app with no login — ownership scoped only by a random per-browser key stored in
localStorage and sent as a header (e.g. `X-Owner-Key`) — a "seed a demo record on first
run" bootstrap that always uses the same literal id (e.g. `"seed"`) will collide the
moment a **second** browser ever bootstraps, if the backing table's primary key is just
`id` rather than `(owner_key, id)`.

**Why:** every other client-created id is randomized (`crypto.randomUUID()`), so a bare
`id` PK looks safe in testing with a single browser/session. The hardcoded demo id is the
one exception, and it's easy to miss because the bug is invisible until a genuinely new
owner key exists — one already-populated test browser can mask it indefinitely. Symptom:
a `POST .../seed` returns 409 "already exists" on an otherwise-empty account, the UI shows
the demo recipe optimistically (in-memory) but it silently never persists, and reloading
just repeats the failed bootstrap forever for that owner.

**How to apply:** when ownership is per-browser/anonymous rather than per-account, make the
primary key (or unique constraint) composite on `(owner_key, id)`, not `id` alone — and
make sure any `onConflictDoNothing`/upsert target lists both columns. Don't rely on "we'll
never have two owners with the same id" when even one id (the seeded demo record) is a
hardcoded constant shared by every first-time user.
