#!/usr/bin/env bash
# Carves a real, exported `auto_inc` id gap into an already-seeded table
# (Quentin's direction, cycle 4): shared between
# scripts/ci/check-backup-restore.sh (a small, PR-time-budgeted gap) and
# .github/workflows/backup.yml's `rehearsal` job (a real, >=100k-id gap,
# under Maincloud's own reducer execution limits, no PR-time budget) --
# one implementation, never two copies that could drift apart.
#
# Usage: seed-id-gaps.sh <db> --table <table> --gap <n> [--server <url-or-nickname>]
#
# `<table>` must be SQL-writable (no `Timestamp`/`ScheduleAt`/`Identity`/
# `ConnectionId` column -- SpacetimeDB 2.9's SQL cannot construct any of
# those literals; `bc_wb sql-probeable-autoinc-tables` is the exact set
# this script can target) and must already hold at least one row (its own
# `restore_<table>` reducer, or a previous `seed-edge-rows.sh`/direct SQL
# insert -- this script only ever adds to what is already there, never
# publishes or seeds from nothing).
#
# Bulk-inserts `<n>` rows via SQL (batches of 200: confirmed empirically
# that a 1,000-row batch of an 8-column `INSERT` trips Windows'
# `CreateProcess` argv-length limit on this dev box; 200 does not), then
# deletes everything but the table's own original rows and a handful of
# the newly-inserted tail rows -- leaving a real gap of roughly `<n>` ids
# with surviving rows on both sides, so a restore of this table must
# route through `restore_autoinc_rows`'s delete-and-retry branch to reach
# the tail, never only its always-exact branch.
set -uo pipefail
SCRIPT="seed-id-gaps"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

USAGE="usage: seed-id-gaps.sh <db> --table <table> --gap <n> [--server <url-or-nickname>]"
[ "$#" -ge 1 ] || bc_ops_die "$SCRIPT" "$USAGE"
DB="$1"; shift
SERVER_ARGS=()
TABLE=""
GAP=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) SERVER_ARGS=(--server "$2"); shift 2 ;;
    --table) TABLE="$2"; shift 2 ;;
    --gap) GAP="$2"; shift 2 ;;
    *) bc_ops_die "$SCRIPT" "unrecognized argument: $1 -- $USAGE" ;;
  esac
done
[ -n "$TABLE" ] || bc_ops_die "$SCRIPT" "--table is required -- $USAGE"
[ -n "$GAP" ] || bc_ops_die "$SCRIPT" "--gap is required -- $USAGE"
case "$GAP" in ''|*[!0-9]*) bc_ops_die "$SCRIPT" "--gap must be a positive integer, got: $GAP" ;; esac

PROBEABLE="$(bc_wb sql-probeable-autoinc-tables "$BC_SNAPSHOT")"
grep -qxF "$TABLE" <<<"$PROBEABLE" \
  || bc_ops_die "$SCRIPT" "'$TABLE' is not SQL-writable (Timestamp/ScheduleAt/Identity/ConnectionId column, or not auto_inc) -- must be one of: $(printf '%s' "$PROBEABLE" | tr '\n' ' ')"

sql_exec() { # <statement>
  spacetime sql "$DB" "${SERVER_ARGS[@]}" --no-config -y "$1" >/dev/null 2>"$WORK/sql.err" \
    || bc_ops_die "$SCRIPT" "'spacetime sql' failed for: $1
$(cat "$WORK/sql.err")"
}

WORK="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-seed-id-gaps.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

RESP="$WORK/resp.json"
bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $TABLE" >"$RESP"
BEFORE_MAX="$(bc_wb max-pk "$BC_SNAPSHOT" "$TABLE" "$RESP")"
[ -n "$BEFORE_MAX" ] || bc_ops_die "$SCRIPT" "'$TABLE' has 0 rows -- seed it first (this script only ever adds to an already-seeded table)"

COL="$(bc_wb auto-inc-column "$BC_SNAPSHOT" "$TABLE")"
LIVE_COLS="$(bc_wb columns "$RESP")"
LIVE_TYPES="$(bc_wb coltypes "$RESP")"
COL_LIST="$(printf '%s\n' "$LIVE_COLS" | paste -sd, -)"

# One all-zero/false/'' value tuple, column order matching the live
# response -- the auto_inc id column gets the `0` auto-generate
# placeholder like every other numeric column, since it is never the
# first column by assumption here (bc_wb's own column order, not a
# hand-picked position).
VALUES=""
while IFS= read -r ty; do
  [ -n "$VALUES" ] && VALUES="$VALUES,"
  case "$ty" in
    BOOL) VALUES="${VALUES}false" ;;
    STRING) VALUES="${VALUES}''" ;;
    *) VALUES="${VALUES}0" ;;
  esac
done <<< "$LIVE_TYPES"

BATCH=200
inserted=0
while [ "$inserted" -lt "$GAP" ]; do
  remaining=$((GAP - inserted))
  n=$BATCH
  [ "$n" -gt "$remaining" ] && n=$remaining
  tuples=""
  for ((i = 0; i < n; i++)); do
    [ -n "$tuples" ] && tuples="$tuples,"
    tuples="$tuples($VALUES)"
  done
  sql_exec "INSERT INTO $TABLE ($COL_LIST) VALUES $tuples"
  inserted=$((inserted + n))
done

RESP2="$WORK/resp2.json"
bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $TABLE" >"$RESP2"
AFTER_MAX="$(bc_wb max-pk "$BC_SNAPSHOT" "$TABLE" "$RESP2")"

# Keep the table's own original rows (<= BEFORE_MAX) and a handful of the
# tail (the last 5 newly-inserted ids) -- delete everything else
# bulk-inserted in between, carving out one real gap of roughly `<n>` ids
# with surviving rows on both sides of it.
TAIL_START=$((AFTER_MAX - 5))
[ "$TAIL_START" -le "$BEFORE_MAX" ] && TAIL_START=$((BEFORE_MAX + 1))
sql_exec "DELETE FROM $TABLE WHERE $COL > $BEFORE_MAX AND $COL < $TAIL_START"

echo "$SCRIPT: ok -- '$TABLE' now has a real gap of roughly $GAP ids between $BEFORE_MAX and $TAIL_START (surviving ids up to $AFTER_MAX)" >&2
exit 0
