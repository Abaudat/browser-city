#!/usr/bin/env bash
# Schema-driven adversarial seed data (Quentin's direction): every
# non-scheduled table, Timestamp-bearing ones included, cycling each
# column through its type's extremes (integer MIN/MAX, a quoted/tabbed/
# newlined/CR'd/backslashed/emoji string, a synthetic Identity, an
# adversarial Timestamp) -- generated from server/schema.snapshot.json's
# own column list and types (server/tools/world_backup), never a
# hand-written per-table row, so a new table or column type this
# generator cannot fill fails loudly.
#
# Goes through the module's own `begin_restore`/`restore_<table>`/
# `finish_restore` reducers (`server/src/tables/restore.rs`) on a
# freshly published database -- the same mechanism restore-world.sh
# uses, and the only mechanism that can write a Timestamp at all
# (SpacetimeDB 2.9's SQL cannot). This is why seeding requires the target
# to be freshly published: `begin_restore`'s own precondition.
#
# Usage: seed-edge-rows.sh <db> [--server <url-or-nickname>] [--rows <n>] [--offset <base>]
set -uo pipefail
SCRIPT="seed-edge-rows"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

USAGE="usage: seed-edge-rows.sh <db> [--server <url-or-nickname>] [--rows <n>] [--offset <base>]"
[ "$#" -ge 1 ] || bc_ops_die "$SCRIPT" "$USAGE"
DB="$1"; shift
SERVER_ARGS=()
ROWS=3
OFFSET=900000
while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) SERVER_ARGS=(--server "$2"); shift 2 ;;
    --rows) ROWS="$2"; shift 2 ;;
    --offset) OFFSET="$2"; shift 2 ;;
    *) bc_ops_die "$SCRIPT" "unrecognized argument: $1 -- $USAGE" ;;
  esac
done

bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" begin_restore '[]'

AUTOINC_TABLES="$(bc_wb autoinc-tables "$BC_SNAPSHOT")"

SEEDED=()
while IFS= read -r table; do
  [ -n "$table" ] || continue
  if [ "$table" = "module_owner" ]; then
    # Never seeded with a synthetic Identity: it would overwrite the real
    # owner `require_owner` checks every other call in this same restore
    # against, locking out every subsequent `restore_*` call in this run.
    # Its own Identity round trip is exercised for real by every restore
    # this story runs -- init's own owner is a genuine Identity already.
    continue
  fi
  args_json="$(bc_wb seed-rows "$BC_SNAPSHOT" "$table" "$ROWS" "$OFFSET")"
  if grep -qxF "$table" <<<"$AUTOINC_TABLES"; then
    # `0`: every id `seed-rows` generates is already sequential and
    # gap-free (its own doc comment), so there is no sequence to advance
    # further -- `0` is `restore_autoinc_rows`'s own permanent no-op, not
    # a real floor from a manifest this synthetic seed never had.
    bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "restore_$table" "$args_json" 0
  else
    bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "restore_$table" "$args_json"
  fi
  SEEDED+=("$table")
  OFFSET=$((OFFSET + ROWS + 1))
done <<< "$(bc_table_names non-scheduled)"

bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" finish_restore '[]'

echo "seed-edge-rows: ok -- seeded ${#SEEDED[@]} table(s): ${SEEDED[*]:-}" >&2
exit 0
