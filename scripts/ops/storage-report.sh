#!/usr/bin/env bash
# The watcher's one reader (FR170, NFR15): prints the metrics sampler's
# newest figures and exits 1 when any breach flag is set -- the newest
# `storage_sample`'s over_review/over_wall, or any `table_sample` row of the
# same fire with over_alert -- or when the newest sample is older than three
# sampler periods (a sampler that fired once and never again is a dead
# alarm, not a healthy one). Reads durable columns over `spacetime sql` as
# the owner, never a log line. `bytes_est` is an estimate (row count x
# sampled row size, excluding indexes and the commit log), not host
# storage. Also prints the newest fire's `reducer_class_sample` rows (calls
# per reducer class, NFR17); no threshold applies to them.
#
# Exit codes: 0 healthy (or no samples yet), 1 a breach, 2 the watcher
# could not read (a network or auth failure, an unparseable reply, a usage
# error) -- an unreadable database is never reported as a breach.
#
# `--findings <file>` writes one tab-separated `title<TAB>detail` line per
# breach (the file is emptied first). The title is stable across runs for
# one finding -- it names the table or the storage class, never the figure
# -- because it is the dedupe key of the issue `report-scheduled-failure.sh`
# files; the figure is in the detail.
#
# Maincloud scales an idle database to zero and a pending schedule does not
# wake it: the first read of a run wakes it. So before measuring, the report
# settles: it reads `metrics_sample_schedule` until its pending target is in
# the future (`--settle` seconds, default 60, polled every 5 s). A target
# still past, or no pending row, is a scheduler that is not dispatching:
# `watcher: sampler stale`. Cadences that fired within WAKE_SKEW_MICROS of
# the report's start are printed as `fired during this read`. The report also
# prints the largest gap between samples over the last poll window and
# raises the same `watcher: sampler stale` finding for any gap over three
# periods, so an outage that healed before this run is still reported.
#
# Usage: storage-report.sh <database> [--server <server>] [--now <micros>]
#        [--findings <file>] [--settle <seconds>]
# `--now` overrides the runner's clock (tests); `BC_SLEEP` overrides `sleep`.
# Prints "no storage samples yet" and exits 0 when the sampler has not
# fired at all.
set -uo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

# Three sampler periods, in micros: sim::cadence::METRICS_PERIOD_MS is one
# real hour at speed 1 (the production speed).
STALE_MICROS=$((3 * 3600 * 1000000))

# Runner/server clock skew allowance for "fired during this read": the
# server clock was seen 2 s behind the runner's; 10 s is five times that.
WAKE_SKEW_MICROS=$((10 * 1000000))
# The gap history window: the watcher polls every 6 h; one more hour of
# margin so a late poll still sees the whole previous window.
GAP_WINDOW_MICROS=$((7 * 3600 * 1000000))
SETTLE_STEP_SECONDS=5

unreadable() { # <message>
  echo "storage-report: could not read the metrics -- $1" >&2
  exit 2
}

USAGE="usage: storage-report.sh <database> [--server <server>] [--now <micros>] [--findings <file>] [--settle <seconds>]"
DB="${1:-}"
[ -n "$DB" ] || unreadable "$USAGE"
shift
SERVER_ARGS=()
NOW_MICROS=""
FINDINGS_FILE=""
SETTLE_SECONDS=60
INJECTED_NOW=0
while [ "$#" -ge 2 ]; do
  case "$1" in
    --server) SERVER_ARGS=(--server "$2") ;;
    --now) NOW_MICROS="$2"; INJECTED_NOW=1 ;;
    --settle) SETTLE_SECONDS="$2" ;;
    --findings) FINDINGS_FILE="$2" ;;
    *) break ;;
  esac
  shift 2
