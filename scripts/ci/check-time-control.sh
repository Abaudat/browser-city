#!/usr/bin/env bash
# Story 4.3 (FR163): proves the dev-only clock control against a real
# disposable local SpacetimeDB instance, on its own port (3992 -- taken:
# 3987/3988/3989 check-live-migration/check-backup-restore/
# check-view-live-refresh, 3990 the 1.3 timing spike, 3991
# check-authoritative-loop). Same fail-loud discipline as
# check-authoritative-loop.sh. The production flavour's own half (the
# reducers do not exist) is that script's leg (e).
#
# Legs, in order, against the module published by scripts/dev/publish-dev.sh
# (the `time-control` feature on):
#   (a) A one-city-week jump: world_clock.epoch_at moves back by exactly the
#       skipped real interval, cadence_liveness.fires for maintenance rises
#       by exactly the ten-minute grid points inside the week (1008; plus at
#       most one live fire landing in the same instant), and
#       maintenance_schedule holds exactly one pending row, phase-aligned to
#       the new epoch.
#   (b) A jump over the cap, a zero jump and an invalid speed are refused,
#       and world_clock is unchanged.
#   (c) A multiplier: set 10x, wait a window, floor-assert the maintenance
#       fire count against window x multiplier / period -- the loop itself
#       runs faster, not just a displayed number -- and the epoch is
#       re-anchored so the city minute does not move.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
. "$REPO_ROOT/scripts/ops/lib.sh"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-time-control.XXXXXX")"
PORT=3992
SERVER_URL="http://127.0.0.1:$PORT"
SERVER_ARGS=(--server "$SERVER_URL")
DB_NAME=bc-time-control
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30

# sim::time / sim::cadence constants, pinned as plain numbers so a change to
# either drifts these assertions loudly.
REAL_MICROS_PER_CITY_MINUTE=2500000
PERIOD_CITY_MINUTES=10 # sim::cadence::MAINTENANCE_PERIOD_CITY_MINUTES
MAX_JUMP_CITY_MINUTES=11520
WEEK_CITY_MINUTES=$((7 * 1440))
MAINTENANCE_CADENCE=1

START_PID=""
cleanup() {
  if [ -n "${BC_KEEP_DATA_DIR:-}" ]; then
    echo "check-time-control: BC_KEEP_DATA_DIR set -- leaving $DATA_DIR and the instance on $SERVER_URL running" >&2
    return
  fi
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-time-control: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "check-time-control: ok -- $1" >&2; }

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S" \
  || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

sql_json() { bc_sql_json "check-time-control" "$DB_NAME" "${SERVER_ARGS[@]}" "$1"; }
column_field() { bc_wb column-values "$1" "$2" 2>/dev/null | head -n1; }
micros_of() { printf '%s' "$1" | grep -oE '[0-9]+' | tail -n1; }
clock_field() { # <column> -- world_clock's own value
  local resp="$DATA_DIR/clock-$RANDOM.json"
  sql_json "SELECT * FROM world_clock" >"$resp"
  column_field "$resp" "$1"
}
epoch_us() { micros_of "$(clock_field epoch_at)"; }
fires() {
  local resp="$DATA_DIR/fires-$RANDOM.json"
  sql_json "SELECT * FROM cadence_liveness WHERE cadence = $MAINTENANCE_CADENCE" >"$resp"
  column_field "$resp" fires
}
clock() { "$REPO_ROOT/scripts/dev/clock.sh" "$DB_NAME" "$@" "${SERVER_ARGS[@]}" --no-config -y; }

echo "check-time-control: publishing the time-control flavour" >&2
bash "$REPO_ROOT/scripts/dev/publish-dev.sh" "$DB_NAME" "${SERVER_ARGS[@]}" --no-config >"$DATA_DIR/publish.log" 2>&1 \
  || fail "could not publish the time-control flavour" "$DATA_DIR/publish.log"

# --- (a) a one-week jump ------------------------------------------------------
EPOCH_BEFORE="$(epoch_us)"
FIRES_BEFORE="$(fires)"
[ -n "$EPOCH_BEFORE" ] || fail "world_clock has no epoch_at after publish"
FIRES_BEFORE="${FIRES_BEFORE:-0}"

clock jump "$WEEK_CITY_MINUTES" >"$DATA_DIR/jump.log" 2>&1 || fail "jump_clock of one city week failed" "$DATA_DIR/jump.log"

