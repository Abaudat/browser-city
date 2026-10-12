#!/usr/bin/env bash
# Story 4.12 (FR169, NFR15, NFR37): proves the metrics sampler against a
# real disposable local SpacetimeDB instance, on its own port (3993 --
# taken: 3987-3992). Same fail-loud discipline as the sibling scripts.
#
# The sampler's period is one real hour at speed 1 (a function of the
# present, so a clock jump deliberately leaves it alone). The script
# publishes the `time-control` flavour and raises the clock multiplier to
# its maximum so the first fire lands within seconds, then drops it back
# to 1 so nothing else fires while the samples are read.
#
# Legs:
#   (a) One sample row per table per fire -- the table list is read from
#       server/schema.snapshot.json, never hardcoded -- plus one
#       storage_sample per fire; every static table's sampled `rows` equals
#       the row count read from the table itself; the declared alert/max
#       columns are carried; no breach flag is set.
#   (a2) Story 4.13 (NFR17): one reducer_class_sample row per class per fire
#       -- the class list is read from reducer_class_counter -- and the
#       scheduled class's calls_delta is at least 1 after a fire (the fire
#       itself is a scheduled call).
#   (b) A direct call to sample_metrics as owner is rejected by
#       require_scheduler and neither sample table changes.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
. "$REPO_ROOT/scripts/ops/lib.sh"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-metrics-sampler.XXXXXX")"
PORT=3993
SERVER_URL="http://127.0.0.1:$PORT"
SERVER_ARGS=(--server "$SERVER_URL")
DB_NAME=bc-metrics-sampler
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
FIRST_FIRE_DEADLINE_S=120 # one period at the maximum multiplier (100x) is 36s
MAX_SPEED=100             # sim::time::MAX_CLOCK_SPEED
SNAPSHOT="$REPO_ROOT/server/schema.snapshot.json"
# Tables whose row count is fixed for the whole run: the one-row config
# tables and the code tables (each seeded by `init`, never written again).
STATIC_TABLES="module_owner world_clock matter_kind provision reason_code node_kind unit layer_code holder_kind actor_kind container_kind"

START_PID=""
SUB_PID=""
cleanup() {
  [ -z "$SUB_PID" ] || kill "$SUB_PID" 2>/dev/null
  if [ -n "${BC_KEEP_DATA_DIR:-}" ]; then
    echo "check-metrics-sampler: BC_KEEP_DATA_DIR set -- leaving $DATA_DIR and the instance on $SERVER_URL running" >&2
    return
  fi
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-metrics-sampler: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "check-metrics-sampler: ok -- $1" >&2; }

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S" \
  || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

sql_json() { bc_sql_json "check-metrics-sampler" "$DB_NAME" "${SERVER_ARGS[@]}" "$1"; }
rows_of() { # <table> -- row count of the whole table
  local resp="$DATA_DIR/rows-$RANDOM.json"
  sql_json "SELECT * FROM $1" >"$resp"
  bc_wb row-count "$resp"
}
clock() { bash "$REPO_ROOT/scripts/dev/clock.sh" "$DB_NAME" "$@" "${SERVER_ARGS[@]}" --no-config -y; }

TABLES="$(jq -r '.tables[].accessor' "$SNAPSHOT" | tr -d '\r' | sort -u)"
TABLE_COUNT="$(printf '%s\n' "$TABLES" | grep -c .)"
[ "$TABLE_COUNT" -gt 0 ] || fail "no table found in $SNAPSHOT"

echo "check-metrics-sampler: publishing the time-control flavour" >&2
bash "$REPO_ROOT/scripts/dev/publish-dev.sh" "$DB_NAME" "${SERVER_ARGS[@]}" --no-config >"$DATA_DIR/publish.log" 2>&1 \
  || fail "could not publish the time-control flavour" "$DATA_DIR/publish.log"

# --- (g) one held connection, for the live-connection mirror -----------------
# A subscriber (the CLI identity is the module owner, exempt from the issuer
# check) stays connected across the first fire: connected_client holds
# exactly it, and the fire leaves the tally holding exactly the peak slot.
SUB_LOG="$DATA_DIR/subscribe.log"
spacetime subscribe "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y --timeout 900 "SELECT * FROM world_clock" >"$SUB_LOG" 2>&1 &
SUB_PID=$!
WAITED=0
until [ "$(rows_of connected_client)" -ge 1 ]; do
  [ "$WAITED" -lt 30 ] || fail "connected_client never held the subscriber's connection" "$SUB_LOG"
  sleep 1
  WAITED=$((WAITED + 1))
