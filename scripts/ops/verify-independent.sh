#!/usr/bin/env bash
# The independent oracles neither export-vs-export comparison nor a bare
# exit code proves on their own (Quentin's direction: an exporter that
# drops a column the same way on both sides would still pass a
# byte-for-byte compare alone) -- shared between
# scripts/ci/check-backup-restore.sh (the local guard) and
# .github/workflows/backup.yml's `rehearsal` job, so the Maincloud leg
# runs the same checks the local one does, never a lesser copy (Tim's
# direction).
#
# Usage: verify-independent.sh <src-db> <dst-db> [--server <url-or-nickname>]
#
# Assumes `<dst-db>` was just restored from `<src-db>`'s own export via
# restore-world.sh, and that both were seeded with seed-edge-rows.sh (or
# at minimum that `<src-db>` has a `demo_ping` row and `<dst-db>` is
# freshly published, publishable-only, i.e. still has a working `owner`
# for a `send_ping` probe call).
set -uo pipefail
SCRIPT="verify-independent"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

USAGE="usage: verify-independent.sh <src-db> <dst-db> [--server <url-or-nickname>]"
[ "$#" -ge 2 ] || bc_ops_die "$SCRIPT" "$USAGE"
SRC="$1"; DST="$2"; shift 2
SERVER_ARGS=()
if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
  SERVER_ARGS=(--server "$2")
  shift 2
fi
bc_reject_unknown_args "$SCRIPT" "$USAGE" "$@"

live_response() { # <db> <table> -- writes the response to a fresh temp file, prints its path
  local resp
  resp="$(mktemp)"
  bc_sql_json "$SCRIPT" "$1" "${SERVER_ARGS[@]}" "SELECT * FROM $2" >"$resp"
  printf '%s' "$resp"
}
row_count_live() { # <db> <table>
  local resp
  resp="$(live_response "$1" "$2")"
  bc_wb row-count "$resp"
  rm -f "$resp"
}
# max_id_live <db> <table> -- the table's own real primary-key column,
# max'd as an exact integer (never through a machine float): empty if the
# table has no rows.
max_id_live() {
  local resp
  resp="$(live_response "$1" "$2")"
  bc_wb rows-canonical "$BC_SNAPSHOT" "$2" "$resp" | sed -E 's/^\[([0-9]+),?.*/\1/' | sort -g | tail -n1
  rm -f "$resp"
}

# --- COUNT(*) directly on both live databases, independent of any
# export file ---------------------------------------------------------
while IFS= read -r table; do
  [ -n "$table" ] || continue
  a="$(row_count_live "$SRC" "$table")"
  b="$(row_count_live "$DST" "$table")"
  [ "$a" = "$b" ] || bc_ops_die "$SCRIPT" "'$table': COUNT(*) differs between '$SRC' ($a) and '$DST' ($b), queried directly, not via any export file"
done <<< "$(bc_table_names non-scheduled)"
echo "$SCRIPT: ok -- COUNT(*) matches directly against both live databases for every non-scheduled table" >&2

# --- the auto_inc sequence must strictly exceed the restored maximum id
# (never the row count, which under-counts the moment a table has any
# gap -- Quentin's/Tim's direction), proven with a real insert, for every
# table SQL can probe this way, derived from the snapshot -----------------
while IFS= read -r table; do
  [ -n "$table" ] || continue
  MAX_BEFORE="$(max_id_live "$SRC" "$table")"
  if [ -z "$MAX_BEFORE" ]; then
    echo "$SCRIPT: skip -- '$SRC.$table' has no rows, nothing to probe auto_inc with" >&2
    continue
  fi
  COL="$(bc_wb auto-inc-column "$BC_SNAPSHOT" "$table")"
  # column list for the probe insert, in live order, with the id column
  # forced to the placeholder 0 and every other column a cheap valid
  # value (0/false/'' as appropriate) -- values are irrelevant to what
  # is being proven (only the generated id is), so all-zero is fine for
  # every scalar type this generator ever seeds.
  RESP="$(live_response "$DST" "$table")"
  LIVE_COLS="$(bc_wb columns "$RESP")"
  LIVE_TYPES="$(bc_wb coltypes "$RESP")"
  rm -f "$RESP"
  COL_LIST="$(printf '%s\n' "$LIVE_COLS" | paste -sd, -)"
  VALUES=""
  while IFS= read -r ty; do
    [ -n "$VALUES" ] && VALUES="$VALUES,"
    case "$ty" in
      BOOL) VALUES="${VALUES}false" ;;
      STRING) VALUES="${VALUES}''" ;;
      *) VALUES="${VALUES}0" ;;
    esac
  done <<< "$LIVE_TYPES"
  bc_sql_exec "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "INSERT INTO $table ($COL_LIST) VALUES ($VALUES)"
  NEW_ID="$(max_id_live "$DST" "$table")"
  [ "$NEW_ID" -gt "$MAX_BEFORE" ] || bc_ops_die "$SCRIPT" \
    "auto_inc: the post-restore generated '$table.$COL' id ($NEW_ID) does not exceed the restored maximum ($MAX_BEFORE) -- the sequence did not advance past the restored data"
  echo "$SCRIPT: ok -- auto_inc: '$table' generated id ($NEW_ID) exceeds the restored maximum ($MAX_BEFORE)" >&2
done <<< "$(bc_wb sql-probeable-autoinc-tables "$BC_SNAPSHOT")"

# demo_ping shares restore_autoinc_rows's generic gap-fill loop with
# every Timestamp-bearing auto_inc table, so a real reducer call
# (send_ping, the only reducer that can write to it) is an accepted
# proxy for all of them, not a full probe of each -- there is no SQL
# path to probe a Timestamp table directly (docs/spikes/
# 1.4-backup-restore.md).
DEMO_MAX_BEFORE="$(max_id_live "$SRC" demo_ping)"
if [ -n "$DEMO_MAX_BEFORE" ]; then
  spacetime call "$DST" "${SERVER_ARGS[@]}" --no-config -y send_ping '"verify-independent-autoinc-probe"' >/dev/null 2>&1 \
    || bc_ops_die "$SCRIPT" "send_ping (the auto_inc probe) failed against '$DST'"
  NEW_ID="$(max_id_live "$DST" demo_ping)"
  [ "$NEW_ID" -gt "$DEMO_MAX_BEFORE" ] || bc_ops_die "$SCRIPT" \
    "auto_inc: the post-restore generated demo_ping id ($NEW_ID) does not exceed the restored maximum ($DEMO_MAX_BEFORE) -- the sequence did not advance past the restored data"
  echo "$SCRIPT: ok -- auto_inc: 'demo_ping' generated id ($NEW_ID) exceeds the restored maximum ($DEMO_MAX_BEFORE) -- proxy for every Timestamp-bearing auto_inc table" >&2
else
  echo "$SCRIPT: skip -- '$SRC.demo_ping' has no rows, nothing to probe auto_inc with" >&2
fi

echo "$SCRIPT: ok -- independent oracles pass for '$SRC' vs '$DST'" >&2
exit 0
