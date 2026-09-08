#!/usr/bin/env bash
# Story 1.3's one-command re-run entry point. Brings up its own disposable
# local SpacetimeDB instance (never Maincloud, never a developer's own
# `spacetime start`), publishes `server/spikes/sched_timing` under a
# throwaway database name per leg, runs three measurement legs, exports
# every leg's raw `observation` rows to CSV and reduces the ladder legs
# with `sched_timing_report`, and tears everything -- process and
# databases -- down at the end. See docs/spikes/1.3-scheduled-reducer-
# timing.md for the pre-registered budget and the findings this script
# most recently produced.
#
# Every infrastructure failure -- no `spacetime` binary, the port already
# in use, the module failing to build, a publish that never comes up --
# aborts loudly and immediately, the same discipline
# scripts/ci/check-live-migration.sh uses and for the same reason: a
# timing harness that silently misreports emits a beautiful drift table
# of zeros because no reducer ever fired, and nothing would catch it.
#
# Configuration (every default is what this script's own committed run
# used; env vars widen the ladder for a longer, more authoritative run --
# see the AUTHORITATIVE_* comment below):
#   SCHED_TIMING_PORT               local instance port (default 3990)
#   SCHED_TIMING_OUT_DIR             where CSVs/report land (default a
#                                    disposable temp dir; point this at
#                                    docs/spikes/1.3-scheduled-reducer-
#                                    timing/ to produce a committable run)
#   SCHED_TIMING_IDLE_BUCKETS_MS     space-separated ladder, ms
#   SCHED_TIMING_IDLE_WINDOW_S       idle leg wall-clock budget
#   SCHED_TIMING_LOAD_BUCKETS_MS     ladder measured under load
#   SCHED_TIMING_LOAD_WINDOW_S       per-scale wall-clock budget
#   SCHED_TIMING_LOAD_SCALES         space-separated burst sizes
#   SCHED_TIMING_REPUBLISH_OFFSETS_MS  one-shot offsets, ms, seeded then
#                                      republished over before any fire
#   SCHED_TIMING_REPUBLISH_INTERVAL_MS  the republish leg's one repeating row
#   SCHED_TIMING_REPUBLISH_WAIT_S    how long to observe survival after
#                                    republishing (must exceed the largest
#                                    republish offset)
#   SCHED_TIMING_HOST_LABEL          overrides the report header's host
#
# AUTHORITATIVE_RUN: Quentin's direction asks for >=200 samples at every
# bucket <=1s, >=30 at 30s/60s and whatever fits at 600s; this script's
# own defaults are sized to fit one implementer session (~26 minutes
# total) rather than that full depth -- 30s/60s land under 30 samples,
# honestly labelled by sched_timing_report rather than padded. Set
# SCHED_TIMING_IDLE_WINDOW_S=1860 (31 minutes) to reach 30+ samples at the
# 60s bucket for a longer, more authoritative re-run.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MODULE_DIR="$REPO_ROOT/server/spikes/sched_timing"

PORT="${SCHED_TIMING_PORT:-3990}"
SERVER_URL="http://127.0.0.1:$PORT"
DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-sched-timing.XXXXXX")"
OUT_DIR="${SCHED_TIMING_OUT_DIR:-$DATA_DIR/out}"
mkdir -p "$OUT_DIR"
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1

IDLE_BUCKETS_MS="${SCHED_TIMING_IDLE_BUCKETS_MS:-100 500 1000 10000 30000 60000 600000}"
IDLE_WINDOW_S="${SCHED_TIMING_IDLE_WINDOW_S:-650}"
LOAD_BUCKETS_MS="${SCHED_TIMING_LOAD_BUCKETS_MS:-100 500 1000}"
LOAD_WINDOW_S="${SCHED_TIMING_LOAD_WINDOW_S:-90}"
LOAD_SCALES="${SCHED_TIMING_LOAD_SCALES:-1000 10000}"
REPUBLISH_OFFSETS_MS="${SCHED_TIMING_REPUBLISH_OFFSETS_MS:-5000 15000 30000 60000 120000 300000 600000}"
REPUBLISH_INTERVAL_MS="${SCHED_TIMING_REPUBLISH_INTERVAL_MS:-1000}"
REPUBLISH_WAIT_S="${SCHED_TIMING_REPUBLISH_WAIT_S:-650}"

RUN_ID_SUFFIX="$$"
START_PID=""
PUBLISHED_DBS=()

kill_tree() { # <msys-pid>
  local pid="$1" winpid=""
  [ -n "$pid" ] || return 0
  if command -v taskkill >/dev/null 2>&1; then
    winpid="$(ps -l 2>/dev/null | awk -v p="$pid" '$1 == p { print $4 }')"
    taskkill //F //T //PID "${winpid:-$pid}" >/dev/null 2>&1
  fi
  kill "$pid" 2>/dev/null
}

