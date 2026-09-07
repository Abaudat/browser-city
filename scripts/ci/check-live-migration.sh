#!/usr/bin/env bash
# Story 1.2's AC3, proven against the platform itself rather than inferred
# from reading the macro's rules: brings up a disposable local SpacetimeDB
# instance, publishes `tests/fixtures/migration_v1`, inserts one row (so
# the database is not empty -- this is "does a live world survive it", not
# "does an empty one"), then republishes over that same database with
# neither `--delete-data` nor a clear flag:
#   - `migration_v2_good` (adds a column with #[default(...)]) must succeed
#     and the row inserted under v1 must still be there.
#   - `migration_v2_bad` (adds a column with neither a default nor
#     #[auto_inc]) must fail, non-zero exit, no data loss.
# Runs in CI's own `migrate` job (ci.yml), gated on the `server` changes
# filter and `needs: build` so a module that does not compile never spins
# an instance.
set -u
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURES="$REPO_ROOT/server/tests/fixtures"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-live-migration.XXXXXX")"
PORT=3987
SERVER_URL="http://127.0.0.1:$PORT"
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1

START_PID=""

cleanup() {
  [ -n "$START_PID" ] && kill "$START_PID" 2>/dev/null
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

spacetime start --data-dir "$DATA_DIR/data" --listen-addr "127.0.0.1:$PORT" >"$START_LOG" 2>&1 &
START_PID=$!

deadline=$((SECONDS + HEALTH_DEADLINE_S))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl -sf -o /dev/null "$SERVER_URL/v1/ping"; then
    healthy=1
    break
  fi
  sleep "$POLL_INTERVAL_S"
done
if [ "$healthy" -ne 1 ]; then
  echo "check-live-migration: FAIL -- SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" >&2
  cat "$START_LOG" >&2
  exit 1
fi

publish() { # <module-dir> <db-name>
  spacetime publish --server "$SERVER_URL" --no-config -y "$2" --module-path "$1"
}
insert_a_row() { # <db-name>
  spacetime call "$1" --server "$SERVER_URL" --no-config -y add_fixture_row '"seed"' >/dev/null
}
row_count() { # <db-name>
  spacetime sql "$1" --server "$SERVER_URL" --no-config -y "SELECT * FROM fixture_row" 2>/dev/null | grep -cE '^ [0-9]+ '
}

FAILED=0

echo "check-live-migration: positive case -- appending a column with a default must succeed" >&2
if ! publish "$FIXTURES/migration_v1" bc-live-migration-good >"$DATA_DIR/good-v1.log" 2>&1; then
  echo "check-live-migration: FAIL -- could not publish the baseline fixture" >&2
  cat "$DATA_DIR/good-v1.log" >&2
  FAILED=1
else
  insert_a_row bc-live-migration-good
  BEFORE="$(row_count bc-live-migration-good)"
  if publish "$FIXTURES/migration_v2_good" bc-live-migration-good >"$DATA_DIR/good-v2.log" 2>&1; then
    AFTER="$(row_count bc-live-migration-good)"
    if [ "$AFTER" != "$BEFORE" ]; then
      echo "check-live-migration: FAIL -- row count changed across a same-data migration ($BEFORE -> $AFTER)" >&2
      FAILED=1
    else
      echo "check-live-migration: ok -- publish succeeded and $AFTER row(s) survived" >&2
    fi
  else
    echo "check-live-migration: FAIL -- publishing a column with a default was rejected" >&2
    cat "$DATA_DIR/good-v2.log" >&2
    FAILED=1
  fi
fi

echo "check-live-migration: negative case -- appending a column with no default must fail loudly" >&2
if ! publish "$FIXTURES/migration_v1" bc-live-migration-bad >"$DATA_DIR/bad-v1.log" 2>&1; then
  echo "check-live-migration: FAIL -- could not publish the baseline fixture" >&2
  cat "$DATA_DIR/bad-v1.log" >&2
  FAILED=1
else
  insert_a_row bc-live-migration-bad
  if publish "$FIXTURES/migration_v2_bad" bc-live-migration-bad >"$DATA_DIR/bad-v2.log" 2>&1; then
    echo "check-live-migration: FAIL -- publishing a column with no default and no #[auto_inc] was accepted; it must be rejected" >&2
    cat "$DATA_DIR/bad-v2.log" >&2
    FAILED=1
  else
    echo "check-live-migration: ok -- publish was rejected, exactly as NFR33 requires" >&2
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-live-migration: both halves of AC3 hold against a real SpacetimeDB instance" >&2
exit 0
