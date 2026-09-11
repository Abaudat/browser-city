#!/usr/bin/env bash
# The one logical export path (AC2): dumps every table `server/schema.
# snapshot.json` names via the real `spacetime sql`, never a second export
# path for tests (Quentin's direction). Used identically by a human, by
# scripts/ci/check-backup-restore.sh and by .github/workflows/backup.yml.
#
# Usage: export-world.sh <db> <out-dir> [--server <url-or-nickname>]
#
# Writes <out-dir>/<table>.jsonl (one canonical JSON row per line, sorted
# by the table's real primary key -- server/tools/world_backup) for every
# table, plus manifest.json (CLI version, the schema snapshot's own
# sha256, the database identity, the exporting identity, per-table row
# counts and per-file sha256). Every value passes through world_backup,
# never `jq` -- see that crate's module doc for why (u64/chunk_key
# precision).
#
# Atomic: builds in <out-dir>.partial, then rename-swaps into place. A
# failed or half-written export never looks like one at the final path
# (Quentin's direction), and a failed *rename* never destroys a previous
# good export either: the old export is moved aside first and only
# deleted after the new one is fully in place.
set -uo pipefail
SCRIPT="export-world"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

USAGE="usage: export-world.sh <db> <out-dir> [--server <url-or-nickname>]"
[ "$#" -ge 2 ] || bc_ops_die "$SCRIPT" "$USAGE"
DB="$1"; OUT_DIR="$2"; shift 2
SERVER_ARGS=()
if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
  SERVER_ARGS=(--server "$2")
  shift 2
fi
bc_reject_unknown_args "$SCRIPT" "$USAGE" "$@"

[ -f "$BC_SNAPSHOT" ] || bc_ops_die "$SCRIPT" "$BC_SNAPSHOT not found"
command -v spacetime >/dev/null 2>&1 || bc_ops_die "$SCRIPT" "'spacetime' is not on PATH"