done
# The CLI reader (`spacetime sql`) is itself a connection while it runs, so
# every read of connected_client sees its own row: one subscriber is two rows.
READER=1
LIVE_N="$(( $(rows_of connected_client) - READER ))"
[ "$LIVE_N" -eq 1 ] || fail "connected_client holds $LIVE_N connection(s) beside the reader with one subscriber attached, expected 1"
ok "connected_client holds exactly the one open connection (plus the reader's own)"

# --- (a) one sample per table per fire ---------------------------------------
clock speed "$MAX_SPEED" >"$DATA_DIR/speed-up.log" 2>&1 || fail "set_clock_speed $MAX_SPEED failed" "$DATA_DIR/speed-up.log"
WAITED=0
until [ "$(rows_of storage_sample)" -ge 1 ]; do
  [ "$WAITED" -lt "$FIRST_FIRE_DEADLINE_S" ] || fail "the sampler did not fire within ${FIRST_FIRE_DEADLINE_S}s at ${MAX_SPEED}x"
  sleep 1
  WAITED=$((WAITED + 1))
done
clock speed 1 >"$DATA_DIR/speed-down.log" 2>&1 || fail "set_clock_speed 1 failed" "$DATA_DIR/speed-down.log"
FIRES="$(rows_of storage_sample)"
ok "the sampler fired with no watcher present"
echo "check-metrics-sampler: $FIRES storage sample row(s); the clock is back at 1x, so nothing fires while reading" >&2

SAMPLES="$(rows_of table_sample)"
[ "$SAMPLES" -eq $((FIRES * TABLE_COUNT)) ] \
  || fail "table_sample holds $SAMPLES rows, expected $FIRES fire(s) x $TABLE_COUNT tables = $((FIRES * TABLE_COUNT)) (exactly one sample row per table per fire, plus the total row in storage_sample)"
for t in $TABLES; do
  resp="$DATA_DIR/sample-$t.json"
  sql_json "SELECT * FROM table_sample WHERE table_accessor = '$t'" >"$resp"
  [ "$(bc_wb row-count "$resp")" -eq "$FIRES" ] \
    || fail "table '$t' has $(bc_wb row-count "$resp") sample row(s), expected exactly $FIRES (one per fire)" "$resp"
done
ok "exactly one table_sample row per table ($TABLE_COUNT tables, from the schema snapshot) per fire, plus one storage_sample row per fire"

for t in $STATIC_TABLES; do
  resp="$DATA_DIR/static-$t.json"
  sql_json "SELECT * FROM table_sample WHERE table_accessor = '$t'" >"$resp"
  DISTINCT="$(bc_wb column-values "$resp" rows | sort -u)"
  ACTUAL="$(rows_of "$t")"
  [ "$DISTINCT" = "$ACTUAL" ] \
    || fail "table '$t': sampled rows [$DISTINCT] differ from its actual row count $ACTUAL"
done
ok "each static table's sampled row_count equals its own row count"

# Story 4.14: one gameplay_metric_sample row per live series per fire.
SERIES_COUNT="$(grep -c '^series ' "$REPO_ROOT/server/sim/tests/goldens/codes_gameplay_metrics_v1.golden")"
[ "$(rows_of gameplay_metric_sample)" -eq $((FIRES * SERIES_COUNT)) ]   || fail "gameplay_metric_sample holds $(rows_of gameplay_metric_sample) rows, expected $FIRES fire(s) x $SERIES_COUNT series"
ok "exactly one gameplay_metric_sample row per live series ($SERIES_COUNT) per fire"

