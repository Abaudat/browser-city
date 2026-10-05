#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-layer-table-current.sh.
# Every fixture is a scratch directory with the four files the script
# reads -- never the live repo's own golden, codes.rs, layer-table.ts or
# defs-build codes.rs. No git needed: unlike the append-only checks, this
# script never diffs against a base ref, it only compares the files as
# they stand.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-layer-table-current.sh"

GOLDEN_PATH="server/sim/tests/goldens/codes_v1.golden"
CODES_RS_PATH="server/sim/src/codes.rs"
LAYER_TABLE_PATH="client/src/render/layer-table.ts"
LAYER_CODES_RS_PATH="tools/defs-build/src/codes.rs"

# The one content every case below uses for defs-build codes.rs unless it is
# itself the thing under test (story 2.2 cycle 1: defs-build's own
# DEPRECATED_LAYER_NAMES copy, checked against codes.rs's DEPRECATED_CODES
# the same way layer-table.ts already is) -- matches CODES_RS_HAPPY's own
# `&[1]` (only "overhead").
LAYER_CODES_RS_HAPPY='pub const DEPRECATED_LAYER_NAMES: &[&str] = &["overhead"];
pub const FIRST_POOL_RANK: u32 = 10;
'

# write_case <dir> <golden-content> <codes.rs-content> <layer-table.ts-content> [defs-build codes.rs-content]
write_case() {
  local d="$1"
  rm -rf "$d"
  mkdir -p "$d/$(dirname "$GOLDEN_PATH")" "$d/$(dirname "$CODES_RS_PATH")" \
    "$d/$(dirname "$LAYER_TABLE_PATH")" "$d/$(dirname "$LAYER_CODES_RS_PATH")" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-layer-table-current.sh"
  printf '%s' "$2" > "$d/$GOLDEN_PATH"
  printf '%s' "$3" > "$d/$CODES_RS_PATH"
  printf '%s' "$4" > "$d/$LAYER_TABLE_PATH"
  printf '%s' "${5:-$LAYER_CODES_RS_HAPPY}" > "$d/$LAYER_CODES_RS_PATH"
}

run_check() { # <dir>
  ( cd "$1" && bash scripts/ci/check-layer-table-current.sh )
}

GOLDEN_HAPPY='layer 0 ground 0
layer 1 overhead 1
layer 2 furniture 10
'

CODES_RS_HAPPY='pub const DEPRECATED_CODES: &[u32] = &[1];
pub const FIRST_POOL_RANK: u32 = 10;
'

LAYER_TABLE_HAPPY='export const LAYER_TABLE = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 1, deprecated: true },
  { code: 2, name: "furniture", rank: 10, deprecated: false },
];
export const FIRST_POOL_RANK = 10;
'

echo "green: the happy path -- all three files agree"
D="$(fake_dir)"
write_case "$D" "$GOLDEN_HAPPY" "$CODES_RS_HAPPY" "$LAYER_TABLE_HAPPY"
check "agreeing files -> exit 0" 0 run_check "$D"

echo
echo "red: a rank disagrees, client side only"
D="$(fake_dir)"
BAD_RANK='export const LAYER_TABLE = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 1, deprecated: true },
  { code: 2, name: "furniture", rank: 99, deprecated: false },
];
'
write_case "$D" "$GOLDEN_HAPPY" "$CODES_RS_HAPPY" "$BAD_RANK"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the disagreeing row" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'row 3 disagrees'" _ "$OUT"

echo
echo "red: a name disagrees, client side only"
D="$(fake_dir)"
BAD_NAME='export const LAYER_TABLE = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 1, deprecated: true },
  { code: 2, name: "fixtures", rank: 10, deprecated: false },
];
'
write_case "$D" "$GOLDEN_HAPPY" "$CODES_RS_HAPPY" "$BAD_NAME"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the disagreeing row" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'row 3 disagrees'" _ "$OUT"

echo
echo "red: a code appended to the golden but not to the client table"
D="$(fake_dir)"
GOLDEN_EXTRA="$GOLDEN_HAPPY"'layer 3 objects 20
'
write_case "$D" "$GOLDEN_EXTRA" "$CODES_RS_HAPPY" "$LAYER_TABLE_HAPPY"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the row-count mismatch" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'layer rows but'" _ "$OUT"

echo
echo "red: a code appended to the client table but not to the golden (the reverse)"
D="$(fake_dir)"
TABLE_EXTRA='export const LAYER_TABLE = [
  { code: 0, name: "ground", rank: 0, deprecated: false },
  { code: 1, name: "overhead", rank: 1, deprecated: true },
  { code: 2, name: "furniture", rank: 10, deprecated: false },
  { code: 3, name: "objects", rank: 20, deprecated: false },
];
'
write_case "$D" "$GOLDEN_HAPPY" "$CODES_RS_HAPPY" "$TABLE_EXTRA"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the row-count mismatch" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'layer rows but'" _ "$OUT"

echo
echo "red: a code added to DEPRECATED_CODES without the client's deprecated flag following"
D="$(fake_dir)"
CODES_RS_NEW_DEPRECATED='pub const DEPRECATED_CODES: &[u32] = &[1, 2];
'
write_case "$D" "$GOLDEN_HAPPY" "$CODES_RS_NEW_DEPRECATED" "$LAYER_TABLE_HAPPY"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the deprecation disagreement" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'deprecated=true'" _ "$OUT"

echo
echo "red: LAYER_TABLE's shape no longer parses at all -- must fail, never pass by finding nothing"
D="$(fake_dir)"
UNPARSEABLE='export const LAYER_TABLE = someHelperFunctionCallNow();
'
write_case "$D" "$GOLDEN_HAPPY" "$CODES_RS_HAPPY" "$UNPARSEABLE"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the parse failure" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'no rows parsed'" _ "$OUT"

echo
echo "red: codes.rs has no DEPRECATED_CODES line at all -- must fail, never pass by finding nothing"
D="$(fake_dir)"
NO_DEPRECATED_LINE='pub mod layer {
    pub const CODES: &[LayerCode] = &[];
}
'
write_case "$D" "$GOLDEN_HAPPY" "$NO_DEPRECATED_LINE" "$LAYER_TABLE_HAPPY"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing DEPRECATED_CODES line" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'could not find DEPRECATED_CODES'" _ "$OUT"

summary
