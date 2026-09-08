#!/bin/bash
# The workspace Run button: api on 3001, web on 5000 with /api proxied across
# (see the proxy note in artifacts/reduction/vite.config.ts). Both die when
# this script does, so stopping the Run button leaves no orphans.
set -e
cleanup() { kill 0 2>/dev/null; }
trap cleanup EXIT INT TERM

PORT=3001 pnpm --filter @workspace/api-server run dev &
PORT=5000 BASE_PATH=/ pnpm --filter ./artifacts/reduction run dev &
wait -n