cleanup() {
  for db in "${PUBLISHED_DBS[@]:-}"; do
    [ -n "$db" ] || continue
    spacetime delete "$db" --server "$SERVER_URL" --no-config -y >/dev/null 2>&1
  done
  kill_tree "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "run-sched-timing-spike: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}

command -v spacetime >/dev/null 2>&1 || fail "'spacetime' is not on PATH"
command -v jq >/dev/null 2>&1 || fail "'jq' is not on PATH"

VERSION_OUTPUT="$(spacetime --version 2>&1)"
SPACETIME_VERSION="$(printf '%s' "$VERSION_OUTPUT" | grep -oE 'spacetimedb tool version [0-9]+\.[0-9]+\.[0-9]+' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
[ -n "$SPACETIME_VERSION" ] || fail "could not parse a version out of 'spacetime --version':" <(printf '%s' "$VERSION_OUTPUT")
HOST_LABEL="${SCHED_TIMING_HOST_LABEL:-$(hostname 2>/dev/null || echo unknown-host)}"
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then RUN_ENV="github-actions runner"; else RUN_ENV="dev box"; fi
RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "run-sched-timing-spike: SpacetimeDB $SPACETIME_VERSION on $HOST_LABEL ($RUN_ENV), started $RUN_DATE" >&2

echo "run-sched-timing-spike: building the native reduction binary" >&2
( cd "$REPO_ROOT/server" && cargo build --release -p sched_timing_report ) >"$DATA_DIR/report-build.log" 2>&1 \
  || fail "'cargo build -p sched_timing_report' failed" "$DATA_DIR/report-build.log"
REPORT_BIN="$REPO_ROOT/server/target/release/sched_timing_report"
[ -f "$REPORT_BIN" ] || REPORT_BIN="$REPO_ROOT/server/target/release/sched_timing_report.exe"
[ -x "$REPORT_BIN" ] || fail "sched_timing_report binary not found after build"

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
echo "run-sched-timing-spike: local instance healthy on $SERVER_URL" >&2

publish() { # <module-dir> <db-name> <log-file> [--delete-data]
  local extra=""
  [ "${4:-}" = "--delete-data" ] && extra="--delete-data=always"
  # shellcheck disable=SC2086
  spacetime publish --server "$SERVER_URL" --no-config -y $extra "$2" --module-path "$1" >"$3" 2>&1
}

call() { # <db> <reducer> <args...> -- a failed call is a hard, immediate
         # failure: a seed reducer that silently never ran would produce a
         # beautiful, meaningless table of zero samples.
  local db="$1" reducer="$2"
  local log="$DATA_DIR/call-$db-$reducer-$RANDOM.log"
  shift 2
  spacetime call "$db" --server "$SERVER_URL" --no-config -y "$reducer" "$@" >"$log" 2>&1 \
    || fail "call to '$reducer' on '$db' failed" "$log"
}

# Deliberately does not suppress stderr: a real query failure (a typo'd
# column name bit us once while building this script -- 'null' silently
# fell out of a downstream jq rather than a loud error) must stay visible,
# not be indistinguishable from the CLI's harmless "UNSTABLE" banner.
sql_json() { # <db> <query>
  spacetime sql "$1" --server "$SERVER_URL" --no-config -y --format json "$2"
}

# Best-effort: called every 30s purely to print a heartbeat during a long
# wait_window, so a transient hiccup here prints "?" rather than aborting
# the whole leg -- unlike every other sql_json caller below, which fails
# loudly.
observation_count() { # <db>
  sql_json "$1" "SELECT id FROM observation" 2>/dev/null | jq '.[0].rows | length' 2>/dev/null || echo "?"
}

export_observations_csv() { # <db> <out-csv>
  local log="$DATA_DIR/export-$RANDOM.log"
  {
    echo "run_id,mode,bucket_ms,sequence,scheduled_at_micros,fired_at_micros,drift_micros"
    sql_json "$1" "SELECT run_id, mode, bucket_ms, sequence, scheduled_at_micros, fired_at_micros, drift_micros FROM observation" 2>"$log" \
      | jq -r '.[0].rows[] | "\(.[0]),\(.[1]),\(.[2]),\(.[3]),\(.[4]),\(.[5]),\(.[6])"'
  } >"$2" || fail "exporting observations from '$1' failed" "$log"
}

