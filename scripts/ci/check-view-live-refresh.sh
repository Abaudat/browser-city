#!/usr/bin/env bash
# Story 2.8 (FR147): proves, against a real disposable SpacetimeDB
# instance, that a public anonymous view over a compiled-in constant
# (`server/src/version.rs`'s real `module_version`, exercised here through
# `tests/fixtures/view_v1`/`view_v2`, same shape) is live for the
# production case -- a subscribed client, not a one-off `spacetime sql`
# query with no subscriber connected (Tim's cycle 1 finding).
#
# Two things are proven, both against the same live database:
#   1. A `spacetime subscribe` held open *before* a hot-swap republish is
#      pushed the new row across it (a delete of the old row, an insert
#      of the new one -- the view has no primary key, so this is the same
#      shape `net/connection.ts`'s own `onInsert`-only handling expects).
#   2. A *fresh* subscription opened *after* the republish reads the new
#      value too.
# If either fails, the view does not survive a live republish for a real
# subscriber and this script says so explicitly -- the fallback table
# Tim's direction described is the next step, not a retry of this script.
#
# Sibling to check-live-migration.sh (own port, own disposable instance --
# never shared with it), same fail-loud discipline: every failure path
# aborts immediately and names what went wrong, never folded into a
# pass/fail count.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURES="$REPO_ROOT/server/tests/fixtures"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-view-live-refresh.XXXXXX")"
PORT=3989
SERVER_URL="http://127.0.0.1:$PORT"
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1
LOG_DEADLINE_S=20
DB_NAME=bc-view-live-refresh
# Comfortably longer than LOG_DEADLINE_S: the held subscription must
# still be alive (not yet timed out) when the republish's push would
# arrive, or a push that never comes and a subscription that already
# exited on its own look identical in the log.
HELD_SUBSCRIBE_TIMEOUT_S=25

START_PID=""
HELD_PID=""

cleanup() {
  [ -n "$HELD_PID" ] && kill "$HELD_PID" 2>/dev/null
  [ -n "$START_PID" ] && kill "$START_PID" 2>/dev/null
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-view-live-refresh: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}

# wait_for_line <log-file> <pattern> <deadline-s> -- polls until <log-file>
# contains a line matching <pattern>, or fails loudly naming both the
# pattern and the log's own content so far.
wait_for_line() {
  local log="$1" pattern="$2" deadline_s="$3"
  local deadline=$((SECONDS + deadline_s))
  while [ "$SECONDS" -lt "$deadline" ]; do
    grep -qF "$pattern" "$log" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

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
[ "$healthy" -eq 1 ] || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

publish() { # <module-dir> <log-file>
  spacetime publish --server "$SERVER_URL" --no-config -y "$DB_NAME" --module-path "$1" >"$2" 2>&1
}

echo "check-view-live-refresh: publishing view_v1" >&2
publish "$FIXTURES/view_v1" "$DATA_DIR/v1.log" || fail "could not publish view_v1" "$DATA_DIR/v1.log"

echo "check-view-live-refresh: holding a subscription open, before the republish" >&2
HELD_LOG="$DATA_DIR/held.log"
: >"$HELD_LOG"
spacetime subscribe --server "$SERVER_URL" --no-config -y --print-initial-update \
  --timeout "$HELD_SUBSCRIBE_TIMEOUT_S" "$DB_NAME" "SELECT * FROM fixture_version" \
  >"$HELD_LOG" 2>&1 &
HELD_PID=$!

wait_for_line "$HELD_LOG" '"value":"v1"' "$LOG_DEADLINE_S" \
  || fail "the held subscription's own initial update never showed 'v1' within ${LOG_DEADLINE_S}s" "$HELD_LOG"
echo "check-view-live-refresh: ok -- the held subscription's initial update reads 'v1'" >&2

echo "check-view-live-refresh: republishing view_v2 over the same live database (same schema, no migration), with the subscription still held open" >&2
publish "$FIXTURES/view_v2" "$DATA_DIR/v2.log" || fail "could not republish view_v2 over the same database" "$DATA_DIR/v2.log"

# The view has no primary key (Tim's direction: a view over constants,
# never a table), so a change to its one row is pushed as a delete of the
# old row plus an insert of the new one, never an update -- the same
# shape `net/connection.ts`'s own `onInsert`-only handling expects.
wait_for_line "$HELD_LOG" '"deletes":[{"value":"v1"}],"inserts":[{"value":"v2"}]' "$LOG_DEADLINE_S" \
  || fail "the held-open subscription was never pushed the republished row within ${LOG_DEADLINE_S}s -- a production reader holding the subscription across a deploy would stay on stale data, exactly the failure this story exists to prevent. The view is out; the fallback table from Tim's direction is in" "$HELD_LOG"
echo "check-view-live-refresh: ok -- the held-open subscription was pushed the republished row (delete 'v1', insert 'v2') with no reconnect" >&2

kill "$HELD_PID" 2>/dev/null
wait "$HELD_PID" 2>/dev/null
HELD_PID=""

echo "check-view-live-refresh: opening a fresh subscription after the republish" >&2
FRESH_LOG="$DATA_DIR/fresh.log"
: >"$FRESH_LOG"
spacetime subscribe --server "$SERVER_URL" --no-config -y --print-initial-update \
  --timeout 10 "$DB_NAME" "SELECT * FROM fixture_version" >"$FRESH_LOG" 2>&1 &
FRESH_PID=$!

wait_for_line "$FRESH_LOG" '"value":"v2"' "$LOG_DEADLINE_S" \
  || fail "a fresh subscription opened after the republish did not read 'v2' within ${LOG_DEADLINE_S}s" "$FRESH_LOG"
echo "check-view-live-refresh: ok -- a fresh subscription opened after the republish reads 'v2'" >&2

kill "$FRESH_PID" 2>/dev/null
wait "$FRESH_PID" 2>/dev/null

echo "check-view-live-refresh: a view over a compiled-in constant is live for a real subscriber across a republish, held-open and fresh alike" >&2
exit 0
