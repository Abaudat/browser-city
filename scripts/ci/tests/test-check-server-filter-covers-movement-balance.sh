#!/usr/bin/env bash
# scripts/ci/check-server-filter-covers-movement-balance.sh's own fast,
# no-real-tree coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-server-filter-covers-movement-balance.sh"

plant() {
  local d
  d="$(fake_dir)"
  printf '%s' "$1" > "$d/ci.yml"
  printf '%s' "$d"
}

CI_COVERING='jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@x
        with:
          filters: |
            server:
              - "server/**"
              - "defs/balance/movement.toml"
            other:
              - "other/**"
'
CI_NOT_COVERING='jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@x
        with:
          filters: |
            server:
              - "server/**"
            other:
              - "other/**"
'
CI_NO_SERVER_FILTER='jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@x
        with:
          filters: |
            other:
              - "other/**"
'

d="$(plant "$CI_COVERING")"
check "a server: filter covering the movement balance file passes" 0 \
  bash "$CHECK" "$d/ci.yml"

d="$(plant "$CI_NOT_COVERING")"
check "a server: filter missing the movement balance file fails" 1 \
  bash "$CHECK" "$d/ci.yml"

d="$(plant "$CI_NO_SERVER_FILTER")"
check "no server: filter at all fails" 1 \
  bash "$CHECK" "$d/ci.yml"

summary
exit $?