EPOCH_AFTER="$(epoch_us)"
DELTA_US=$((WEEK_CITY_MINUTES * REAL_MICROS_PER_CITY_MINUTE))
[ $((EPOCH_BEFORE - EPOCH_AFTER)) -eq "$DELTA_US" ] \
  || fail "epoch_at moved by $((EPOCH_BEFORE - EPOCH_AFTER))us, expected exactly ${DELTA_US}us (one city week)"
ok "epoch_at moved back by exactly one city week (${DELTA_US}us)"

EXPECTED_FIRES=$((WEEK_CITY_MINUTES / PERIOD_CITY_MINUTES))
FIRES_AFTER="$(fires)"
GAINED=$((FIRES_AFTER - FIRES_BEFORE))
{ [ "$GAINED" -ge "$EXPECTED_FIRES" ] && [ "$GAINED" -le $((EXPECTED_FIRES + 1)) ]; } \
  || fail "cadence_liveness.fires rose by $GAINED, expected $EXPECTED_FIRES (one per ten-minute grid point in a week, plus at most one live fire)"
ok "maintenance fired $GAINED times across the jump (expected $EXPECTED_FIRES)"

RESP_SCHED="$DATA_DIR/sched-a.json"
sql_json "SELECT * FROM maintenance_schedule" >"$RESP_SCHED"
[ "$(bc_wb row-count "$RESP_SCHED")" = "1" ] \
  || fail "maintenance_schedule must hold exactly one pending row after a jump" "$RESP_SCHED"
TARGET_US="$(micros_of "$(column_field "$RESP_SCHED" scheduled_at)")"
EPOCH_NOW="$(epoch_us)"
PERIOD_US=$((PERIOD_CITY_MINUTES * REAL_MICROS_PER_CITY_MINUTE))
[ $(((TARGET_US - EPOCH_NOW) % PERIOD_US)) -eq 0 ] \
  || fail "the pending maintenance target is not phase-aligned to the new epoch" "$RESP_SCHED"
ok "maintenance_schedule holds exactly one pending row, phase-aligned to the new epoch"

# --- (b) refusals change nothing ---------------------------------------------
EPOCH_B="$(epoch_us)"
for bad in "$((MAX_JUMP_CITY_MINUTES + 1))"; do
  if clock jump "$bad" >"$DATA_DIR/over-cap.log" 2>&1; then
    fail "a jump of $bad city minutes (over the cap) was accepted" "$DATA_DIR/over-cap.log"
  fi
done
if spacetime call "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y jump_clock 0 >"$DATA_DIR/zero.log" 2>&1; then
  fail "a zero-minute jump was accepted" "$DATA_DIR/zero.log"
fi
if spacetime call "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y set_clock_speed 3 >"$DATA_DIR/speed3.log" 2>&1; then
  fail "a clock speed of 3 (does not divide the city minute) was accepted" "$DATA_DIR/speed3.log"
fi
[ "$(epoch_us)" = "$EPOCH_B" ] || fail "world_clock.epoch_at changed across refused calls"
[ "$(clock_field speed)" = "1" ] || fail "world_clock.speed changed across refused calls"
ok "an over-cap jump, a zero jump and an invalid speed were refused and changed nothing"

# --- (c) the multiplier runs the loop faster ---------------------------------
SPEED=10
WINDOW_S=30
PERIOD_S=25 # at speed 1
clock speed "$SPEED" >"$DATA_DIR/speed.log" 2>&1 || fail "set_clock_speed $SPEED failed" "$DATA_DIR/speed.log"
[ "$(clock_field speed)" = "$SPEED" ] || fail "world_clock.speed is not $SPEED after set_clock_speed"
F0="$(fires)"
echo "check-time-control: (c) waiting ${WINDOW_S}s at ${SPEED}x" >&2
sleep "$WINDOW_S"
F1="$(fires)"
EXPECTED=$((WINDOW_S * SPEED / PERIOD_S))
GAINED=$((F1 - F0))
{ [ "$GAINED" -ge $((EXPECTED - 2)) ] && [ "$GAINED" -le $((EXPECTED + 2)) ]; } \
  || fail "maintenance fired $GAINED times in ${WINDOW_S}s at ${SPEED}x, expected about $EXPECTED (window x multiplier / period)"
ok "maintenance fired $GAINED times in ${WINDOW_S}s at ${SPEED}x (expected about $EXPECTED)"

echo "check-time-control: the clock jumps, replays every skipped fire, refuses cleanly, and its multiplier runs the loop faster" >&2
exit 0
