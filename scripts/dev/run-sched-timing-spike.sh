#!/usr/bin/env bash
# Story 1.3's one-command re-run entry point. By default, brings up its
# own disposable local SpacetimeDB instance (never a developer's own
# `spacetime start`); set SCHED_TIMING_SERVER to point it at a different
# server instead (a nickname from `spacetime server list`, e.g.
# `maincloud`, or a URL) -- Crew itself never sets this (Crew does not
# deploy to Maincloud under any circumstance; that is CI's job, never a
# manual step), but the mechanism has to exist for a human with Maincloud
# publish rights to gather the authoritative reading Tim's direction
# calls for, with the same one command. Either way, publishes
# `server/spikes/sched_timing` under a throwaway, disposable database
# name per leg, runs three measurement legs, exports every leg's raw
# `observation` rows to CSV, reduces them with `sched_timing_report`, and
# tears everything -- process (if local) and databases -- down at the
# end. See docs/spikes/1.3-scheduled-reducer-timing.md for the
# pre-registered budget and the findings this script most recently
# produced.
#
# Every infrastructure failure -- no `spacetime` binary, the port already
# in use, the module failing to build, a publish that never comes up,
# fewer fires than the leg's own window and buckets make plausible --
# aborts loudly and immediately, the same discipline
# scripts/ci/check-live-migration.sh uses and for the same reason: a
# timing harness that silently misreports emits a beautiful drift table
# of zeros because no reducer ever fired, and nothing would catch it.
#
# Configuration (every default is what this script's own committed run
# used; env vars widen the ladder for a longer, more authoritative run --
# see the AUTHORITATIVE_RUN comment below):
#   SCHED_TIMING_SERVER              a server nickname or URL to run
#                                    against instead of a local instance
#                                    (skips self-start and its teardown)
#   SCHED_TIMING_PORT                local instance port (default 3990;
#                                    ignored when SCHED_TIMING_SERVER is set)
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
# bucket <=1s, >=30 at 30s/60s and whatever fits at 600s. Set
# SCHED_TIMING_IDLE_WINDOW_S=1860 (31 minutes) to reach 30+ samples at the
# 60s bucket for a longer, more authoritative re-run.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MODULE_DIR="$REPO_ROOT/server/spikes/sched_timing"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-sched-timing.XXXXXX")"
OUT_DIR="${SCHED_TIMING_OUT_DIR:-$DATA_DIR/out}"
mkdir -p "$OUT_DIR"
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1

LOCAL_INSTANCE=1
if [ -n "${SCHED_TIMING_SERVER:-}" ]; then
  LOCAL_INSTANCE=0
  SERVER_URL="$SCHED_TIMING_SERVER"
else
  PORT="${SCHED_TIMING_PORT:-3990}"
  SERVER_URL="http://127.0.0.1:$PORT"
fi

IDLE_BUCKETS_MS="${SCHED_TIMING_IDLE_BUCKETS_MS:-100 500 1000 10000 30000 60000 600000}"
IDLE_WINDOW_S="${SCHED_TIMING_IDLE_WINDOW_S:-650}"
LOAD_BUCKETS_MS="${SCHED_TIMING_LOAD_BUCKETS_MS:-100 500 1000}"
LOAD_WINDOW_S="${SCHED_TIMING_LOAD_WINDOW_S:-90}"
LOAD_SCALES="${SCHED_TIMING_LOAD_SCALES:-1000 10000}"
REPUBLISH_OFFSETS_MS="${SCHED_TIMING_REPUBLISH_OFFSETS_MS:-5000 15000 30000 60000 120000 300000 600000}"
REPUBLISH_INTERVAL_MS="${SCHED_TIMING_REPUBLISH_INTERVAL_MS:-1000}"
REPUBLISH_WAIT_S="${SCHED_TIMING_REPUBLISH_WAIT_S:-650}"
# The per-fire-cost comparison (Quentin's direction: the compounding rate
# is per-fire cost, not a platform constant): one interval probe at this
# bucket does WORK_EXTRA_WRITES extra table writes per fire, seeded
# alongside the normal zero-extra-writes ladder entry at the same bucket.
WORK_BUCKET_MS=1000
WORK_EXTRA_WRITES=50

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
  [ "$LOCAL_INSTANCE" -eq 1 ] && kill_tree "$START_PID"
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
if [ "$LOCAL_INSTANCE" -eq 0 ]; then
  RUN_ENV="remote ($SERVER_URL)"