resp="$DATA_DIR/tally.json"
sql_json "SELECT * FROM metric_tally" >"$resp"
[ "$(bc_wb row-count "$resp")" -eq 1 ]   || fail "metric_tally holds $(bc_wb row-count "$resp") rows after a fire, expected exactly the peak slot" "$resp"
PEAK="$(bc_wb column-values "$resp" value)"
# The subscriber, plus at most the one transient reader the fire may overlap.
[ "$(bc_wb column-values "$resp" tally_key)" = "1" ] && [ "${PEAK:-0}" -ge "$LIVE_N" ] && [ "${PEAK:-0}" -le $((LIVE_N + READER)) ]   || fail "metric_tally after a fire is not the peak slot (key 1) seeded to the live count ($LIVE_N..$((LIVE_N + READER))), got [$PEAK]" "$resp"
ok "after a fire metric_tally holds exactly the peak slot, seeded to the live connection count"

resp="$DATA_DIR/sample-owner.json"
sql_json "SELECT * FROM table_sample WHERE table_accessor = 'module_owner'" >"$resp"
[ "$(bc_wb column-values "$resp" alert_rows | sort -u)" = "1" ] && [ "$(bc_wb column-values "$resp" max_rows | sort -u)" = "1" ] \
  || fail "module_owner's sample does not carry its declared alert_rows/max_rows (1/1)" "$resp"
resp="$DATA_DIR/sample-all.json"
sql_json "SELECT * FROM table_sample" >"$resp"
bc_wb column-values "$resp" over_alert | grep -qx true \
  && fail "a table_sample row has over_alert set on a fresh world" "$resp"
resp="$DATA_DIR/storage.json"
sql_json "SELECT * FROM storage_sample" >"$resp"
{ bc_wb column-values "$resp" over_review | grep -qx true || bc_wb column-values "$resp" over_wall | grep -qx true; } \
  && fail "a storage_sample row has over_review/over_wall set on a fresh world" "$resp"
ok "the declared alert/max are carried, and no breach flag is set on a fresh world"

# --- (a2) one reducer_class_sample per class per fire -------------------------
resp="$DATA_DIR/counter.json"
sql_json "SELECT * FROM reducer_class_counter" >"$resp"
CLASSES="$(bc_wb column-values "$resp" class | tr -d '"' | sort -u)"
CLASS_COUNT="$(printf '%s
' "$CLASSES" | grep -c .)"
[ "$CLASS_COUNT" -gt 0 ] || fail "reducer_class_counter holds no class row" "$resp"
[ "$(rows_of reducer_class_sample)" -eq $((FIRES * CLASS_COUNT)) ]   || fail "reducer_class_sample holds $(rows_of reducer_class_sample) rows, expected $FIRES fire(s) x $CLASS_COUNT classes"
for c in $CLASSES; do
  resp="$DATA_DIR/class-$c.json"
  sql_json "SELECT * FROM reducer_class_sample WHERE class = '$c'" >"$resp"
  [ "$(bc_wb row-count "$resp")" -eq "$FIRES" ]     || fail "class '$c' has $(bc_wb row-count "$resp") sample row(s), expected exactly $FIRES (one per fire)" "$resp"
done
resp="$DATA_DIR/class-scheduled.json"
sql_json "SELECT * FROM reducer_class_sample WHERE class = 'scheduled'" >"$resp"
FIRST_DELTA="$(bc_wb column-values "$resp" calls_delta | sort -n | tail -n1)"
[ "${FIRST_DELTA:-0}" -ge 1 ] || fail "the scheduled class's calls_delta is ${FIRST_DELTA:-none} after a fire, expected >= 1" "$resp"
ok "one reducer_class_sample row per class per fire, and the scheduled class's delta is >= 1"

# --- (b) a direct call is rejected and changes nothing -----------------------
# The clock is back at 1x: the next fire is an hour away, so no legitimate
# fire can land between the two reads.
BEFORE_T="$(rows_of table_sample)"
BEFORE_S="$(rows_of storage_sample)"
DIRECT_LOG="$DATA_DIR/direct-call.log"
# Not --anonymous: the CLI's own identity is the module owner, which is
# not the scheduler, so this reaches require_scheduler.
if spacetime call "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y sample_metrics '[999999,{"Time":[0]}]' >"$DIRECT_LOG" 2>&1; then
  fail "sample_metrics accepted a direct call; it must be rejected (require_scheduler)" "$DIRECT_LOG"
fi
grep -qF "this reducer may only be invoked by the scheduler" "$DIRECT_LOG" \
  || fail "sample_metrics rejected the direct call, but not with require_scheduler's own message" "$DIRECT_LOG"
