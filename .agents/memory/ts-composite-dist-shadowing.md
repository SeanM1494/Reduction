---
name: TS composite package dist shadowing
description: A workspace package's stale pre-built dist can shadow live source exports for referencing projects, even when package.json exports point at source.
---

A TypeScript project-reference package's stale `dist/*.d.ts` + `.tsbuildinfo`
can shadow live source exports for packages that reference it, producing
confusing "missing export" errors that don't match the current source.

**Why:** `tsc -b` trusts existing build info/outputs unless invalidated; a
schema/export change in source doesn't always trigger a dependent rebuild.

**How to apply:** If a referencing package reports a missing/wrong export
from a workspace lib right after that lib's exports changed, delete its
`dist/` and `.tsbuildinfo` and rebuild directly with `tsc -p tsconfig.json`
(not `-b`) before re-checking dependents.
