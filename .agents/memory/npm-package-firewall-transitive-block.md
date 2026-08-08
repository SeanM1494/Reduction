---
name: npm package-firewall transitive version block
description: Replit's npm package firewall can block a specific transitive dependency version even when the top-level install target is fine; pin the transitive package to an earlier version to unblock.
---

Installing a package (e.g. `drizzle-kit`) can fail with `403 Blocked by Security Policy` /
"AI-detected potential malware" pointing at a *transitive* dependency (e.g. `tsx@4.23.11`
pulled in because `drizzle-kit` requires `tsx@^4.21.0`), even though the project's own
pinned version of that same package (e.g. `tsx@4.19.2`) is unaffected and unrelated.

**Why:** the firewall blocks specific published versions, and npm's resolver may need a
newer transitive version than the project's direct dependency to satisfy another package's
peer/dependency range — pinning the direct dependency alone doesn't stop npm from also
fetching the newer transitive one for that package's own subtree.

**How to apply:** when an install fails this way, read the blocked package name+version
from the error, check what version range the new package actually requires
(`npm view <pkg>@latest dependencies`), and explicitly add that dependency to the install
list pinned to an older version inside the required range (e.g. `tsx@4.21.0` instead of
letting it resolve to `4.23.11`). Retry the same `installLanguagePackages` call with that
version added — no need to touch `.npmrc` or firewall config.