done
case "$SETTLE_SECONDS" in ''|*[!0-9]*) unreadable "--settle needs whole seconds -- $USAGE" ;; esac
runner_now() { # the runner's clock, or the injected one
  if [ "$INJECTED_NOW" -eq 1 ]; then echo "$NOW_MICROS"; else echo $(($(date +%s) * 1000000)); fi
}
[ -n "$NOW_MICROS" ] || NOW_MICROS="$(runner_now)"
START_MICROS="$NOW_MICROS"
[ "$#" -eq 0 ] || unreadable "unrecognized argument(s): $* -- $USAGE"
[ -z "$FINDINGS_FILE" ] || : >"$FINDINGS_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# read_table <table> <outfile> -- `bc_sql_json` dies with exit 1; the
# subshell keeps that from being mistaken for a breach.
read_table() {
  ( bc_sql_json "storage-report" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $1" >"$2" ) 2>"$TMP/read-error.log" \
    || unreadable "$(cat "$TMP/read-error.log")"
}
BREACH=0
# finding <title> <detail> -- a breach: stderr, and the findings file.
finding() {
  BREACH=1
  echo "storage-report: BREACH -- $2" >&2
  [ -z "$FINDINGS_FILE" ] || printf '%s\t%s\n' "$1" "$2" >>"$FINDINGS_FILE"
}

# Settle: the first read wakes the database; wait for its overdue fire.
micros_of() { printf '%s' "$1" | grep -oE '[0-9]+' | tail -n1; }
STALE_REASONS=()
pending_target() { # sets TARGET to the earliest pending target in micros, or ""
  read_table metrics_sample_schedule "$TMP/schedule.json"
  bc_wb row-count "$TMP/schedule.json" >/dev/null || unreadable "unparseable metrics_sample_schedule reply"
  local v t="" m
  while IFS= read -r v; do
    m="$(micros_of "$v")"
    [ -n "$m" ] || continue
    if [ -z "$t" ] || [ "$m" -lt "$t" ]; then t="$m"; fi
  done < <(bc_wb column-values "$TMP/schedule.json" scheduled_at)
  TARGET="$t"
}
POLLS=$((SETTLE_SECONDS / SETTLE_STEP_SECONDS))
TARGET=""
pending_target
ATTEMPT=0
while [ -n "$TARGET" ] && [ "$TARGET" -le "$(runner_now)" ] && [ "$ATTEMPT" -lt "$POLLS" ]; do
  ${BC_SLEEP:-sleep} "$SETTLE_STEP_SECONDS"
  ATTEMPT=$((ATTEMPT + 1))
  pending_target
done
NOW_MICROS="$(runner_now)"
if [ -z "$TARGET" ]; then
  STALE_REASONS+=("no pending metrics_sample_schedule row: the sampler is not armed")
elif [ "$TARGET" -le "$NOW_MICROS" ]; then
  STALE_REASONS+=("the pending sampler target is $(((NOW_MICROS - TARGET) / 1000000))s past after settling ${SETTLE_SECONDS}s: the scheduler is not dispatching")
fi

read_table storage_sample "$TMP/storage.json"
read_table table_sample "$TMP/tables.json"
read_table reducer_class_sample "$TMP/classes.json"

# An unparseable reply is unreadable, never an empty table: validated here,
# once, because a failure inside the process substitutions below could not
# exit this shell.
for f in storage tables classes; do
  bc_wb row-count "$TMP/$f.json" >/dev/null || unreadable "unparseable $f reply"
done
column() { bc_wb column-values "$1" "$2"; }

STORAGE_ROWS="$(bc_wb row-count "$TMP/storage.json")"
if [ "$STORAGE_ROWS" -eq 0 ]; then
  echo "storage-report: no storage samples yet"
  if [ "${#STALE_REASONS[@]}" -gt 0 ]; then
    finding "watcher: sampler stale" "STALE -- $(printf '%s; ' "${STALE_REASONS[@]}" | sed 's/; $//')"
    exit 1
  fi
  exit 0
fi

paste -d'|' \
  <(column "$TMP/storage.json" sample_id) \
  <(column "$TMP/storage.json" sampled_at) \
  <(column "$TMP/storage.json" total_bytes_est) \
  <(column "$TMP/storage.json" over_review) \
  <(column "$TMP/storage.json" over_wall)   <(column "$TMP/storage.json" review_bytes)   <(column "$TMP/storage.json" wall_bytes) >"$TMP/storage.rows"
NEWEST="$(sort -t'|' -k1,1n "$TMP/storage.rows" | tail -n1)"
IFS='|' read -r _ SAMPLED_AT TOTAL OVER_REVIEW OVER_WALL REVIEW_BYTES WALL_BYTES <<<"$NEWEST"

echo "storage-report: newest sample $SAMPLED_AT -- estimated total $TOTAL bytes (over_review=$OVER_REVIEW over_wall=$OVER_WALL)"

paste -d'|' \
  <(column "$TMP/tables.json" sampled_at) \
  <(column "$TMP/tables.json" table_accessor) \
  <(column "$TMP/tables.json" rows) \
  <(column "$TMP/tables.json" alert_rows) \
  <(column "$TMP/tables.json" max_rows) \
  <(column "$TMP/tables.json" over_alert) >"$TMP/tables.rows"

paste -d'|' \
  <(column "$TMP/classes.json" sampled_at) \
  <(column "$TMP/classes.json" class) \
  <(column "$TMP/classes.json" calls_total) \
  <(column "$TMP/classes.json" calls_delta) >"$TMP/classes.rows"

# Gameplay metrics (story 4.14): the newest fire's rows as one section,
# `gameplay <series> <value>/<sample_size>`. Best effort and never a
# finding: no target exists yet, "sampler stale" already covers them.
GOLDEN="$SCRIPT_DIR/../../server/sim/tests/goldens/codes_gameplay_metrics_v1.golden"
series_name() { # <code>
  local n
  n="$(awk -v c="$1" '$1 == "series" && $2 == c { print $3 }' "$GOLDEN" 2>/dev/null | tr -d '\r')"
  echo "${n:-series_$1}"
}
if ( bc_sql_json "storage-report" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM gameplay_metric_sample" >"$TMP/gameplay.json" ) 2>"$TMP/gameplay-error.log"   && bc_wb row-count "$TMP/gameplay.json" >/dev/null 2>&1; then
  paste -d'|'     <(column "$TMP/gameplay.json" sampled_at)     <(column "$TMP/gameplay.json" series_code)     <(column "$TMP/gameplay.json" value)     <(column "$TMP/gameplay.json" sample_size) >"$TMP/gameplay.rows"
  GAMEPLAY_LINES=""
  while IFS='|' read -r at code value size; do
    [ "$at" = "$SAMPLED_AT" ] || continue
    GAMEPLAY_LINES="$GAMEPLAY_LINES$(printf 'storage-report:   gameplay %s %s/%s
' "$(series_name "$code")" "$value" "$size")"$'
'
  done <"$TMP/gameplay.rows"
  [ -z "$GAMEPLAY_LINES" ] || printf '%s' "$GAMEPLAY_LINES"
else
  echo "storage-report: gameplay metrics unreadable" >&2
  cat "$TMP/gameplay-error.log" >&2
fi

# Cadence liveness, one line per armed cadence (the code is
# `cadence_code` in server/src/tables/schedules.rs), ages in seconds against
# the same clock as the stale check. Best effort: a failed read changes the
# text, never the verdict; its reason reaches the job log.
age_of() { # <timestamp> -- seconds before NOW_MICROS, or "?"
  local m
  m="$(micros_of "$1")"
  if [ -z "$m" ]; then echo "?"
  elif [ "$m" -ge $((START_MICROS - WAKE_SKEW_MICROS)) ]; then echo "fired during this read"
  else echo "$(((NOW_MICROS - m) / 1000000))s ago"; fi
}
LIVENESS_LINES=""
LIVENESS_ERR=""
if ( bc_sql_json "storage-report" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM cadence_liveness" >"$TMP/liveness.json" ) 2>"$TMP/liveness-error.log" \
  && bc_wb row-count "$TMP/liveness.json" >/dev/null 2>&1; then
  paste -d'|' \
    <(column "$TMP/liveness.json" cadence) \
    <(column "$TMP/liveness.json" last_target_at) \
    <(column "$TMP/liveness.json" last_fired_at) \
    <(column "$TMP/liveness.json" fires) \
    <(column "$TMP/liveness.json" missed) >"$TMP/liveness.rows"
  while IFS='|' read -r c t f n m; do
    [ -n "$c" ] || continue
    LIVENESS_LINES="${LIVENESS_LINES:+$LIVENESS_LINES; }cadence $c: last fired $(age_of "$f"), last target $(age_of "$t"), fires=$n missed=$m"
  done <"$TMP/liveness.rows"
  [ -n "$LIVENESS_LINES" ] || LIVENESS_LINES="no rows"
else
  LIVENESS_ERR="cadence liveness unreadable"
  cat "$TMP/liveness-error.log" >&2
fi
LIVENESS_TEXT="${LIVENESS_ERR:-cadence liveness: $LIVENESS_LINES}"
echo "storage-report: $LIVENESS_TEXT"

SAMPLED_MICROS="$(micros_of "$SAMPLED_AT")"
if [ -n "$SAMPLED_MICROS" ] && [ $((NOW_MICROS - SAMPLED_MICROS)) -gt "$STALE_MICROS" ]; then
  STALE_REASONS+=("the newest sample is $(((NOW_MICROS - SAMPLED_MICROS) / 1000000))s old, over three sampler periods ($((STALE_MICROS / 1000000))s): the sampler has stopped")
fi

# Gap history: every gap between consecutive samples inside the poll window,
# and the newest sample to the start of this read. The same three-period
# rule as the head check, applied to history.
WINDOW_START=$((START_MICROS - GAP_WINDOW_MICROS))
SAMPLE_TIMES="$(column "$TMP/storage.json" sampled_at | while IFS= read -r v; do
  m="$(micros_of "$v")"
  [ -n "$m" ] || { echo "BAD"; continue; }
  echo "$m"
done | sort -n)"
case "$SAMPLE_TIMES" in *BAD*) unreadable "unparseable sampled_at in the sample series" ;; esac
PREV=""
LARGEST=0
while IFS= read -r m; do
  [ -n "$m" ] || continue
  if [ -n "$PREV" ] && [ "$m" -ge "$WINDOW_START" ] && [ $((m - PREV)) -gt "$LARGEST" ]; then
    LARGEST=$((m - PREV))
  fi
  PREV="$m"
done <<<"$SAMPLE_TIMES"
TAIL_GAP=$((START_MICROS - PREV))
[ "$TAIL_GAP" -ge 0 ] || TAIL_GAP=0
echo "storage-report: sample gaps over the last $((GAP_WINDOW_MICROS / 3600000000))h: largest between samples $((LARGEST / 1000000))s, newest sample to start of read ${TAIL_GAP}s"
if [ "$LARGEST" -gt "$STALE_MICROS" ]; then
  STALE_REASONS+=("a gap of $((LARGEST / 1000000))s between samples inside the last $((GAP_WINDOW_MICROS / 3600000000))h is over three sampler periods ($((STALE_MICROS / 1000000))s): the sampler stopped and healed before this run")
elif [ "$TAIL_GAP" -gt "$STALE_MICROS" ]; then
  STALE_REASONS+=("the newest sample is ${TAIL_GAP}s older than the start of this read, over three sampler periods ($((STALE_MICROS / 1000000))s): the sampler stopped")
fi
if [ "${#STALE_REASONS[@]}" -gt 0 ]; then
  REASONS="$(printf '%s; ' "${STALE_REASONS[@]}")"
  finding "watcher: sampler stale" "STALE -- ${REASONS%; }. $LIVENESS_TEXT"
fi
if [ "$OVER_WALL" = "true" ]; then
  finding "watcher: storage over wall" "estimated storage total $TOTAL bytes is past the wall of $WALL_BYTES bytes"
elif [ "$OVER_REVIEW" = "true" ]; then
  finding "watcher: storage over review" "estimated storage total $TOTAL bytes is past the review trigger of $REVIEW_BYTES bytes"
fi
while IFS='|' read -r at accessor rows alert max over; do
  [ "$at" = "$SAMPLED_AT" ] || continue
  accessor="${accessor//\"/}"
  echo "storage-report:   $accessor rows=$rows alert=$alert max=$max over_alert=$over"
  if [ "$over" = "true" ]; then
    finding "watcher: table $accessor over alert" "table $accessor has $rows rows, past its alert of $alert"
  fi
done <"$TMP/tables.rows"
while IFS='|' read -r at class total delta; do
  [ "$at" = "$SAMPLED_AT" ] || continue
  class="${class//\"/}"
  echo "storage-report:   class $class calls_total=$total calls_delta=$delta"
done <"$TMP/classes.rows"

[ "$BREACH" -eq 0 ] || exit 1
exit 0
