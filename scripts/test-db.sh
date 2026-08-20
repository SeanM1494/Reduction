#!/usr/bin/env bash
#
# scripts/test-db.sh — a throwaway local Postgres for the test suite.
#
# WHY THIS EXISTS. `npm test` reads DATABASE_URL, and in the Replit shell that
# is PRODUCTION. The database-backed suites were run against it more than
# once before server/lib/testdb.ts learned to refuse a non-local URL. This
# script is the other half of that guard: a database the guard accepts,
# because it genuinely is local — Postgres 16 running inside the Repl (the
# .replit `postgresql-16` module ships the binaries), data in ./.pgtest,
# listening on 127.0.0.1 only.
#
# It is DISPOSABLE BY DESIGN. Nothing in it matters: the schema is re-pushed
# from shared/schema.ts on every start, the suites create and delete their
# own rows, and `reset` deletes the whole directory. If it ever looks wedged,
# reset it rather than debugging it.
#
#   scripts/test-db.sh start    initdb if needed, start, create db, push schema
#   scripts/test-db.sh run      start + npm test against it (the normal entry)
#   scripts/test-db.sh psql     a psql shell into the test database
#   scripts/test-db.sh stop     stop the server (data kept)
#   scripts/test-db.sh reset    stop and DELETE ./.pgtest entirely
#
# Or through npm, which is what CLAUDE.md tells everyone to use:
#
#   npm run test:db
#
set -euo pipefail

cd "$(dirname "$0")/.."

DATA_DIR="$PWD/.pgtest"
# 5433, not 5432: nothing else in the Repl claims it, and a URL that cannot
# be confused with a default local Postgres is a URL that cannot be pasted
# somewhere by habit.
PORT=5433
DB=reduction_test
PGUSER="$(whoami)"
URL="postgres://${PGUSER}@127.0.0.1:${PORT}/${DB}"
LOG="$DATA_DIR/log"

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  # The Replit module puts them on PATH; a bare container may not.
  for d in /usr/lib/postgresql/16/bin /usr/lib/postgresql/*/bin; do
    [ -x "$d/$1" ] && PATH="$d:$PATH" && export PATH && return 0
  done
  echo "error: $1 not found. In Replit, .replit must list the postgresql-16 module." >&2
  exit 1
}
need initdb; need pg_ctl; need psql

is_up() { pg_isready -q -h 127.0.0.1 -p "$PORT" 2>/dev/null; }

start() {
  if [ ! -d "$DATA_DIR/base" ]; then
    echo "test-db: first run — initdb into .pgtest"
    # trust auth is fine and deliberate: this listens on 127.0.0.1 only,
    # inside the Repl, and holds nothing but rows the test suites mint.
    initdb -D "$DATA_DIR" -A trust -U "$PGUSER" >/dev/null
  fi
  if ! is_up; then
    # Sockets inside the data dir, so nothing needs /var/run permissions.
    pg_ctl -D "$DATA_DIR" -l "$LOG" \
      -o "-p $PORT -c listen_addresses=127.0.0.1 -k $DATA_DIR" \
      start >/dev/null
  fi
  psql -h 127.0.0.1 -p "$PORT" -U "$PGUSER" -d postgres -qtAc \
    "select 1 from pg_database where datname='$DB'" | grep -q 1 ||
    psql -h 127.0.0.1 -p "$PORT" -U "$PGUSER" -d postgres -qc "create database $DB"
  # The schema is whatever shared/schema.ts says today, every time — a stale
  # test database is exactly the failure mode testdb.ts throws about.
  DATABASE_URL="$URL" npx drizzle-kit push --force >/dev/null
  echo "test-db: ready at $URL"
}

case "${1:-run}" in
  start) start ;;
  run)
    start
    shift || true
    DATABASE_URL="$URL" npm test "$@"
    ;;
  psql)  exec psql -h 127.0.0.1 -p "$PORT" -U "$PGUSER" -d "$DB" ;;
  stop)  pg_ctl -D "$DATA_DIR" stop -m fast >/dev/null 2>&1 || true; echo "test-db: stopped" ;;
  reset)
    pg_ctl -D "$DATA_DIR" stop -m fast >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR"
    echo "test-db: wiped .pgtest"
    ;;
  url)   echo "$URL" ;;
  *) echo "usage: scripts/test-db.sh [start|run|psql|stop|reset|url]" >&2; exit 2 ;;
esac
