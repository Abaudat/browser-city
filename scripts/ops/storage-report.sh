#!/usr/bin/env bash
# Prints the metrics sampler's newest storage figures (FR169, NFR15) and
# exits 1 when any breach flag is set: the newest `storage_sample`'s
# over_review/over_wall, or any `table_sample` row of the same fire with
# over_alert. Reads durable columns over `spacetime sql` as the owner --
# never a log line. `bytes_est` is an estimate (row count x sampled row
# size, excluding indexes and the commit log), not host storage.
#
# Usage: storage-report.sh <database> [--server <server>]
# Prints "no storage samples yet" and exits 0 when the sampler has not
# fired at all; a dead-man's check on the sampler itself reads
# `cadence_liveness` (cadence 2), not this script.
set -uo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

USAGE="usage: storage-report.sh <database> [--server <server>]"
DB="${1:-}"
[ -n "$DB" ] || bc_ops_die "storage-report" "$USAGE"
shift
SERVER_ARGS=()
if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
  SERVER_ARGS=(--server "$2")
  shift 2
fi
[ "$#" -eq 0 ] || bc_ops_die "storage-report" "unrecognized argument(s): $* -- $USAGE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bc_sql_json "storage-report" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM storage_sample" >"$TMP/storage.json"
bc_sql_json "storage-report" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM table_sample" >"$TMP/tables.json"

if [ "$(bc_wb row-count "$TMP/storage.json")" -eq 0 ]; then
  echo "storage-report: no storage samples yet"
  exit 0
fi

paste -d'|' \
  <(bc_wb column-values "$TMP/storage.json" sample_id) \
  <(bc_wb column-values "$TMP/storage.json" sampled_at) \
  <(bc_wb column-values "$TMP/storage.json" total_bytes_est) \
  <(bc_wb column-values "$TMP/storage.json" over_review) \
  <(bc_wb column-values "$TMP/storage.json" over_wall) >"$TMP/storage.rows"
NEWEST="$(sort -t'|' -k1,1n "$TMP/storage.rows" | tail -n1)"
IFS='|' read -r _ SAMPLED_AT TOTAL OVER_REVIEW OVER_WALL <<<"$NEWEST"

echo "storage-report: newest sample $SAMPLED_AT -- estimated total $TOTAL bytes (over_review=$OVER_REVIEW over_wall=$OVER_WALL)"

paste -d'|' \
  <(bc_wb column-values "$TMP/tables.json" sampled_at) \
  <(bc_wb column-values "$TMP/tables.json" table_accessor) \
  <(bc_wb column-values "$TMP/tables.json" rows) \
  <(bc_wb column-values "$TMP/tables.json" alert_rows) \
  <(bc_wb column-values "$TMP/tables.json" max_rows) \
  <(bc_wb column-values "$TMP/tables.json" over_alert) >"$TMP/tables.rows"

BREACH=0
[ "$OVER_REVIEW" = "true" ] && BREACH=1
[ "$OVER_WALL" = "true" ] && BREACH=1
while IFS='|' read -r at accessor rows alert max over; do
  [ "$at" = "$SAMPLED_AT" ] || continue
  accessor="${accessor//\"/}"
  echo "storage-report:   $accessor rows=$rows alert=$alert max=$max over_alert=$over"
  if [ "$over" = "true" ]; then
    echo "storage-report: BREACH -- table $accessor has $rows rows, past its alert of $alert" >&2
    BREACH=1
  fi
done <"$TMP/tables.rows"

[ "$BREACH" -eq 0 ] || exit 1
exit 0
