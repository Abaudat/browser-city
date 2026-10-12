#!/usr/bin/env bash
# scripts/ci/check-no-grid-table.sh's own coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-grid-table.sh"

snap() { # <accessor> <column>
  local f
  f="$(fake_dir)/schema.snapshot.json"
  printf '{"tables":[{"accessor":"%s","struct_name":"X","columns":[{"name":"%s","ty":"u32"}]}]}\n' "$1" "$2" > "$f"
  printf '%s' "$f"
}

check "a table of ordinary names passes" 0 bash "$CHECK" "$(snap placed_object x)"
check "the committed snapshot passes" 0 bash "$CHECK"
check "a collision table fails" 1 bash "$CHECK" "$(snap floor_collision x)"
check "a blocked column fails" 1 bash "$CHECK" "$(snap placed_object blocked_mask)"
check "a walkable column fails" 1 bash "$CHECK" "$(snap district walkable)"
check "a macro table fails" 1 bash "$CHECK" "$(snap macro_edge x)"

summary
exit $?