wait_window() { # <db> <total-seconds> <label>
  local db="$1" total="$2" label="$3" deadline next_report n
  deadline=$((SECONDS + total))
  next_report=$((SECONDS + 30))
  echo "run-sched-timing-spike: $label -- running for ${total}s" >&2
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$SECONDS" -ge "$next_report" ]; then
      n="$(observation_count "$db")"
      echo "run-sched-timing-spike: $label -- ${n} observations so far, $(( deadline - SECONDS ))s remaining" >&2
      next_report=$((SECONDS + 30))
    fi
    sleep 2
  done
}

# ---------------------------------------------------------------------------
# Leg 1: idle ladder -- ONESHOT_CHAINED and INTERVAL, side by side, at every
# bucket, on an otherwise-idle instance. The control the load legs below are
# read against.
# ---------------------------------------------------------------------------
IDLE_DB="bc-sched-timing-idle-$RUN_ID_SUFFIX"
publish "$MODULE_DIR" "$IDLE_DB" "$DATA_DIR/publish-idle.log" || fail "could not publish the idle leg" "$DATA_DIR/publish-idle.log"
PUBLISHED_DBS+=("$IDLE_DB")
for b in $IDLE_BUCKETS_MS; do
  call "$IDLE_DB" seed_oneshot_ladder "\"idle-oneshot-$b\"" "$b"
  call "$IDLE_DB" seed_interval_ladder "\"idle-interval-$b\"" "$b"
done

# Observer lateness: subscribes for the whole idle window, prefixing every
# subscription update with the wall-clock micros it arrived at. Local
# loopback, one machine -- client and server share a clock, so this is the
# one place a client wall-clock read is the right tool (Quentin's
# direction: observer lateness is a client-side quantity by definition).
OBSERVER_LOG="$DATA_DIR/observer.log"
(
  spacetime subscribe "$IDLE_DB" "SELECT * FROM observation" --server "$SERVER_URL" --no-config -y \
    --timeout "$IDLE_WINDOW_S" 2>/dev/null \
    | while IFS= read -r line; do printf '%s %s\n' "$(date +%s%6N)" "$line"; done
) >"$OBSERVER_LOG" 2>&1 &
OBSERVER_PID=$!

wait_window "$IDLE_DB" "$IDLE_WINDOW_S" "idle ladder"
kill_tree "$OBSERVER_PID"

IDLE_CSV="$OUT_DIR/idle-ladder.csv"
export_observations_csv "$IDLE_DB" "$IDLE_CSV"
IDLE_N="$(($(wc -l <"$IDLE_CSV") - 1))"
echo "run-sched-timing-spike: idle ladder -- $IDLE_N reducer fires recorded" >&2

# ---------------------------------------------------------------------------
# Leg 2: under load -- the same fast-bucket ladder, but with a burst of
# LOAD_SCALES rows all due in the same tick landing partway through the
# window.
# ---------------------------------------------------------------------------
LOAD_CSVS=()
for scale in $LOAD_SCALES; do
  LOAD_DB="bc-sched-timing-load-$scale-$RUN_ID_SUFFIX"
  publish "$MODULE_DIR" "$LOAD_DB" "$DATA_DIR/publish-load-$scale.log" || fail "could not publish the load-$scale leg" "$DATA_DIR/publish-load-$scale.log"
  PUBLISHED_DBS+=("$LOAD_DB")
  for b in $LOAD_BUCKETS_MS; do
    call "$LOAD_DB" seed_oneshot_ladder "\"load$scale-oneshot-$b\"" "$b"
    call "$LOAD_DB" seed_interval_ladder "\"load$scale-interval-$b\"" "$b"
  done
  call "$LOAD_DB" seed_burst "\"load$scale-burst\"" "$scale" "2000"
  wait_window "$LOAD_DB" "$LOAD_WINDOW_S" "load x$scale"
  LOAD_CSV="$OUT_DIR/load-$scale.csv"
  export_observations_csv "$LOAD_DB" "$LOAD_CSV"
  LOAD_CSVS+=("$LOAD_CSV")
  LOAD_N="$(($(wc -l <"$LOAD_CSV") - 1))"
  echo "run-sched-timing-spike: load x$scale -- $LOAD_N reducer fires recorded (includes the $scale-row burst itself)" >&2
done

# ---------------------------------------------------------------------------
# Leg 3: republish while pending -- seeds one-shots across the offset
# ladder plus one repeating row, republishes the *same* module over the
# *same* database with no --delete-data before any of them fire, then
# watches what survives. Assert nothing; record (Quentin's direction).
# ---------------------------------------------------------------------------
REPUBLISH_DB="bc-sched-timing-republish-$RUN_ID_SUFFIX"
publish "$MODULE_DIR" "$REPUBLISH_DB" "$DATA_DIR/publish-republish-1.log" || fail "could not publish the republish leg" "$DATA_DIR/publish-republish-1.log"
PUBLISHED_DBS+=("$REPUBLISH_DB")