elif [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  RUN_ENV="github-actions runner"
else
  RUN_ENV="dev box"
fi
RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "run-sched-timing-spike: SpacetimeDB $SPACETIME_VERSION on $HOST_LABEL ($RUN_ENV), started $RUN_DATE" >&2

echo "run-sched-timing-spike: building the native reduction binary" >&2
( cd "$REPO_ROOT/server" && cargo build --release -p sched_timing_report ) >"$DATA_DIR/report-build.log" 2>&1 \
  || fail "'cargo build -p sched_timing_report' failed" "$DATA_DIR/report-build.log"
REPORT_BIN="$REPO_ROOT/server/target/release/sched_timing_report"
[ -f "$REPORT_BIN" ] || REPORT_BIN="$REPO_ROOT/server/target/release/sched_timing_report.exe"
[ -x "$REPORT_BIN" ] || fail "sched_timing_report binary not found after build"

if [ "$LOCAL_INSTANCE" -eq 1 ]; then
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
else
  spacetime server ping "$SERVER_URL" >"$START_LOG" 2>&1 \
    || fail "could not reach '$SERVER_URL' (SCHED_TIMING_SERVER) -- is it a server nickname from 'spacetime server list', or already reachable?" "$START_LOG"
  echo "run-sched-timing-spike: remote server '$SERVER_URL' reachable, no local instance started" >&2
fi

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
    echo "run_id,mode,bucket_ms,sequence,run_start_micros,scheduled_at_micros,fired_at_micros,drift_micros"
    sql_json "$1" "SELECT run_id, mode, bucket_ms, sequence, run_start_micros, scheduled_at_micros, fired_at_micros, drift_micros FROM observation" 2>"$log" \
      | jq -r '.[0].rows[] | "\(.[0]),\(.[1]),\(.[2]),\(.[3]),\(.[4]),\(.[5]),\(.[6]),\(.[7])"'
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

# require_min_fires <csv-file> <expected-min> <label> -- Quentin's
# direction: no leg may declare success without checking anything
# actually fired. A generous fraction of the naive per-bucket expectation
# (never the full count -- publish/build overhead and per-fire cost both
# eat into the window), but a hard failure below it, since a scheduler
# stalled dead halfway yields a shorter CSV and a report that still
# renders unless something is watching for it.
require_min_fires() {
  local csv="$1" expected_min="$2" label="$3" actual
  actual="$(($(wc -l <"$csv") - 1))"
  [ "$actual" -ge "$expected_min" ] \
    || fail "$label recorded only $actual fire(s), expected at least $expected_min from its own window/buckets -- the scheduler may have stalled"
  echo "$actual"
}

# ---------------------------------------------------------------------------
# Leg 1: idle ladder -- ONESHOT_CHAINED, ONESHOT_ANCHORED and INTERVAL,
# side by side, at every bucket, on an otherwise-idle instance, plus one
# heavier-bodied INTERVAL probe for the per-fire-cost comparison. The
# control the load legs below are read against.
# ---------------------------------------------------------------------------
IDLE_DB="bc-sched-timing-idle-$RUN_ID_SUFFIX"
publish "$MODULE_DIR" "$IDLE_DB" "$DATA_DIR/publish-idle.log" || fail "could not publish the idle leg" "$DATA_DIR/publish-idle.log"
PUBLISHED_DBS+=("$IDLE_DB")
for b in $IDLE_BUCKETS_MS; do
  call "$IDLE_DB" seed_oneshot_ladder "\"idle-oneshot-$b\"" "$b"
  call "$IDLE_DB" seed_oneshot_anchored_ladder "\"idle-anchored-$b\"" "$b"
  call "$IDLE_DB" seed_interval_ladder "\"idle-interval-$b\"" "$b" "0"
done
call "$IDLE_DB" seed_interval_ladder "\"idle-interval-work${WORK_EXTRA_WRITES}-${WORK_BUCKET_MS}\"" "$WORK_BUCKET_MS" "$WORK_EXTRA_WRITES"

# Observer lateness (noisy control): subscribes for the whole idle
# window, prefixing every subscription update with the wall-clock micros
# it arrived at. Local loopback, one machine -- client and server share a
# clock, so this is the one place a client wall-clock read is the right
# tool (Quentin's direction: observer lateness is a client-side quantity
# by definition). The idle leg's own 100ms buckets push thousands of
# fires/sec through this one subscription -- Tim's direction: report that
# as a measurement limitation, not a platform number, and re-measure on a
# quiet leg (the republish leg, below) for comparison.
OBSERVER_IDLE_LOG="$DATA_DIR/observer-idle.log"
(
  spacetime subscribe "$IDLE_DB" "SELECT * FROM observation" --server "$SERVER_URL" --no-config -y \
    --timeout "$IDLE_WINDOW_S" 2>/dev/null \
    | while IFS= read -r line; do printf '%s %s\n' "$(date +%s%6N)" "$line"; done
) >"$OBSERVER_IDLE_LOG" 2>&1 &
OBSERVER_PID=$!

wait_window "$IDLE_DB" "$IDLE_WINDOW_S" "idle ladder"
kill_tree "$OBSERVER_PID"

IDLE_CSV="$OUT_DIR/idle-ladder.csv"
export_observations_csv "$IDLE_DB" "$IDLE_CSV"
IDLE_EXPECTED_MIN=0
for b in $IDLE_BUCKETS_MS; do
  IDLE_EXPECTED_MIN=$(( IDLE_EXPECTED_MIN + (IDLE_WINDOW_S * 1000 / b) * 3 ))
done
IDLE_EXPECTED_MIN=$(( IDLE_EXPECTED_MIN + IDLE_WINDOW_S * 1000 / WORK_BUCKET_MS ))
IDLE_EXPECTED_MIN=$(( IDLE_EXPECTED_MIN * 30 / 100 ))
IDLE_N="$(require_min_fires "$IDLE_CSV" "$IDLE_EXPECTED_MIN" "idle ladder")"
echo "run-sched-timing-spike: idle ladder -- $IDLE_N reducer fires recorded (expected at least $IDLE_EXPECTED_MIN)" >&2

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
    call "$LOAD_DB" seed_interval_ladder "\"load$scale-interval-$b\"" "$b" "0"
  done
  call "$LOAD_DB" seed_burst "\"load$scale-burst\"" "$scale" "2000"
  wait_window "$LOAD_DB" "$LOAD_WINDOW_S" "load x$scale"
  LOAD_CSV="$OUT_DIR/load-$scale.csv"
  export_observations_csv "$LOAD_DB" "$LOAD_CSV"
  LOAD_CSVS+=("$LOAD_CSV")
  LOAD_LADDER_MIN=0
  for b in $LOAD_BUCKETS_MS; do
    LOAD_LADDER_MIN=$(( LOAD_LADDER_MIN + (LOAD_WINDOW_S * 1000 / b) * 2 ))
  done
  LOAD_EXPECTED_MIN=$(( LOAD_LADDER_MIN * 30 / 100 + scale * 60 / 100 ))
  LOAD_N="$(require_min_fires "$LOAD_CSV" "$LOAD_EXPECTED_MIN" "load x$scale")"
  echo "run-sched-timing-spike: load x$scale -- $LOAD_N reducer fires recorded (expected at least $LOAD_EXPECTED_MIN, includes the $scale-row burst itself)" >&2
done

# ---------------------------------------------------------------------------
# Leg 3: republish while pending -- seeds one-shots across the offset
# ladder plus one repeating row, republishes the *same* module over the
# *same* database with no --delete-data before any of them fire, then
# watches what survives. Assert nothing about the outcome; record
# (Quentin's direction) -- but the seed itself is asserted: if fewer rows
# are pending than were seeded, the leg has nothing to measure.
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
REPUBLISH_EXPECTED_PENDING=$(( $(printf '%s\n' "$REPUBLISH_OFFSETS_MS" | wc -w) + 1 ))
[ "$PRE_PENDING_N" -eq "$REPUBLISH_EXPECTED_PENDING" ] \
  || fail "republish leg seeded $REPUBLISH_EXPECTED_PENDING probes but only $PRE_PENDING_N are pending before republish -- nothing to measure survival against"
echo "run-sched-timing-spike: republish leg -- $PRE_PENDING_N row(s) pending before republish, as seeded" >&2

# A second, quiet observer measurement (Tim's direction): the republish
# leg's fire rate is roughly 1/s, none of the idle leg's 100ms-bucket
# saturation -- the comparison point for whether that saturation, not the
# platform, produced the idle leg's wide observer-lateness tail.
OBSERVER_REPUBLISH_LOG="$DATA_DIR/observer-republish.log"
(
  spacetime subscribe "$REPUBLISH_DB" "SELECT * FROM observation" --server "$SERVER_URL" --no-config -y \
    --timeout "$REPUBLISH_WAIT_S" 2>/dev/null \
    | while IFS= read -r line; do printf '%s %s\n' "$(date +%s%6N)" "$line"; done
) >"$OBSERVER_REPUBLISH_LOG" 2>&1 &
OBSERVER_REPUBLISH_PID=$!

REPUBLISH_AT_MICROS="$(date +%s%6N)"
publish "$MODULE_DIR" "$REPUBLISH_DB" "$DATA_DIR/publish-republish-2.log" || fail "republish over the same database failed" "$DATA_DIR/publish-republish-2.log"
echo "run-sched-timing-spike: republish leg -- republished over live pending rows, now observing for ${REPUBLISH_WAIT_S}s" >&2

wait_window "$REPUBLISH_DB" "$REPUBLISH_WAIT_S" "republish survival"
kill_tree "$OBSERVER_REPUBLISH_PID"

REPUBLISH_CSV="$OUT_DIR/republish-leg.csv"
export_observations_csv "$REPUBLISH_DB" "$REPUBLISH_CSV"
POST_PENDING_JSON="$DATA_DIR/republish-post-pending.json"
sql_json "$REPUBLISH_DB" "SELECT scheduled_id, mode, bucket_ms, sequence FROM probe WHERE run_id = 'republish-leg'" >"$POST_PENDING_JSON" \
  || fail "querying pending probes after republish failed" "$POST_PENDING_JSON"

REPUBLISH_SUMMARY_JSON="$OUT_DIR/republish-summary.json"
jq -n \
  --slurpfile pre "$PRE_PENDING_JSON" \
  --slurpfile post "$POST_PENDING_JSON" \
  --argjson republish_at "$REPUBLISH_AT_MICROS" \
  '{
    republished_at_micros: $republish_at,
    pending_before: ($pre[0][0].rows // []),
    pending_after: ($post[0][0].rows // [])
  }' >"$REPUBLISH_SUMMARY_JSON"
echo "run-sched-timing-spike: republish leg -- wrote $REPUBLISH_SUMMARY_JSON (pending before/after; sched_timing_report classifies survival against $REPUBLISH_CSV, never a duplicated copy of it)" >&2

# ---------------------------------------------------------------------------
# Reduce every leg through the native binary -- the ladder legs, both
# observer logs, and the republish classification.
# ---------------------------------------------------------------------------
REPORT_MD="$OUT_DIR/report.md"
{
  echo "<!-- bc:sched-timing-spacetimedb-version $SPACETIME_VERSION -->"
  echo "<!-- generated by scripts/dev/run-sched-timing-spike.sh on $RUN_DATE, host=$HOST_LABEL, env=$RUN_ENV -->"
  echo
  echo "### Idle ladder"
  echo
  "$REPORT_BIN" ladder "$IDLE_CSV"
  idx=0
  for scale in $LOAD_SCALES; do
    echo
    echo "### Under load, x$scale rows in one tick"
    echo
    "$REPORT_BIN" ladder "${LOAD_CSVS[$idx]}"
    idx=$((idx + 1))
  done
  echo
  echo "### Observer lateness -- idle leg (100ms buckets present)"
  echo
  "$REPORT_BIN" observer "$OBSERVER_IDLE_LOG"
  echo
  echo "### Observer lateness -- republish leg (quiet, ~1 fire/s, no 100ms buckets)"
  echo
  "$REPORT_BIN" observer "$OBSERVER_REPUBLISH_LOG"
  echo
  echo "### Republish leg"
  echo
  "$REPORT_BIN" republish "$REPUBLISH_SUMMARY_JSON" "$REPUBLISH_CSV"
} >"$REPORT_MD"

echo "run-sched-timing-spike: wrote $REPORT_MD" >&2
cp "$OBSERVER_IDLE_LOG" "$OUT_DIR/observer-lateness-idle.log" 2>/dev/null \
  && cp "$OBSERVER_REPUBLISH_LOG" "$OUT_DIR/observer-lateness-republish.log" 2>/dev/null \
  && echo "run-sched-timing-spike: both observer logs copied into $OUT_DIR" >&2

echo "run-sched-timing-spike: done. Raw CSVs, republish-summary.json, both observer logs and report.md are in $OUT_DIR" >&2
