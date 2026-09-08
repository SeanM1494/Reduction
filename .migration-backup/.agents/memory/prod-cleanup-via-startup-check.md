---
name: Prod data cleanup without prod DB write access
description: How to actually delete/fix bad rows in a production database when the agent only has read-only prod SQL access.
---

The `database` skill's `executeSql` is SELECT-only against production — there is no direct way to run a destructive prod query from the workspace. But application code that ships with the next deploy *does* run against production the moment it boots there.

**Why:** the only channel from a dev-workspace agent into production data is the app's own deployed runtime, not an ad-hoc script.

**How to apply:**
- For "delete/fix these bad rows everywhere, including prod," write the fix as an idempotent function that runs once at server startup (e.g. `DELETE ... WHERE <narrow, specific condition>`), and call it during boot.
- Keep the condition narrow and specific (e.g. a literal id/marker that only ever applied to the bad data) so it's safe to leave running on every boot indefinitely — a no-op once the rows are gone.
- Wrap it in try/catch so a database hiccup never blocks the server from starting.
- Dev gets cleaned the same way, the next time its workflow restarts — one mechanism for both environments instead of a separate one-off dev script.