TMP_DIR="${OUT_DIR%/}.partial"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
cleanup() { [ -n "${BC_KEEP_PARTIAL:-}" ] || rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# --- table list: cross-check the live database against the snapshot,
# never a hand-written list (Tim's direction) ---------------------------
DESCRIBE_JSON="$TMP_DIR/.describe.json"
if ! spacetime describe "$DB" "${SERVER_ARGS[@]}" --no-config -y --json >"$DESCRIBE_JSON" 2>"$TMP_DIR/.describe.err"; then
  bc_ops_die "$SCRIPT" "'spacetime describe $DB --json' failed:
$(cat "$TMP_DIR/.describe.err")"
fi
LIVE_TABLES="$(bc_wb describe-tables "$DESCRIBE_JSON" | grep -v '^restore_state$' | sort)"
SNAPSHOT_TABLES="$(bc_table_names all | sort)"
[ -n "$SNAPSHOT_TABLES" ] || bc_ops_die "$SCRIPT" "$BC_SNAPSHOT names no tables"
MISSING="$(comm -23 <(printf '%s\n' "$SNAPSHOT_TABLES") <(printf '%s\n' "$LIVE_TABLES"))"
EXTRA="$(comm -13 <(printf '%s\n' "$SNAPSHOT_TABLES") <(printf '%s\n' "$LIVE_TABLES"))"
if [ -n "$MISSING" ] || [ -n "$EXTRA" ]; then
  bc_ops_die "$SCRIPT" "'$DB' does not match $BC_SNAPSHOT -- missing: [${MISSING//$'\n'/, }] extra: [${EXTRA//$'\n'/, }]"
fi

declare -A ROW_COUNTS
TABLES_JSON="$TMP_DIR/.tables.json"
{
  printf '{\n'
  first=1
  while IFS= read -r table; do
    [ -n "$table" ] || continue
    RESPONSE="$TMP_DIR/$table.response.json"
    bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $table" >"$RESPONSE"

    # column drift, name-normalised (SpacetimeDB echoes e.g. `x0` back as
    # `x_0` -- see world_backup::normalize_name)
    LIVE_COLS="$(bc_wb columns-normalized "$RESPONSE")"
    SNAP_COLS="$(bc_wb snapshot-columns "$BC_SNAPSHOT" "$table")"
    if [ "$LIVE_COLS" != "$SNAP_COLS" ]; then
      bc_ops_die "$SCRIPT" "'$table' columns differ from $BC_SNAPSHOT (live: [$(printf '%s' "$LIVE_COLS" | tr '\n' ',')] snapshot: [$(printf '%s' "$SNAP_COLS" | tr '\n' ',')])"
    fi

    bc_wb rows-canonical "$BC_SNAPSHOT" "$table" "$RESPONSE" >"$TMP_DIR/$table.jsonl"
    rm -f "$RESPONSE"
    count="$(wc -l < "$TMP_DIR/$table.jsonl" | tr -d ' ')"
    ROW_COUNTS["$table"]="$count"
    sha="$(bc_sha256 "$TMP_DIR/$table.jsonl")"
    [ "$first" -eq 1 ] || printf ',\n'
    first=0
    printf '  "%s": {"rows": %s, "sha256": "%s"}' "$table" "$count" "$sha"
  done <<< "$SNAPSHOT_TABLES"
  printf '\n}\n'
} > "$TABLES_JSON"

CLI_VERSION="$(spacetime --version 2>/dev/null | grep -oE 'spacetimedb tool version [0-9]+\.[0-9]+\.[0-9]+' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo unknown)"
SNAPSHOT_SHA="$(bc_sha256 "$BC_SNAPSHOT")"
EXPORTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# database/exporting identity: best-effort, informational metadata only --
# `spacetime list` is the only subcommand that names both (never used for
# an authorization decision; restore-world.sh reads module_owner for that).
LIST_OUT="$(spacetime list "${SERVER_ARGS[@]}" 2>/dev/null || true)"
EXPORTING_IDENTITY="$(printf '%s' "$LIST_OUT" | grep -oE 'for user [0-9a-f]+' | awk '{print $3}')"
DATABASE_IDENTITY="$(printf '%s' "$LIST_OUT" | awk -v db="$DB" '$1 == db {print $3}')"
[ -n "$EXPORTING_IDENTITY" ] || EXPORTING_IDENTITY="unknown"
[ -n "$DATABASE_IDENTITY" ] || DATABASE_IDENTITY="unknown"

bc_wb write-manifest "$TMP_DIR/manifest.json" \
  "cli_version=$CLI_VERSION" \
  "schema_sha256=$SNAPSHOT_SHA" \
  "database_identity=$DATABASE_IDENTITY" \
  "exporting_identity=$EXPORTING_IDENTITY" \
  "exported_at=$EXPORTED_AT" \
  "database=$DB" \
  "tables_file=$TABLES_JSON" \
  || bc_ops_die "$SCRIPT" "could not write manifest.json"

rm -f "$DESCRIBE_JSON" "$TMP_DIR/.describe.err" "$TABLES_JSON"

trap - EXIT
# Move the previous good export aside first, and delete it only once the
# new one is fully in place -- a failed rename must never destroy a
# working export (Quentin's direction).
ASIDE=""
if [ -e "$OUT_DIR" ]; then
  ASIDE="${OUT_DIR%/}.previous.$$"
  mv "$OUT_DIR" "$ASIDE"
fi
if ! mv "$TMP_DIR" "$OUT_DIR"; then
  [ -n "$ASIDE" ] && mv "$ASIDE" "$OUT_DIR"
  bc_ops_die "$SCRIPT" "could not move $TMP_DIR into place at $OUT_DIR -- the previous export, if any, was restored"
fi
[ -n "$ASIDE" ] && rm -rf "$ASIDE"

TOTAL=0
for table in "${!ROW_COUNTS[@]}"; do TOTAL=$((TOTAL + ROW_COUNTS["$table"])); done
echo "export-world: ok -- $DB exported to $OUT_DIR ($(printf '%s\n' "$SNAPSHOT_TABLES" | wc -l | tr -d ' ') tables, $TOTAL rows)" >&2
exit 0
