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

row_count_live() { # <db> <table>
  local resp
  resp="$(mktemp)"
  bc_sql_json "$SCRIPT" "$1" "${SERVER_ARGS[@]}" "SELECT * FROM $2" >"$resp"
  bc_wb row-count "$resp"
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

# --- the auto_inc sequence must strictly exceed the restored maximum,
# proven with a real reducer call, never assumed ------------------------
DEMO_ROWS_BEFORE="$(row_count_live "$SRC" demo_ping)"
if [ "$DEMO_ROWS_BEFORE" -gt 0 ]; then
  spacetime call "$DST" "${SERVER_ARGS[@]}" --no-config -y send_ping '"verify-independent-autoinc-probe"' >/dev/null 2>&1 \
    || bc_ops_die "$SCRIPT" "send_ping (the auto_inc probe) failed against '$DST'"
  DEMO_RESP="$(mktemp)"
  bc_sql_json "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "SELECT * FROM demo_ping" >"$DEMO_RESP"
  NEW_ID="$(bc_wb rows-canonical "$BC_SNAPSHOT" demo_ping "$DEMO_RESP" | sed -E 's/^\[([0-9]+),.*/\1/' | sort -n | tail -n1)"
  rm -f "$DEMO_RESP"
  [ "$NEW_ID" -gt "$DEMO_ROWS_BEFORE" ] || bc_ops_die "$SCRIPT" \
    "auto_inc: the post-restore generated demo_ping id ($NEW_ID) does not exceed the restored row count ($DEMO_ROWS_BEFORE) -- the sequence did not advance"
  echo "$SCRIPT: ok -- auto_inc: the post-restore generated id ($NEW_ID) exceeds the restored maximum" >&2
else
  echo "$SCRIPT: skip -- '$SRC' has no demo_ping rows, nothing to probe auto_inc with" >&2
fi

echo "$SCRIPT: ok -- independent oracles pass for '$SRC' vs '$DST'" >&2
exit 0
