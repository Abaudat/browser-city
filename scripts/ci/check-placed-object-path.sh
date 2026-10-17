#!/usr/bin/env bash
# Story 7.1: placed objects have three writers and no more. Under
# server/src/ the `placed_object` accessor may be named only in
#   - tables/district.rs  (`create_district` writes pass 7's rows),
#   - tables/housing.rs   (a tenancy's starting box),
#   - tables/restore.rs   (restores by value) and tables/metrics.rs (row
#     counts),
#   - tables/time_control.rs (the time-control flavour's
#     `debug_clear_chunks`, never deployed), and
#   - tables/world.rs, which declares it.
# Comment lines are skipped. Usage: check-placed-object-path.sh [src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-placed-object-path: $SRC_DIR not found" >&2; exit 1; }
[ -f "$SRC_DIR/tables/world.rs" ] || { echo "check-placed-object-path: FAIL -- $SRC_DIR/tables/world.rs not found (the scan matched nothing)" >&2; exit 1; }

BAD=""
while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  case "$rel" in tables/district.rs | tables/housing.rs | tables/restore.rs | tables/metrics.rs | tables/time_control.rs | tables/world.rs) continue ;; esac
  if grep -v '^[[:space:]]*//' "$f" | tr -d '\r' | grep -Eq '(^|[^_[:alnum:]])placed_object[[:space:]]*\(\)'; then
    BAD="$BAD$rel"$'\n'
  fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)
if [ -n "$BAD" ]; then
  echo "check-placed-object-path: FAIL -- only district.rs, housing.rs, restore.rs, metrics.rs and time_control.rs may name the placed_object accessor:" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-placed-object-path: the placed_object accessor has its three writers and no more" >&2
