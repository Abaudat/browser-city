#!/usr/bin/env bash
# scripts/ci/check-layer-table-current.sh's own fast, no-real-tree
# coverage: plants a matching set of fakes (golden, codes.rs,
# layer-table.ts, defs_codes.rs) and asserts it passes, then plants each
# kind of drift in turn and asserts it fails -- a guard nobody has seen
# fail is not a guard. Every case here uses the script's own optional
# path arguments (added for exactly this), never the real repo files.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-layer-table-current.sh"

GOLDEN_CONTENT='matter_kind 0 sanitation
layer 0 ground 0
layer 1 overhead 1
layer 2 furniture 10
'
CODES_RS_CONTENT='pub const DEPRECATED_CODES: &[u32] = &[1];
pub const FIRST_POOL_RANK: u32 = 10;
'
LAYER_TABLE_TS_CONTENT='export const LAYER_TABLE = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 1, deprecated: true },
  { code: 2, name: "furniture", rank: 10, deprecated: false },
];
export const FIRST_POOL_RANK = 10;
'
LAYER_CODES_RS_CONTENT='pub const DEPRECATED_LAYER_NAMES: &[&str] = &["overhead"];
pub const FIRST_POOL_RANK: u32 = 10;
'

# plant <golden> <codes.rs> <layer-table.ts> <defs_codes.rs> -- writes
# the four fakes into a fresh dir and prints its path.
plant() {
  local d
  d="$(fake_dir)"
  printf '%s' "$1" > "$d/codes_v1.golden"
  printf '%s' "$2" > "$d/codes.rs"
  printf '%s' "$3" > "$d/layer-table.ts"
  printf '%s' "$4" > "$d/defs_codes.rs"
  printf '%s' "$d"
}

d="$(plant "$GOLDEN_CONTENT" "$CODES_RS_CONTENT" "$LAYER_TABLE_TS_CONTENT" "$LAYER_CODES_RS_CONTENT")"
check "a matching set of fakes passes" 0 \
  bash "$CHECK" "$d/codes_v1.golden" "$d/codes.rs" "$d/layer-table.ts" "$d/defs_codes.rs"

d="$(plant "$GOLDEN_CONTENT" "$CODES_RS_CONTENT" \
  'export const LAYER_TABLE = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 99, deprecated: true },
  { code: 2, name: "furniture", rank: 10, deprecated: false },
];
' "$LAYER_CODES_RS_CONTENT")"
check "a client rank mismatch fails" 1 \
  bash "$CHECK" "$d/codes_v1.golden" "$d/codes.rs" "$d/layer-table.ts" "$d/defs_codes.rs"

d="$(plant "$GOLDEN_CONTENT" "$CODES_RS_CONTENT" \
  'export const LAYER_TABLE = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 1, deprecated: false },
  { code: 2, name: "furniture", rank: 10, deprecated: false },
];
' "$LAYER_CODES_RS_CONTENT")"
check "a client deprecated-flag mismatch fails" 1 \
  bash "$CHECK" "$d/codes_v1.golden" "$d/codes.rs" "$d/layer-table.ts" "$d/defs_codes.rs"

# The planted drift this cycle's own review asked for: defs-build's own
# DEPRECATED_LAYER_NAMES copy (tools/defs-build/src/defs_codes.rs) can
# drift from sim::codes::layer::DEPRECATED_CODES without this check
# catching it, until now.
d="$(plant "$GOLDEN_CONTENT" "$CODES_RS_CONTENT" "$LAYER_TABLE_TS_CONTENT" \
  'pub const DEPRECATED_LAYER_NAMES: &[&str] = &[];
')"
check "defs-build's DEPRECATED_LAYER_NAMES missing a name the server deprecated fails" 1 \
  bash "$CHECK" "$d/codes_v1.golden" "$d/codes.rs" "$d/layer-table.ts" "$d/defs_codes.rs"

d="$(plant "$GOLDEN_CONTENT" "$CODES_RS_CONTENT" "$LAYER_TABLE_TS_CONTENT" \
  'pub const DEPRECATED_LAYER_NAMES: &[&str] = &["overhead", "furniture"];
')"
check "defs-build's DEPRECATED_LAYER_NAMES naming an extra, non-deprecated layer fails" 1 \
  bash "$CHECK" "$d/codes_v1.golden" "$d/codes.rs" "$d/layer-table.ts" "$d/defs_codes.rs"

d="$(plant "$GOLDEN_CONTENT" "$CODES_RS_CONTENT" "$LAYER_TABLE_TS_CONTENT" 'pub const NOTHING_HERE: u32 = 0;
')"
check "a defs_codes.rs missing DEPRECATED_LAYER_NAMES entirely fails" 1 \
  bash "$CHECK" "$d/codes_v1.golden" "$d/codes.rs" "$d/layer-table.ts" "$d/defs_codes.rs"

d="$(plant "$GOLDEN_CONTENT" "$CODES_RS_CONTENT" "$LAYER_TABLE_TS_CONTENT" \
  'pub const DEPRECATED_LAYER_NAMES: &[&str] = &["overhead"];
pub const FIRST_POOL_RANK: u32 = 20;
')"
check "a defs-build FIRST_POOL_RANK that differs from sim's fails" 1 \
  bash "$CHECK" "$d/codes_v1.golden" "$d/codes.rs" "$d/layer-table.ts" "$d/defs_codes.rs"

summary
exit $?
