#!/usr/bin/env bash
# Restores an export-world.sh export into a database, enforced here rather
# than documented as a procedure a human must remember (Tim's direction):
#
#   - refuses unless the target's schema snapshot sha256 matches the
#     export's manifest exactly;
#   - refuses unless the target holds no row beyond what `init` seeds
#     (`module_owner`, the code tables) -- the guard against restoring
#     over a live world;
#   - refuses unless the identity currently controlling the target (i.e.
#     whoever published it, recorded in its own freshly-seeded
#     `module_owner`) is the identity the export was taken from -- or
#     `require_owner` locks the operator out of their own restored world;
#   - never restores a scheduled table (schedules are derived state,
#     docs/architecture.md) -- exported, never restored, never verified;
#   - never restores a table with a Timestamp or ScheduleAt column that
#     has any exported rows -- SpacetimeDB 2.9's SQL INSERT cannot
#     construct either type as a literal (confirmed against the SQL
#     reference and empirically; see docs/spikes/1.4-backup-restore.md).
#     A table with such a column and zero exported rows is a no-op, not a
#     failure. `module_owner`'s `owner` (Identity) is restorable -- an
#     Identity is the one product-wrapped type the SQL grammar special-
#     cases as a bare `0x...` literal.
#
# Usage: restore-world.sh <db> <export-dir> [--server <url-or-nickname>]
#
# Any precondition failure, or any failure partway through, exits non-zero
# and names the table it stopped at. This script never reports success on
# an incomplete restore.
set -uo pipefail
SCRIPT="restore-world"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ "$#" -ge 2 ] || bc_ops_die "$SCRIPT" "usage: restore-world.sh <db> <export-dir> [--server <url-or-nickname>]"
DB="$1"; EXPORT_DIR="$2"; shift 2
SERVER_ARGS=()
if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
  SERVER_ARGS=(--server "$2")
fi
BATCH_SIZE="${BC_RESTORE_BATCH_SIZE:-200}"

MANIFEST="$EXPORT_DIR/manifest.json"
[ -f "$MANIFEST" ] || bc_ops_die "$SCRIPT" "$MANIFEST not found -- is '$EXPORT_DIR' an export-world.sh export?"
command -v spacetime >/dev/null 2>&1 || bc_ops_die "$SCRIPT" "'spacetime' is not on PATH"

MANIFEST_SCHEMA_SHA="$("$BC_PYTHON" -c "import json,sys; print(json.load(open(sys.argv[1]))['schema_sha256'])" "$MANIFEST")"
LOCAL_SCHEMA_SHA="$(bc_sha256 "$BC_SNAPSHOT")"
[ "$MANIFEST_SCHEMA_SHA" = "$LOCAL_SCHEMA_SHA" ] || bc_ops_die "$SCRIPT" \
  "the export's schema snapshot (sha256 $MANIFEST_SCHEMA_SHA) does not match $BC_SNAPSHOT ($LOCAL_SCHEMA_SHA) -- restore only into a database publishing the exact schema the export was taken from"

# `${TMPDIR:-${TEMP:-/tmp}}`, never a bare `/tmp` fallback first: this
# script shells out to a native `python3`/`python.exe` with the resulting
# path as a plain argument, and on a Windows dev box MSYS's POSIX-path
# auto-translation for a non-MSYS-aware binary is not reliable (confirmed
# empirically while building this script) -- `$TEMP` is the real,
# already-native path every tool on that box agrees on.
WORK="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-restore.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

DESCRIBE_JSON="$WORK/describe.json"
if ! spacetime describe "$DB" "${SERVER_ARGS[@]}" --no-config -y --json >"$DESCRIBE_JSON" 2>"$WORK/describe.err"; then
  bc_ops_die "$SCRIPT" "'spacetime describe $DB --json' failed:
