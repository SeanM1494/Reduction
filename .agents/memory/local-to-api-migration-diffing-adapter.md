---
name: localStorage-to-API migration via a diffing persistence adapter
description: How to swap a "save the whole blob" localStorage adapter for a CRUD API without touching any call site, by diffing against a last-synced snapshot inside the adapter.
---

When a client persists an array of records by calling a single `saveLibrary(all: Entry[])`
function (typical of a localStorage-blob design), and the storage backend changes to a
per-record CRUD API (POST/PATCH/DELETE), you don't have to touch every call site to send
targeted requests.

**Why:** the call sites (add, toggle-done, delete, etc.) already pass the *entire* array on
every change, matching the old blob-write model. Callers may be under an explicit
constraint not to be touched (e.g. "don't edit App.tsx state logic"), and rewriting them
to call granular `create`/`update`/`delete` functions is unnecessary churn.

**How to apply:** keep the adapter's public shape as `loadLibrary()` / `saveLibrary(all)`.
Internally, `loadLibrary()` fetches the server list and stores it as a module-level
`lastSynced: Map<id, Entry>`. `saveLibrary(next)` diffs `next` against `lastSynced`:
ids present in `next` but not `lastSynced` → POST (create); ids in both with changed
fields → PATCH (update); ids in `lastSynced` but missing from `next` → DELETE. Update
`lastSynced` to `next` after firing the calls. This produces exactly the same network
calls a hand-written granular API would, with zero caller changes — works cleanly as long
as callers always pass the full current array (true for typical React "next state" patterns).

For an accompanying one-time local→remote data migration (e.g. moving an existing
localStorage blob into the new backend), do the read+write of local data before anything
else touches it, and rename (never delete) the local key only after every record has been
confirmed persisted remotely — on partial failure, leave the local key completely
untouched and throw/surface the error, so a retry next load can pick up exactly where it
left off (idempotent: skip ids already confirmed present in the remote fetch).
