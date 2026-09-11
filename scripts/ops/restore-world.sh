#!/usr/bin/env bash
# Restores an export-world.sh export by calling the module's own
# `restore_<table>` reducers (`server/src/tables/restore.rs`), never via
# `spacetime sql` -- SpacetimeDB 2.9's SQL INSERT/UPDATE cannot construct
# a Timestamp or ScheduleAt literal at all, so a reducer is the only path
# that can write every table (docs/spikes/1.4-backup-restore.md). This
# script enforces nothing itself beyond wiring: `begin_restore`/
# `restore_*`/`finish_restore` (all owner-only, all gated by the module's
# own open-restore state) are the actual guards --
#   - `begin_restore` refuses a target that is not freshly published
#     (holds any row beyond what `init` seeds);
#   - never restores a scheduled table (schedules are derived state,
#     docs/architecture.md) -- exported, never restored, never verified;
#   - `restore_module_owner`/the code-table reducers replace what `init`
#     seeded; every other table's `begin_restore` already required empty.
#
# This script's own job is: refuse a restoring identity that does not
# match the exported owner (checked here, before any reducer call,
# because a real one gets an unhelpful bare read failure instead of this
# script's own clear message -- SpacetimeDB refuses a private-table SQL
# read to any identity but the owner, confirmed empirically), batch each
# table's rows into `spacetime call` arguments sized by a **byte**
# budget, never a fixed row count (Quentin's direction: a fixed row count
# breaks the moment a table's average row size crosses the command-line
# length limit -- 131,072 bytes for one argv element on Linux, roughly
# 32,000 characters for the *whole* command line on Windows), and, for
# every auto_inc table, pass its own recorded `sequence_floor` (manifest.
# json's `sequence_floors`) on the last batch only -- so the restored
# sequence advances past every id the source ever issued, not merely the
# highest one still present among the exported rows (docs/spikes/
# 1.4-backup-restore.md).
#
# Usage: restore-world.sh <db> <export-dir> [--server <url-or-nickname>]
#
# Any precondition failure, or any failure partway through, exits non-zero
# and names the table it stopped at. This script never reports success on
# an incomplete restore. A restore that fails partway (e.g. a DELETE that
# succeeds but the following INSERT fails on `module_owner`) leaves the
# target in a state `begin_restore` will refuse to resume as non-fresh;
# recovery is to republish the target with data deletion and restore
# again from the start, never to patch the partial state by hand.
set -uo pipefail
SCRIPT="restore-world"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

USAGE="usage: restore-world.sh <db> <export-dir> [--server <url-or-nickname>]"
[ "$#" -ge 2 ] || bc_ops_die "$SCRIPT" "$USAGE"
DB="$1"; EXPORT_DIR="$2"; shift 2
SERVER_ARGS=()
if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
  SERVER_ARGS=(--server "$2")
  shift 2
fi
bc_reject_unknown_args "$SCRIPT" "$USAGE" "$@"

# A byte budget, never a row count: the whole command line, not just this
# one argument, must fit. OS-aware, not one flat default: 100,000 bytes
# on Linux (CI, backup.yml's rehearsal job) -- comfortably under Linux's
# real 131,072-byte single-argv-element limit -- and 16,000 bytes
# everywhere else (this dev box is Windows, whose whole-command-line
# limit is ~32,000 characters, much tighter relative to a single
# argument than Linux's own). `uname -s` -- never `$OSTYPE`, which is
# bash-specific and not always set the same way under Git Bash/MSYS.
DEFAULT_BATCH_BYTES=16000
[ "$(uname -s)" = "Linux" ] && DEFAULT_BATCH_BYTES=100000
BATCH_BYTES="${BC_RESTORE_BATCH_BYTES:-$DEFAULT_BATCH_BYTES}"

MANIFEST="$EXPORT_DIR/manifest.json"
[ -f "$MANIFEST" ] || bc_ops_die "$SCRIPT" "$MANIFEST not found -- is '$EXPORT_DIR' an export-world.sh export?"
command -v spacetime >/dev/null 2>&1 || bc_ops_die "$SCRIPT" "'spacetime' is not on PATH"