$(cat "$WORK/describe.err")"
fi
LIVE_TABLES="$(bc_canon describe-tables "$DESCRIBE_JSON" | sort)"
SNAPSHOT_TABLES="$(bc_table_names all | sort)"
MISSING="$(comm -23 <(printf '%s\n' "$SNAPSHOT_TABLES") <(printf '%s\n' "$LIVE_TABLES"))"
EXTRA="$(comm -13 <(printf '%s\n' "$SNAPSHOT_TABLES") <(printf '%s\n' "$LIVE_TABLES"))"
if [ -n "$MISSING" ] || [ -n "$EXTRA" ]; then
  bc_ops_die "$SCRIPT" "'$DB' does not match $BC_SNAPSHOT -- missing: [${MISSING//$'\n'/, }] extra: [${EXTRA//$'\n'/, }] -- restore only into a freshly published database at the exported schema"
fi

# `init`-seeded tables: restore replaces their content rather than
# requiring them empty (docs/architecture.md's "Backup" section).
SPECIAL_TABLES="module_owner matter_kind provision reason_code node_kind layer_code"
is_special() { case " $SPECIAL_TABLES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Owner check first, before the precondition loop below: every table in
# this schema is private (server/schema.snapshot.json), and SpacetimeDB
# itself refuses a `spacetime sql` read of a private table to anyone but
# the database's owner -- so a restoring identity that is not the
# database's owner fails here, on `module_owner` itself, before the
# precondition loop would even get a chance to name a friendlier reason
# (confirmed empirically: the loop's own error is a bare "no such table"
# for a non-owner, not an identity-mismatch message). `init` already
# recorded whoever published `$db` as its `module_owner.owner` -- that
# identity is "the restoring identity" (the ambient CLI credentials this
# script itself runs under), read back rather than re-derived.
OWNER_RESPONSE="$WORK/owner.json"
OWNER_QUERY_LOG="$WORK/owner-query.log"
if ! spacetime sql "$DB" "${SERVER_ARGS[@]}" --no-config -y --format json "SELECT * FROM module_owner" \
    >"$OWNER_RESPONSE" 2>"$OWNER_QUERY_LOG"; then
  bc_ops_die "$SCRIPT" \
    "could not read '$DB's own module_owner table -- the restoring identity does not match the exported module_owner.owner (SpacetimeDB refuses a private-table read to any identity but the database's owner):
$(cat "$OWNER_QUERY_LOG")"
fi
TARGET_OWNER="$("$BC_PYTHON" -c "
import json, sys
d = json.load(open(sys.argv[1]))[0]
rows = d['rows']
print(rows[0][1][0] if rows else '')
" "$OWNER_RESPONSE")"
[ -n "$TARGET_OWNER" ] || bc_ops_die "$SCRIPT" "'$DB' has no module_owner row -- init did not run"

EXPORT_OWNER_FILE="$EXPORT_DIR/module_owner.jsonl"
[ -f "$EXPORT_OWNER_FILE" ] || bc_ops_die "$SCRIPT" "$EXPORT_OWNER_FILE not found in the export"
EXPORT_OWNER="$("$BC_PYTHON" -c "
import json, sys
with open(sys.argv[1]) as f:
    lines = [l for l in f if l.strip()]
print(json.loads(lines[0])[1] if lines else '')
" "$EXPORT_OWNER_FILE")"
[ -n "$EXPORT_OWNER" ] || bc_ops_die "$SCRIPT" "$EXPORT_OWNER_FILE has no module_owner row to restore"
if [ "$TARGET_OWNER" != "$EXPORT_OWNER" ]; then
  bc_ops_die "$SCRIPT" "restoring identity ($TARGET_OWNER) does not match the exported module_owner.owner ($EXPORT_OWNER) -- publish '$DB' with the identity the export was taken from, or require_owner will lock the operator out of the restored world"
fi
echo "restore-world: ok -- restoring identity matches the exported owner" >&2

echo "restore-world: checking preconditions against a freshly published '$DB'" >&2
while IFS= read -r table; do
  [ -n "$table" ] || continue
  is_special "$table" && continue
  RESPONSE="$WORK/precheck-$table.json"
  bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $table" >"$RESPONSE"
  count="$(bc_canon row-count "$RESPONSE")"
  [ "$count" -eq 0 ] || bc_ops_die "$SCRIPT" \
    "'$table' has $count row(s) already -- restore refuses a target that is not freshly published (a live world must never be restored over)"
  rm -f "$RESPONSE"
done <<< "$(bc_table_names non-scheduled)"

RESTORED=0
SKIPPED_SCHEDULED=0
SKIPPED_UNCONSTRUCTABLE=0

restore_table() { # <table>
  local table="$1" file="$EXPORT_DIR/$table.jsonl"
  [ -f "$file" ] || bc_ops_die "$SCRIPT" "$file not found in the export"
  local n
  n="$(wc -l < "$file" | tr -d ' ')"

  local schema_probe="$WORK/schema-$table.json"
  bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $table" >"$schema_probe"
  local cols coltypes
  cols="$(bc_canon columns "$schema_probe")"
  coltypes="$(bc_canon coltypes "$schema_probe")"
  rm -f "$schema_probe"

  if printf '%s\n' "$coltypes" | grep -qE '^(TIMESTAMP|SCHEDULE|OTHER)$'; then
    if [ "$n" -gt 0 ]; then
      bc_ops_die "$SCRIPT" \
        "'$table' has $n exported row(s) and a Timestamp/ScheduleAt column -- SpacetimeDB 2.9's SQL INSERT cannot construct that literal, so this table cannot be restored via spacetime sql (docs/spikes/1.4-backup-restore.md); stopped at '$table'"
    fi
    echo "restore-world: skip '$table' -- Timestamp/ScheduleAt column, 0 exported rows, nothing to restore" >&2
    SKIPPED_UNCONSTRUCTABLE=$((SKIPPED_UNCONSTRUCTABLE + 1))
    return
  fi

  if is_special "$table"; then
    bc_sql_exec "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "DELETE FROM $table"
  fi

  if [ "$n" -eq 0 ]; then
    echo "restore-world: ok -- '$table' has 0 exported rows" >&2
    RESTORED=$((RESTORED + 1))
    return
  fi

  local col_list coltypes_csv
  col_list="$(printf '%s\n' "$cols" | paste -sd, -)"
  coltypes_csv="$(printf '%s\n' "$coltypes" | paste -sd, -)"

  # One `canon.py` process per BATCH, not per row: rendering 20,000 rows
  # one python invocation each took minutes on a Windows dev box (process
  # spawn cost); one invocation per few-hundred-row batch does not
  # (confirmed empirically while building this script -- Tim's direction:
  # "one spacetime sql process per inserted row will not scale", and
  # neither does one interpreter process).
  local total=0 values
  while [ "$total" -lt "$n" ]; do
    values="$(bc_canon row-tuples-file "$coltypes_csv" "$file" "$total" "$BATCH_SIZE")" \
      || bc_ops_die "$SCRIPT" "could not render a batch of '$table' as SQL literals -- stopped at '$table'"
    bc_sql_exec "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "INSERT INTO $table ($col_list) VALUES $values"
    total=$((total + BATCH_SIZE))
    [ "$total" -gt "$n" ] && total="$n"
  done
  [ "$total" -eq "$n" ] || bc_ops_die "$SCRIPT" "'$table': restored $total of $n exported rows -- stopped at '$table'"
  echo "restore-world: ok -- '$table' restored $total row(s), batch size $BATCH_SIZE" >&2
  RESTORED=$((RESTORED + 1))
}

while IFS= read -r table; do
  [ -n "$table" ] || continue
  echo "restore-world: skip '$table' -- scheduled table, derived state, never restored" >&2
  SKIPPED_SCHEDULED=$((SKIPPED_SCHEDULED + 1))
done <<< "$(bc_table_names scheduled)"

while IFS= read -r table; do
  [ -n "$table" ] || continue
  restore_table "$table"
done <<< "$(bc_table_names non-scheduled)"

echo "restore-world: ok -- $DB restored from $EXPORT_DIR ($RESTORED table(s) restored, $SKIPPED_SCHEDULED scheduled table(s) skipped, $SKIPPED_UNCONSTRUCTABLE table(s) skipped with 0 rows for a Timestamp/ScheduleAt column). auto_inc sequences are NOT advanced by this script -- SpacetimeDB 2.9 exposes no sequence-set primitive; see docs/spikes/1.4-backup-restore.md and scripts/ci/check-backup-restore.sh's own assertion." >&2
exit 0
