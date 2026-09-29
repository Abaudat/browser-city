#!/usr/bin/env bash
# Compares two export-world.sh exports byte for byte -- the canonical text
# each table's .jsonl file holds, never a value parsed back out of it
# (Tim's direction: no jq, no double, ever, for chunk_key/u64 precision).
# Scheduled tables are never compared: schedules are derived state,
# exported but never restored (docs/architecture.md), so a scheduled
# table's export legitimately differs across a restore (new scheduled_ids)
# and comparing it would be asserting the wrong thing.
#
# This alone is NOT the whole restore proof (an exporter that drops a
# column the same way on both sides would still pass a byte-for-byte
# compare) -- scripts/ci/check-backup-restore.sh adds the independent
# oracles: COUNT(*) against both live databases, and literal sentinel-row
# assertions (Quentin's direction).
#
# Usage: verify-world.sh <export-dir-a> <export-dir-b>
set -uo pipefail
SCRIPT="verify-world"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

[ "$#" -eq 2 ] || bc_ops_die "$SCRIPT" "usage: verify-world.sh <export-dir-a> <export-dir-b>"
A="$1"; B="$2"
[ -f "$A/manifest.json" ] || bc_ops_die "$SCRIPT" "$A/manifest.json not found -- is '$A' an export-world.sh export?"
[ -f "$B/manifest.json" ] || bc_ops_die "$SCRIPT" "$B/manifest.json not found -- is '$B' an export-world.sh export?"

SHA_A="$(grep -oE '"schema_sha256": *"[0-9a-f]+"' "$A/manifest.json" | grep -oE '[0-9a-f]{16,}')"
SHA_B="$(grep -oE '"schema_sha256": *"[0-9a-f]+"' "$B/manifest.json" | grep -oE '[0-9a-f]{16,}')"
[ "$SHA_A" = "$SHA_B" ] || bc_ops_die "$SCRIPT" "the two exports were taken against different schemas ($SHA_A vs $SHA_B) -- not comparable"

# Story 4.2: `cadence_liveness` is the one non-scheduled table a live
# scheduled reducer writes to on its own, independent of anything either
# export call does -- `maintenance_schedule`'s own real fire, on its own
# wall clock, can and does land between export A and export B taken
# later of the *same* restored database (confirmed: CI observed export B
# holding one row export A did not, for exactly this reason). A
# byte-identical `cmp` is the wrong assertion for it: `record_cadence_fire`
# is an upsert, so a real fire in the gap *changes* the row A already had
# (`fires`/`missed`/both timestamps), it does not merely add a new one.
# `world_backup cadence-liveness-forward-diff` (never a bash line-diff
# over structured JSON) is the oracle that is actually true for a live,
# forward-only table: every row A has must be either byte-identical in B,
# or related to it by exactly one legitimate later fire (`fires` strictly
# greater, `missed` never smaller, `last_fired_at` strictly later); a row
# in A missing from B, or related any other way, is a real mismatch.
#
# Story 4.13: `reducer_class_counter` is the same kind of table -- every
# restore call after `restore_reducer_class_counter` (`finish_restore`,
# at least) counts, so export B's totals are legitimately larger.
# `world_backup counter-forward-diff`: no class lost, no figure smaller.
table_matches() { # <table> <file-a> <file-b>
  case "$1" in
    reducer_class_counter)
      local counter_mismatches
      counter_mismatches="$(bc_wb counter-forward-diff "$2" "$3")" || return 1
      [ -z "$counter_mismatches" ]
      ;;
    cadence_liveness)
      local mismatches
      mismatches="$(bc_wb cadence-liveness-forward-diff "$2" "$3")" || return 1
      [ -z "$mismatches" ]
      ;;
    *)
      cmp -s "$2" "$3"
      ;;
  esac
}

MISMATCHES=0
CHECKED=0
while IFS= read -r table; do
  [ -n "$table" ] || continue
  FA="$A/$table.jsonl"
  FB="$B/$table.jsonl"
  [ -f "$FA" ] || bc_ops_die "$SCRIPT" "$FA not found"
  [ -f "$FB" ] || bc_ops_die "$SCRIPT" "$FB not found"
  if ! table_matches "$table" "$FA" "$FB"; then
    echo "verify-world: MISMATCH -- '$table' differs between '$A' and '$B':" >&2
    if [ "$table" = "cadence_liveness" ]; then
      bc_wb cadence-liveness-forward-diff "$FA" "$FB" >&2 || true
    elif [ "$table" = "reducer_class_counter" ]; then
      bc_wb counter-forward-diff "$FA" "$FB" >&2 || true
    else
      diff -u "$FA" "$FB" >&2 || true
    fi
    MISMATCHES=$((MISMATCHES + 1))
  fi
  CHECKED=$((CHECKED + 1))
done <<< "$(bc_table_names "$BC_SNAPSHOT" non-scheduled)"

if [ "$MISMATCHES" -gt 0 ]; then
  bc_ops_die "$SCRIPT" "$MISMATCHES of $CHECKED table(s) differ -- not a row-for-row match"
fi

echo "verify-world: ok -- $CHECKED non-scheduled table(s) match byte for byte between '$A' and '$B'" >&2
exit 0
