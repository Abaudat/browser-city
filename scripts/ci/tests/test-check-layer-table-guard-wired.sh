#!/usr/bin/env bash
# scripts/ci/check-layer-table-guard-wired.sh's own fast, no-real-tree
# coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-layer-table-guard-wired.sh"

WIRED='jobs:
  changes:
    steps:
      - run: echo hi
  defs:
    needs: changes
    steps:
      - run: bash ../../scripts/ci/check-defs-current.sh
      - run: bash ../../scripts/ci/check-layer-table-current.sh
  check:
    steps:
      - run: echo other
'

NOT_WIRED='jobs:
  changes:
    steps:
      - run: echo hi
  defs:
    needs: changes
    steps:
      - run: bash ../../scripts/ci/check-defs-current.sh
  check:
    steps:
      - run: echo other
'

NO_DEFS_JOB='jobs:
  changes:
    steps:
      - run: echo hi
  check:
    steps:
      - run: echo other
'

d="$(fake_dir)"
printf '%s' "$WIRED" > "$d/ci.yml"
check "the defs job running check-layer-table-current.sh passes" 0 bash "$CHECK" "$d/ci.yml"

d="$(fake_dir)"
printf '%s' "$NOT_WIRED" > "$d/ci.yml"
check "the defs job never running check-layer-table-current.sh fails" 1 bash "$CHECK" "$d/ci.yml"

d="$(fake_dir)"
printf '%s' "$NO_DEFS_JOB" > "$d/ci.yml"
check "no defs job at all fails" 1 bash "$CHECK" "$d/ci.yml"

d="$(fake_dir)"
check "a missing ci.yml fails" 1 bash "$CHECK" "$d/no-such-file.yml"

summary
exit $?