OFFSETS_JSON="[$(printf '%s' "$REPUBLISH_OFFSETS_MS" | tr ' ' '\n' | paste -sd, -)]"
call "$REPUBLISH_DB" seed_republish_leg "\"republish-leg\"" "$OFFSETS_JSON" "$REPUBLISH_INTERVAL_MS"

PRE_PENDING_JSON="$DATA_DIR/republish-pre-pending.json"
sql_json "$REPUBLISH_DB" "SELECT scheduled_id, mode, bucket_ms, sequence FROM probe WHERE run_id = 'republish-leg'" >"$PRE_PENDING_JSON" \
  || fail "querying pending probes before republish failed" "$PRE_PENDING_JSON"
PRE_PENDING_N="$(jq '.[0].rows | length' "$PRE_PENDING_JSON")"
echo "run-sched-timing-spike: republish leg -- $PRE_PENDING_N row(s) pending before republish" >&2

REPUBLISH_AT_MICROS="$(date +%s%6N)"
publish "$MODULE_DIR" "$REPUBLISH_DB" "$DATA_DIR/publish-republish-2.log" || fail "republish over the same database failed" "$DATA_DIR/publish-republish-2.log"
echo "run-sched-timing-spike: republish leg -- republished over live pending rows, now observing for ${REPUBLISH_WAIT_S}s" >&2

wait_window "$REPUBLISH_DB" "$REPUBLISH_WAIT_S" "republish survival"

REPUBLISH_CSV="$OUT_DIR/republish-leg.csv"
export_observations_csv "$REPUBLISH_DB" "$REPUBLISH_CSV"
POST_PENDING_JSON="$DATA_DIR/republish-post-pending.json"
sql_json "$REPUBLISH_DB" "SELECT scheduled_id, mode, bucket_ms, sequence FROM probe WHERE run_id = 'republish-leg'" >"$POST_PENDING_JSON" \
  || fail "querying pending probes after republish failed" "$POST_PENDING_JSON"

REPUBLISH_FIRED_LOG="$DATA_DIR/republish-fired-query.log"
REPUBLISH_FIRED_JSON="$DATA_DIR/republish-fired.json"
sql_json "$REPUBLISH_DB" "SELECT id, mode, bucket_ms, sequence, scheduled_at_micros, fired_at_micros, drift_micros FROM observation" 2>"$REPUBLISH_FIRED_LOG" \
  | jq '[.[0].rows[]]' >"$REPUBLISH_FIRED_JSON" \
  || fail "querying fired probes for the republish leg failed" "$REPUBLISH_FIRED_LOG"

REPUBLISH_SUMMARY_JSON="$OUT_DIR/republish-summary.json"
jq -n \
  --slurpfile pre "$PRE_PENDING_JSON" \
  --slurpfile post "$POST_PENDING_JSON" \
  --slurpfile fired "$REPUBLISH_FIRED_JSON" \
  --argjson republish_at "$REPUBLISH_AT_MICROS" \
  '{
    republished_at_micros: $republish_at,
    pending_before: ($pre[0][0].rows // []),
    pending_after: ($post[0][0].rows // []),
    fired: $fired[0]
  }' >"$REPUBLISH_SUMMARY_JSON"
echo "run-sched-timing-spike: republish leg -- wrote $REPUBLISH_SUMMARY_JSON (pending before/after, and every fire, for the harness/report to classify)" >&2

# ---------------------------------------------------------------------------
# Reduce the two ladder legs (idle, load) through the native binary.
# ---------------------------------------------------------------------------
REPORT_MD="$OUT_DIR/report.md"
{
  echo "<!-- bc:sched-timing-spacetimedb-version $SPACETIME_VERSION -->"
  echo "<!-- generated by scripts/dev/run-sched-timing-spike.sh on $RUN_DATE, host=$HOST_LABEL, env=$RUN_ENV -->"
  echo
  echo "### Idle ladder"
  echo
  "$REPORT_BIN" "$IDLE_CSV"
  idx=0
  for scale in $LOAD_SCALES; do
    echo
    echo "### Under load, x$scale rows in one tick"
    echo
    "$REPORT_BIN" "${LOAD_CSVS[$idx]}"
    idx=$((idx + 1))
  done
} >"$REPORT_MD"

echo "run-sched-timing-spike: wrote $REPORT_MD" >&2
cp "$OBSERVER_LOG" "$OUT_DIR/observer-lateness.log" 2>/dev/null \
  && echo "run-sched-timing-spike: observer-lateness log copied to $OUT_DIR/observer-lateness.log" >&2

echo "run-sched-timing-spike: done. Raw CSVs, republish-summary.json and report.md are in $OUT_DIR" >&2
