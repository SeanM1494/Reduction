---
name: Multi-artifact migration copy script relative-path fixups
description: The migrate-to-multi-artifact copy scripts don't fully fix nested relative imports or shared-module placement; manual verification is required.
---

When porting a legacy fullstack app into the pnpm multi-artifact workspace:

- Relative imports to a former sibling `shared/` directory need recomputing
  per file depth once a wrapper directory (e.g. `client/`) is flattened away
  — the copy scripts don't always get every nesting depth right. Grep the
  whole copied tree for stale shared-import paths rather than trusting one
  sed pass.
- A frontend artifact can't import a DB package (triggers DB connection code
  client-side) — copy pure shared logic/types into a local directory inside
  the new frontend artifact instead, stripped of schema/DB-only files.
- The scripts may not find `index.html` when it lives at the legacy project
  root rather than under a client subdirectory — rebuild it manually,
  preserving theme-preload scripts, font links, and manifest/icon links.
- Cross-check actual runtime imports against the new artifact's
  `package.json` dependencies; a missing package only surfaces at
  typecheck/runtime, not in the copy script's own log.