[ "$(rows_of table_sample)" = "$BEFORE_T" ] && [ "$(rows_of storage_sample)" = "$BEFORE_S" ] \
  || fail "a rejected direct call to sample_metrics changed table_sample/storage_sample"
ok "a direct call to sample_metrics was rejected by require_scheduler, and neither sample table changed"

# A rejected call rolls its own count_call back: the counter is committed
# calls only (NFR17's stated limitation). `finish_publish` as a non-owner
# is rejected by require_owner, and nothing else drives the operator class
# at rest, so its counter must not move.
operator_calls() {
  local resp="$DATA_DIR/operator-calls-$RANDOM.json"
  sql_json "SELECT * FROM reducer_class_counter WHERE class = 'operator'" >"$resp"
  bc_wb column-values "$resp" calls
}
OPERATOR_BEFORE="$(operator_calls)"
REJECT_LOG="$DATA_DIR/rejected-finish-publish.log"
if spacetime call "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y --anonymous finish_publish >"$REJECT_LOG" 2>&1; then
  fail "an anonymous finish_publish was accepted; it must be rejected (require_owner)" "$REJECT_LOG"
fi
grep -qF "may only be invoked by the module owner" "$REJECT_LOG" \
  || fail "the anonymous finish_publish was rejected, but not by require_owner" "$REJECT_LOG"
OPERATOR_AFTER="$(operator_calls)"
[ "$OPERATOR_AFTER" = "$OPERATOR_BEFORE" ] \
  || fail "a rejected finish_publish moved reducer_class_counter.operator.calls ([$OPERATOR_BEFORE] -> [$OPERATOR_AFTER]); a rolled-back call must not count"
ok "a rejected call is not counted (the limitation, pinned)"

# --- (c) the watcher's own reader, against this same instance ---------------
# The one live proof that the real query shape works (story 4.13): the
# stub-based fast suite proves the decisions, this proves the queries.
WATCH_LOG="$DATA_DIR/watch.log"
bash "$REPO_ROOT/scripts/ops/storage-report.sh" "$DB_NAME" "${SERVER_ARGS[@]}" >"$WATCH_LOG" 2>&1
WATCH_CODE=$?
[ "$WATCH_CODE" -eq 0 ] || fail "storage-report.sh exited $WATCH_CODE against a healthy fresh world, expected 0" "$WATCH_LOG"
grep -qF "estimated total" "$WATCH_LOG" && grep -qF "class scheduled calls_total=" "$WATCH_LOG"   || fail "storage-report.sh did not print the storage total and the scheduled class's figures" "$WATCH_LOG"
grep -q "BREACH" "$WATCH_LOG" && fail "storage-report.sh reported a breach on a fresh world" "$WATCH_LOG"
ok "the watcher's reader exits 0 with no breach against the live instance and prints the per-class calls"
grep -qE "cadence 2: last fired ([0-9]+s ago|fired during this read)" "$WATCH_LOG" || fail "storage-report.sh did not print the METRICS cadence's liveness" "$WATCH_LOG"

# The stale branch against the real schema: --now four sampler periods past
# the newest sample (the only live proof of the liveness query shape).
NEWEST_AT="$(sql_json "SELECT * FROM storage_sample" >"$DATA_DIR/newest.json"; bc_wb column-values "$DATA_DIR/newest.json" sampled_at | grep -oE '[0-9]+' | sort -n | tail -n1)"
[ -n "$NEWEST_AT" ] || fail "no storage_sample row to age"
STALE_FINDINGS="$DATA_DIR/stale-findings.tsv"
STALE_LOG="$DATA_DIR/watch-stale.log"
bash "$REPO_ROOT/scripts/ops/storage-report.sh" "$DB_NAME" "${SERVER_ARGS[@]}" --now $((NEWEST_AT + 4 * 3600 * 1000000)) --settle 0 --findings "$STALE_FINDINGS" >"$STALE_LOG" 2>&1
STALE_CODE=$?
[ "$STALE_CODE" -eq 1 ] || fail "storage-report.sh exited $STALE_CODE on a sample four periods old, expected 1" "$STALE_LOG"
[ "$(grep -c '^watcher: sampler stale' "$STALE_FINDINGS")" -eq 1 ] || fail "expected exactly one 'watcher: sampler stale' finding" "$STALE_FINDINGS"
grep -qF "cadence 2: last fired" "$STALE_FINDINGS" || fail "the stale finding carries no liveness entry for cadence 2 (METRICS)" "$STALE_FINDINGS"
grep -qF "cadence liveness unreadable" "$STALE_FINDINGS" && fail "the stale finding's liveness read failed against the live instance" "$STALE_LOG"
ok "a stale sample files one finding carrying the live cadence liveness"

