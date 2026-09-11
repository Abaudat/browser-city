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
# Usage: verify-independent.sh <src-db> <dst-db> <src-manifest.json> [--server <url-or-nickname>]
#
# Assumes `<dst-db>` was just restored from `<src-db>`'s own export
# (`<src-manifest.json>` its own manifest.json) via restore-world.sh, and
# that both were seeded with seed-edge-rows.sh (or at minimum that
# `<src-db>` has a `demo_ping` row and `<dst-db>` is freshly published,
# publishable-only, i.e. still has a working `owner` for a `send_ping`
# probe call).
set -uo pipefail
SCRIPT="verify-independent"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

USAGE="usage: verify-independent.sh <src-db> <dst-db> <src-manifest.json> [--server <url-or-nickname>]"
[ "$#" -ge 3 ] || bc_ops_die "$SCRIPT" "$USAGE"
SRC="$1"; DST="$2"; MANIFEST="$3"; shift 3
[ -f "$MANIFEST" ] || bc_ops_die "$SCRIPT" "$MANIFEST not found"
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
# max'd as an exact integer (`world_backup max-pk`, itself built on
# `canonical_rows`' own real-primary-key sort -- never a `sed`/`sort -g`
# pipeline over raw text, which both reintroduces the "primary key is
# column 0" assumption `canonical_rows` was built to remove, and compares
# through a machine float via `sort -g`): empty if the table has no rows.
max_id_live() {
  local resp
  resp="$(live_response "$1" "$2")"
  bc_wb max-pk "$BC_SNAPSHOT" "$2" "$resp"
  rm -f "$resp"
}
# big_decimal_ge <a> <b> -- true if decimal digit-string `a` >= `b`,
# compared by length then lexicographically (exact for non-negative
# integer text of any size, never through `[ -gt ]`'s signed-64-bit
# arithmetic, which a `u64` this large -- `chunk_key`-scale, near
# `u64::MAX` -- could overflow).
big_decimal_ge() {
  local a="$1" b="$2"
  [ "${#a}" -gt "${#b}" ] && return 0
  [ "${#a}" -lt "${#b}" ] && return 1
  [ "$a" \> "$b" ] && return 0
  [ "$a" = "$b" ]
}
# big_decimal_gt <a> <b> -- strict version of big_decimal_ge, above.
big_decimal_gt() {
  local a="$1" b="$2"
  big_decimal_ge "$a" "$b" && [ "$a" != "$b" ]
}
# max_expected_id <table> <max-before> -- the highest id the post-restore
# probe must exceed: the restored maximum, or the manifest's own recorded
# sequence floor, whichever is higher (normally the floor -- it is a safe
# upper bound on every id the source ever issued, docs/spikes/
# 1.4-backup-restore.md -- but compared explicitly, never assumed).
max_expected_id() {
  local floor
  floor="$(bc_wb manifest-floor "$MANIFEST" "$1")"
  if big_decimal_ge "$floor" "$2"; then
    printf '%s' "$floor"
  else
    printf '%s' "$2"
  fi
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

# --- the auto_inc sequence must strictly exceed both the restored
# maximum id *and* the manifest's own recorded sequence floor (never the
# row count, which under-counts the moment a table has any gap; never
# only the restored maximum, which a tail-deleted source could still
# re-issue -- Quentin's/Tim's direction), proven with a real insert, for
# every table SQL can probe this way, derived from the snapshot ----------
while IFS= read -r table; do
  [ -n "$table" ] || continue
  MAX_BEFORE="$(max_id_live "$SRC" "$table")"
  EXPECTED="$(max_expected_id "$table" "${MAX_BEFORE:-0}")"
  if [ "$EXPECTED" = "0" ]; then
    echo "$SCRIPT: skip -- '$SRC.$table' has no rows and no sequence floor, nothing to probe auto_inc with" >&2
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
  big_decimal_gt "$NEW_ID" "$EXPECTED" || bc_ops_die "$SCRIPT" \
    "auto_inc: the post-restore generated '$table.$COL' id ($NEW_ID) does not exceed the restored maximum or the manifest's own sequence floor ($EXPECTED) -- the sequence did not advance far enough to guarantee no id is ever re-issued"
  echo "$SCRIPT: ok -- auto_inc: '$table' generated id ($NEW_ID) exceeds the restored maximum and the manifest's sequence floor ($EXPECTED)" >&2
done <<< "$(bc_wb sql-probeable-autoinc-tables "$BC_SNAPSHOT")"

# demo_ping shares restore_autoinc_rows's generic gap-fill loop with
# every Timestamp-bearing auto_inc table, so a real reducer call
# (send_ping, the only reducer that can write to it) is an accepted
# proxy for all of them, not a full probe of each -- there is no SQL
# path to probe a Timestamp table directly (docs/spikes/
# 1.4-backup-restore.md).
DEMO_MAX_BEFORE="$(max_id_live "$SRC" demo_ping)"
DEMO_EXPECTED="$(max_expected_id demo_ping "${DEMO_MAX_BEFORE:-0}")"
if [ "$DEMO_EXPECTED" != "0" ]; then
  spacetime call "$DST" "${SERVER_ARGS[@]}" --no-config -y send_ping '"verify-independent-autoinc-probe"' >/dev/null 2>&1 \
    || bc_ops_die "$SCRIPT" "send_ping (the auto_inc probe) failed against '$DST'"
  NEW_ID="$(max_id_live "$DST" demo_ping)"
  big_decimal_gt "$NEW_ID" "$DEMO_EXPECTED" || bc_ops_die "$SCRIPT" \
    "auto_inc: the post-restore generated demo_ping id ($NEW_ID) does not exceed the restored maximum or the manifest's own sequence floor ($DEMO_EXPECTED) -- the sequence did not advance far enough to guarantee no id is ever re-issued"
  echo "$SCRIPT: ok -- auto_inc: 'demo_ping' generated id ($NEW_ID) exceeds the restored maximum and the manifest's sequence floor ($DEMO_EXPECTED) -- proxy for every Timestamp-bearing auto_inc table" >&2
else
  echo "$SCRIPT: skip -- '$SRC.demo_ping' has no rows and no sequence floor, nothing to probe auto_inc with" >&2
fi

echo "$SCRIPT: ok -- independent oracles pass for '$SRC' vs '$DST'" >&2
exit 0
