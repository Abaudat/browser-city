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

SHA_A="$("$BC_PYTHON" -c "import json,sys; print(json.load(open(sys.argv[1]))['schema_sha256'])" "$A/manifest.json")"
SHA_B="$("$BC_PYTHON" -c "import json,sys; print(json.load(open(sys.argv[1]))['schema_sha256'])" "$B/manifest.json")"
[ "$SHA_A" = "$SHA_B" ] || bc_ops_die "$SCRIPT" "the two exports were taken against different schemas ($SHA_A vs $SHA_B) -- not comparable"

MISMATCHES=0
CHECKED=0
while IFS= read -r table; do
  [ -n "$table" ] || continue
  FA="$A/$table.jsonl"
  FB="$B/$table.jsonl"
  [ -f "$FA" ] || bc_ops_die "$SCRIPT" "$FA not found"
  [ -f "$FB" ] || bc_ops_die "$SCRIPT" "$FB not found"
  if ! cmp -s "$FA" "$FB"; then
    echo "verify-world: MISMATCH -- '$table' differs between '$A' and '$B':" >&2
    diff -u "$FA" "$FB" >&2 || true
    MISMATCHES=$((MISMATCHES + 1))
  fi
  CHECKED=$((CHECKED + 1))
done <<< "$(bc_table_names non-scheduled)"

if [ "$MISMATCHES" -gt 0 ]; then
  bc_ops_die "$SCRIPT" "$MISMATCHES of $CHECKED table(s) differ -- not a row-for-row match"
fi

echo "verify-world: ok -- $CHECKED non-scheduled table(s) match byte for byte between '$A' and '$B'" >&2
exit 0
