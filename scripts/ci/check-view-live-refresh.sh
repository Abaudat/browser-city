#!/usr/bin/env bash
# Story 2.8 (FR147): proves, against a real disposable SpacetimeDB
# instance, that a public anonymous view over a compiled-in constant
# (`server/src/version.rs`'s real `module_version`, exercised here through
# `tests/fixtures/view_v1`/`view_v2`, same shape) re-evaluates on a live
# hot-swap republish rather than serving a value frozen from the previous
# build -- Tim's direction's own assumption-to-be-proven. Sibling to
# check-live-migration.sh (own port, own disposable instance -- never
# shared with it), same fail-loud discipline: every failure path aborts
# immediately and names what went wrong, never folded into a pass/fail
# count.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURES="$REPO_ROOT/server/tests/fixtures"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-view-live-refresh.XXXXXX")"
PORT=3989
SERVER_URL="http://127.0.0.1:$PORT"
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1
DB_NAME=bc-view-live-refresh

START_PID=""

cleanup() {
  [ -n "$START_PID" ] && kill "$START_PID" 2>/dev/null
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-view-live-refresh: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
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

read_value() { # <log-file> -- the one row's `value` column, quotes stripped
  local log="$DATA_DIR/sql.log"
  spacetime sql "$DB_NAME" --server "$SERVER_URL" --no-config -y "SELECT * FROM fixture_version" >"$log" 2>&1 \
    || fail "could not query fixture_version" "$log"
  grep -oE '"[^"]*"' "$log" | tail -n1 | tr -d '"'
}

echo "check-view-live-refresh: publishing view_v1" >&2
publish "$FIXTURES/view_v1" "$DATA_DIR/v1.log" || fail "could not publish view_v1" "$DATA_DIR/v1.log"

FIRST="$(read_value)"
[ "$FIRST" = "v1" ] || fail "view_v1 published but fixture_version read '$FIRST', expected 'v1'" "$DATA_DIR/sql.log"
echo "check-view-live-refresh: ok -- fresh subscription after the first publish reads '$FIRST'" >&2

echo "check-view-live-refresh: republishing view_v2 over the same live database (same schema, no migration)" >&2
publish "$FIXTURES/view_v2" "$DATA_DIR/v2.log" || fail "could not republish view_v2 over the same database" "$DATA_DIR/v2.log"

SECOND="$(read_value)"
[ "$SECOND" = "v2" ] || fail "republished view_v2 but fixture_version still reads '$SECOND' -- the view did not re-evaluate on a live hot-swap republish (the FR147 assumption this script exists to prove)" "$DATA_DIR/sql.log"
echo "check-view-live-refresh: ok -- a fresh query after the republish reads '$SECOND', with no republish of view_v1 in between" >&2

echo "check-view-live-refresh: a view over a compiled-in constant re-evaluates on a live republish" >&2
exit 0
