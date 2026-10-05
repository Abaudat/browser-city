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
# Usage: storage-report.sh <database> [--server <server>] [--now <micros>]
#        [--findings <file>]
# `--now` overrides the runner's clock (tests). Prints "no storage samples
# yet" and exits 0 when the sampler has not fired at all.
set -uo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

# Three sampler periods, in micros: sim::cadence::METRICS_PERIOD_MS is one
# real hour at speed 1 (the production speed).
STALE_MICROS=$((3 * 3600 * 1000000))

unreadable() { # <message>
  echo "storage-report: could not read the metrics -- $1" >&2
  exit 2
}

USAGE="usage: storage-report.sh <database> [--server <server>] [--now <micros>] [--findings <file>]"
DB="${1:-}"
[ -n "$DB" ] || unreadable "$USAGE"
shift
SERVER_ARGS=()
NOW_MICROS=""
FINDINGS_FILE=""
while [ "$#" -ge 2 ]; do
  case "$1" in
    --server) SERVER_ARGS=(--server "$2") ;;
    --now) NOW_MICROS="$2" ;;
    --findings) FINDINGS_FILE="$2" ;;
    *) break ;;
  esac
  shift 2
done
[ -n "$NOW_MICROS" ] || NOW_MICROS=$(($(date +%s) * 1000000))
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

BREACH=0
# finding <title> <detail> -- a breach: stderr, and the findings file.
finding() {
  BREACH=1
  echo "storage-report: BREACH -- $2" >&2
  [ -z "$FINDINGS_FILE" ] || printf '%s\t%s\n' "$1" "$2" >>"$FINDINGS_FILE"
}

SAMPLED_MICROS="$(printf '%s' "$SAMPLED_AT" | grep -oE '[0-9]+' | tail -n1)"
if [ -n "$SAMPLED_MICROS" ] && [ $((NOW_MICROS - SAMPLED_MICROS)) -gt "$STALE_MICROS" ]; then
  finding "watcher: sampler stale" "STALE -- the newest sample is $(((NOW_MICROS - SAMPLED_MICROS) / 1000000))s old, over three sampler periods ($((STALE_MICROS / 1000000))s): the sampler has stopped"
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