MANIFEST_SCHEMA_SHA="$(grep -oE '"schema_sha256": *"[0-9a-f]+"' "$MANIFEST" | grep -oE '[0-9a-f]{16,}')"
[ -n "$MANIFEST_SCHEMA_SHA" ] || bc_ops_die "$SCRIPT" "$MANIFEST has no schema_sha256"
LOCAL_SCHEMA_SHA="$(bc_sha256 "$BC_SNAPSHOT")"
[ "$MANIFEST_SCHEMA_SHA" = "$LOCAL_SCHEMA_SHA" ] || bc_ops_die "$SCRIPT" \
  "the export's schema snapshot (sha256 $MANIFEST_SCHEMA_SHA) does not match $BC_SNAPSHOT ($LOCAL_SCHEMA_SHA) -- restore only into a database publishing the exact schema the export was taken from"

WORK="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-restore.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

DESCRIBE_JSON="$WORK/describe.json"
if ! spacetime describe "$DB" "${SERVER_ARGS[@]}" --no-config -y --json >"$DESCRIBE_JSON" 2>"$WORK/describe.err"; then
  bc_ops_die "$SCRIPT" "'spacetime describe $DB --json' failed:
$(cat "$WORK/describe.err")"
fi
LIVE_TABLES="$(bc_wb describe-tables "$DESCRIBE_JSON" | grep -v '^restore_state$' | sort)"
SNAPSHOT_TABLES="$(bc_table_names all | sort)"
MISSING="$(comm -23 <(printf '%s\n' "$SNAPSHOT_TABLES") <(printf '%s\n' "$LIVE_TABLES"))"
EXTRA="$(comm -13 <(printf '%s\n' "$SNAPSHOT_TABLES") <(printf '%s\n' "$LIVE_TABLES"))"
if [ -n "$MISSING" ] || [ -n "$EXTRA" ]; then
  bc_ops_die "$SCRIPT" "'$DB' does not match $BC_SNAPSHOT -- missing: [${MISSING//$'\n'/, }] extra: [${EXTRA//$'\n'/, }] -- restore only into a freshly published database at the exported schema"
fi

# Owner check, before any reducer call: SpacetimeDB refuses a `spacetime
# sql` read of a private table (every table in this schema is private) to
# any identity but the database's own owner, so a restoring identity that
# does not match `$DB`'s current owner fails to even read `module_owner`
# -- confirmed empirically. `init` already recorded whoever published
# `$db` as its `module_owner.owner`; that identity is "the restoring
# identity" (the ambient CLI credentials this script itself runs under).
OWNER_RESPONSE="$WORK/owner.json"
if ! spacetime sql "$DB" "${SERVER_ARGS[@]}" --no-config -y --format json "SELECT * FROM module_owner" \
    >"$OWNER_RESPONSE" 2>"$WORK/owner-query.log"; then
  bc_ops_die "$SCRIPT" \
    "could not read '$DB's own module_owner table -- the restoring identity does not match the exported module_owner.owner (SpacetimeDB refuses a private-table read to any identity but the database's owner):
$(cat "$WORK/owner-query.log")"
fi
TARGET_OWNER="$(grep -oE '0x[0-9a-fA-F]+' "$OWNER_RESPONSE" | head -n1 || true)"
[ -n "$TARGET_OWNER" ] || bc_ops_die "$SCRIPT" "'$DB' has no module_owner row -- init did not run"

EXPORT_OWNER_FILE="$EXPORT_DIR/module_owner.jsonl"
[ -f "$EXPORT_OWNER_FILE" ] || bc_ops_die "$SCRIPT" "$EXPORT_OWNER_FILE not found in the export"
EXPORT_OWNER="$(grep -oE '0x[0-9a-fA-F]+' "$EXPORT_OWNER_FILE" | head -n1 || true)"
[ -n "$EXPORT_OWNER" ] || bc_ops_die "$SCRIPT" "$EXPORT_OWNER_FILE has no module_owner row to restore"
if [ "${TARGET_OWNER,,}" != "${EXPORT_OWNER,,}" ]; then
  bc_ops_die "$SCRIPT" "the restoring identity does not match the exported module_owner.owner ($TARGET_OWNER vs $EXPORT_OWNER) -- publish '$DB' with the identity the export was taken from, or require_owner will lock the operator out of the restored world"
fi
echo "restore-world: ok -- restoring identity matches the exported owner" >&2

bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" begin_restore '[]'
echo "restore-world: ok -- begin_restore opened (target was freshly published)" >&2

RESTORED=0
SKIPPED_SCHEDULED=0

while IFS= read -r table; do
  [ -n "$table" ] || continue
  echo "restore-world: skip '$table' -- scheduled table, derived state, never restored" >&2
  SKIPPED_SCHEDULED=$((SKIPPED_SCHEDULED + 1))
done <<< "$(bc_table_names scheduled)"

AUTOINC_TABLES="$(bc_wb autoinc-tables "$BC_SNAPSHOT")"
is_autoinc() { # <table>
  grep -qxF "$1" <<<"$AUTOINC_TABLES"
}

while IFS= read -r table; do
  [ -n "$table" ] || continue
  file="$EXPORT_DIR/$table.jsonl"
  [ -f "$file" ] || bc_ops_die "$SCRIPT" "$file not found in the export"
  n="$(wc -l < "$file" | tr -d ' ')"

  if ! is_autoinc "$table"; then
    if [ "$n" -eq 0 ]; then
      echo "restore-world: ok -- '$table' has 0 exported rows" >&2
      RESTORED=$((RESTORED + 1))
      continue
    fi
    total=0
    while IFS= read -r batch; do
      [ -n "$batch" ] || continue
      bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "restore_$table" "$batch"
      total=$((total + 1))
    done <<< "$(bc_wb call-batches "$file" "$BATCH_BYTES")"
    echo "restore-world: ok -- '$table' restored $n row(s) in $total batch(es), byte budget $BATCH_BYTES" >&2
    RESTORED=$((RESTORED + 1))
    continue
  fi

  # auto_inc table: every `restore_<table>` call also takes
  # `sequence_floor: u64` -- `0` (a permanent no-op) for every batch but
  # this table's own *last* one, which gets the real floor from
  # manifest.json's `sequence_floors` (docs/spikes/
  # 1.4-backup-restore.md's own rule: the restored sequence must never
  # re-issue an id the source ever handed out, not merely the highest one
  # still present among the exported rows). Advancing early would place
  # the sequence past a still-to-come batch's own target ids, which
  # `restore_autoinc_rows` would then read as an overshoot and abort on
  # -- so batches are materialized into an array first, never streamed
  # one at a time, purely so the *last* one is known before any call is
  # made.
  FLOOR="$(bc_wb manifest-floor "$MANIFEST" "$table")"
  if [ "$n" -eq 0 ]; then
    if [ "$FLOOR" = "0" ]; then
      echo "restore-world: ok -- '$table' has 0 exported rows and no sequence floor to advance to" >&2
      RESTORED=$((RESTORED + 1))
      continue
    fi
    t0=$(date +%s.%N)
    bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "restore_$table" '[]' "$FLOOR"
    t1=$(date +%s.%N)
    echo "restore-world: ok -- '$table' has 0 exported rows, advanced its sequence to floor $FLOOR in $(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.3f", b-a}')s" >&2
    RESTORED=$((RESTORED + 1))
    continue
  fi

  mapfile -t BATCHES < <(bc_wb call-batches "$file" "$BATCH_BYTES")
  total=${#BATCHES[@]}
  last=$((total - 1))
  gap_fill_s="0.000"
  for i in "${!BATCHES[@]}"; do
    batch="${BATCHES[$i]}"
    [ -n "$batch" ] || continue
    if [ "$i" -eq "$last" ]; then
      t0=$(date +%s.%N)
      bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "restore_$table" "$batch" "$FLOOR"
      t1=$(date +%s.%N)
      gap_fill_s="$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.3f", b-a}')"
    else
      bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "restore_$table" "$batch" 0
    fi
  done
  echo "restore-world: ok -- '$table' restored $n row(s) in $total batch(es), byte budget $BATCH_BYTES, sequence advanced to floor $FLOOR -- last batch (rows + floor-advance) took ${gap_fill_s}s" >&2
  RESTORED=$((RESTORED + 1))
done <<< "$(bc_table_names non-scheduled)"

bc_call "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" finish_restore '[]'

echo "restore-world: ok -- $DB restored from $EXPORT_DIR ($RESTORED table(s) restored, $SKIPPED_SCHEDULED scheduled table(s) skipped)" >&2
exit 0
