#!/bin/bash
set -e
pnpm install --frozen-lockfile

# DO NOT ADD `pnpm --filter db push` (or any drizzle-kit push) TO THIS HOOK.
#
# This hook runs in the Replit workspace after every merge, and the
# workspace's DATABASE_URL is PRODUCTION. The Replit scaffold shipped with a
# push line here (Aug 1); it was defused on Aug 3 for exactly this reason;
# the Sep 8 workspace migration silently re-armed it — and the next merge
# auto-pushed auth_states.redirect_uri into the production schema with nobody
# running anything. That incident is why this comment exists.
#
# drizzle-kit push can also DROP columns when the schema moves the other way,
# so a re-armed hook is one refactor away from deleting production data.
# Schema changes go to production as hand-run DDL, reviewed first — see
# CLAUDE.md. The guard in lib/db/drizzle.config.ts enforces this even if a
# push line sneaks back in.
