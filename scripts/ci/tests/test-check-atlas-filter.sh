#!/usr/bin/env bash
# scripts/ci/check-atlas-filter.sh's own fast, no-real-tree coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-atlas-filter.sh"

# plant <model.rs content> <ci.yml content> -- writes both fakes into a
# fresh dir and prints its path.
plant() {
  local d
  d="$(fake_dir)"
  printf '%s' "$1" > "$d/model.rs"
  printf '%s' "$2" > "$d/ci.yml"
  printf '%s' "$d"
}

MODEL_RS='pub const ATLAS_PAGES_DIR: &str = "client/public/atlas";
'
CI_COVERING='jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@x
        with:
          filters: |
            defs:
              - "defs/**"
              - "client/public/atlas/**"
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
check "a defs: filter covering ATLAS_PAGES_DIR passes" 0 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

d="$(plant "$MODEL_RS" "$CI_NOT_COVERING")"
check "a defs: filter missing ATLAS_PAGES_DIR fails" 1 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

d="$(plant "$MODEL_RS" "$CI_NO_DEFS_FILTER")"
check "no defs: filter at all fails" 1 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

d="$(plant 'pub const NOTHING_HERE: u32 = 0;
' "$CI_COVERING")"
check "a model.rs missing ATLAS_PAGES_DIR entirely fails" 1 \
  bash "$CHECK" "$d/model.rs" "$d/ci.yml"

summary
exit $?
