#!/usr/bin/env bash
# Schema-driven adversarial seed data (Quentin's direction): for every
# non-scheduled table SpacetimeDB SQL can actually write to, inserts a few
# rows cycling through each column's type extremes (integer MIN/MAX, a
# quoted/tabbed/newlined/emoji string, a synthetic Identity) -- generated
# from server/schema.snapshot.json's own column list and types, never a
# hand-written per-table row, so a new table or column type this generator
# cannot fill fails loudly (see python/canon.py's EDGE_VALUES).
#
# Never seeds `module_owner` (already holds `init`'s one row) or a table
# with a Timestamp/ScheduleAt column (SpacetimeDB 2.9's SQL INSERT cannot
# construct either -- docs/spikes/1.4-backup-restore.md); both are logged
# by name, not silently skipped.
#
# Usage: seed-edge-rows.sh <db> [--server <url-or-nickname>] [--rows <n>] [--offset <base>]
set -uo pipefail
SCRIPT="seed-edge-rows"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ "$#" -ge 1 ] || bc_ops_die "$SCRIPT" "usage: seed-edge-rows.sh <db> [--server <url-or-nickname>] [--rows <n>] [--offset <base>]"
DB="$1"; shift
SERVER_ARGS=()
ROWS=3
OFFSET=900000
while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) SERVER_ARGS=(--server "$2"); shift 2 ;;
    --rows) ROWS="$2"; shift 2 ;;
    --offset) OFFSET="$2"; shift 2 ;;
    *) bc_ops_die "$SCRIPT" "unknown argument: $1" ;;
  esac
done

SEEDED=()
SKIPPED_OWNER=()
SKIPPED_TIMESTAMP=()

while IFS= read -r table; do
  [ -n "$table" ] || continue
  if [ "$table" = "module_owner" ]; then
    SKIPPED_OWNER+=("$table")
    continue
  fi
  PROBE="$(mktemp)"
  bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $table" >"$PROBE"
  coltypes="$(bc_canon coltypes "$PROBE")"
  if printf '%s\n' "$coltypes" | grep -qE '^(TIMESTAMP|SCHEDULE|OTHER)$'; then
    SKIPPED_TIMESTAMP+=("$table")
    rm -f "$PROBE"
    continue
  fi
  col_list="$(bc_canon columns "$PROBE" | paste -sd, -)"
  rm -f "$PROBE"

  # seed-tuples already returns one comma-joined VALUES blob (never
  # newline-per-tuple piped through `paste`): an adversarial seed string
  # can contain a real newline byte, which `paste -sd,` would misread as
  # a tuple separator.
  values="$(bc_canon seed-tuples "$BC_SNAPSHOT" "$table" "$ROWS" "$OFFSET")"
  bc_sql_exec "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "INSERT INTO $table ($col_list) VALUES $values"
  SEEDED+=("$table")
  OFFSET=$((OFFSET + ROWS + 1))
done <<< "$(bc_table_names non-scheduled)"

echo "seed-edge-rows: ok -- seeded ${#SEEDED[@]} table(s): ${SEEDED[*]:-}" >&2
echo "seed-edge-rows: not seeded (already init-seeded): ${SKIPPED_OWNER[*]:-none}" >&2
echo "seed-edge-rows: not seeded (Timestamp/ScheduleAt column, no reducer can write one via SQL): ${SKIPPED_TIMESTAMP[*]:-none}" >&2
exit 0
