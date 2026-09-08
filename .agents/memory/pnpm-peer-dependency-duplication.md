---
name: pnpm peer-dependency duplication across workspace packages
description: Divergent devDependency versions across workspace packages sharing a peer-dependent library can cause pnpm to resolve two incompatible copies of it.
---

Workspace packages that share a library with peer dependencies (e.g. an ORM
peer-depending on a DB driver's types) but pin a related devDependency at
different versions can end up with pnpm resolving two separate copies of that
library. TypeScript then treats the same-named type from each copy as
structurally incompatible, producing confusing "type not assignable to
itself" errors.

**Why:** pnpm's strict isolation can genuinely instantiate two module copies
when a transitive dependency version diverges; editing package.json alone
doesn't reconverge an already-diverged lockfile.

**How to apply:** if a same-named type from a shared workspace package fails
structural assignability, suspect duplicated peer/type packages — align the
diverging version AND add a root `pnpm.overrides` entry, then reinstall.