# --- (c2) `missed` counts skipped grid points, never periods since the epoch --
# Two more consecutive on-time METRICS fires: the cumulative `missed` of the
# METRICS cadence (code 2) must still be 0 (it summed whole periods since the
# epoch on every fire before story #446).
BEFORE_FIRES="$(rows_of storage_sample)"
clock speed "$MAX_SPEED" >"$DATA_DIR/speed-up2.log" 2>&1 || fail "set_clock_speed $MAX_SPEED failed" "$DATA_DIR/speed-up2.log"
WAITED=0
until [ "$(rows_of storage_sample)" -ge $((BEFORE_FIRES + 2)) ]; do
  [ "$WAITED" -lt $((2 * FIRST_FIRE_DEADLINE_S)) ] || fail "two more sampler fires did not land within $((2 * FIRST_FIRE_DEADLINE_S))s at ${MAX_SPEED}x"
  sleep 1
  WAITED=$((WAITED + 1))
done
clock speed 1 >"$DATA_DIR/speed-down2.log" 2>&1 || fail "set_clock_speed 1 failed" "$DATA_DIR/speed-down2.log"
resp="$DATA_DIR/liveness.json"
sql_json "SELECT * FROM cadence_liveness WHERE cadence = 2" >"$resp"
[ "$(bc_wb column-values "$resp" missed)" = "0" ]   || fail "the METRICS cadence's missed is [$(bc_wb column-values "$resp" missed)] after consecutive on-time fires, expected 0" "$resp"
ok "consecutive on-time METRICS fires leave missed at 0"

# --- (h) a host restart leaves no stale connection row -----------------------
# The subscriber stays attached while the server is stopped under it, so the
# row it holds can only be removed by the host: at shutdown or at launch
# ("Disconnect dangling clients"). It is asserted present immediately before
# the stop, so the proof cannot pass on a table that was already empty; the
# subscriber is reaped only after the server is confirmed gone, and the
# server is restarted on the same data dir. A forced kill is not used: it
# loses the database registration in the data dir (observed), which would
# prove nothing about connections. Needs a graceful stop, which Windows
# does not have for this process, so (h) runs on the CI platform only.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    echo "check-metrics-sampler: SKIP (h) -- no graceful stop of the server on this platform; CI runs it" >&2
    exit 0
    ;;
esac
[ "$(( $(rows_of connected_client) - READER ))" -ge 1 ]   || fail "no connected_client row for the subscriber just before the restart: the proof would be vacuous"
# `spacetime start` is a wrapper: stop the listener on the port as well.
stop_instance() { # <signal>
  local pids p
  kill "-$1" "$START_PID" 2>/dev/null
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "$PORT/tcp" 2>/dev/null)"
  fi
  for p in $pids; do kill "-$1" "$p" 2>/dev/null; done
}
stop_instance TERM
bc_stop_spacetime_confirmed "$START_PID" "$SERVER_URL" 20 || {
  stop_instance KILL
  bc_stop_spacetime_confirmed "$START_PID" "$SERVER_URL" 20 || fail "the server did not stop"
}
kill "$SUB_PID" 2>/dev/null
SUB_PID=""
START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S"   || fail "SpacetimeDB did not become healthy after the restart" "$START_LOG"
WAITED=0
until [ "$(( $(rows_of connected_client) - READER ))" -eq 0 ]; do
  [ "$WAITED" -lt 30 ] || fail "connected_client still holds $(( $(rows_of connected_client) - READER )) stale row(s) after a host restart: concurrent_now would over-count"
  sleep 1
  WAITED=$((WAITED + 1))
done
ok "a host restart leaves no stale connected_client row"

echo "check-metrics-sampler: the sampler fires, samples every table exactly once per fire, and cannot be called directly" >&2
exit 0
