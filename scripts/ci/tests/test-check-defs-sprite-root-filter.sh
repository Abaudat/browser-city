#!/usr/bin/env bash
# scripts/ci/check-defs-sprite-root-filter.sh's own fast, no-real-tree
# coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-defs-sprite-root-filter.sh"

# plant <model.rs content> <ci.yml content> -- writes both fakes into a
# fresh dir and prints its path.
plant() {
  local d
  d="$(fake_dir)"
  printf '%s' "$1" > "$d/model.rs"
  printf '%s' "$2" > "$d/ci.yml"
  printf '%s' "$d"
}

MODEL_RS='pub const SPRITE_SHEET_ALLOWED_ROOT: &str = "ModernTileset/";
'
CI_COVERING='jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@x
        with:
          filters: |
            defs:
              - "defs/**"
              - "ModernTileset/**"
            other:
              - "other/**"
'
CI_NOT_COVERING='jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@x
        with:
          filters: |
            defs:
              - "defs/**"
              - "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/**"
            other:
              - "other/**"
'
CI_NO_DEFS_FILTER='jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@x
        with:
          filters: |
            other:
              - "other/**"
'

d="$(plant "$MODEL_RS" "$CI_COVERING")"
check "a defs: filter covering the whole allowed root passes" 0 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

d="$(plant "$MODEL_RS" "$CI_NOT_COVERING")"
check "a defs: filter narrower than the allowed root fails" 1 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

d="$(plant "$MODEL_RS" "$CI_NO_DEFS_FILTER")"
check "no defs: filter at all fails" 1 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

d="$(plant 'pub const NOTHING_HERE: u32 = 0;
' "$CI_COVERING")"
check "a model.rs missing SPRITE_SHEET_ALLOWED_ROOT entirely fails" 1 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

summary
exit $?
