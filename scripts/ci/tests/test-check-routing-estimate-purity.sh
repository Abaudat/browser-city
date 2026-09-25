#!/usr/bin/env bash
# check-routing-estimate-purity.sh's own coverage: plants each banned
# construct in a throwaway file.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-routing-estimate-purity.sh"

plant() {
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/estimate.rs"
  printf '%s' "$d/estimate.rs"
}

f="$(plant 'use crate::balance;')"
check "a balance import is fine" 0 bash "$CHECK" "$f"

f="$(plant $'fn f() {}\n#[cfg(test)]\nmod t { fn g() -> Vec<i32> { vec![] } }')"
check "a collection inside the test module is fine" 0 bash "$CHECK" "$f"

f="$(plant 'use crate::generation::streets;')"
check "a generation import" 1 bash "$CHECK" "$f"

f="$(plant 'use crate::world::walkability::WalkabilityGrid;')"
check "a walkability import" 1 bash "$CHECK" "$f"

f="$(plant 'fn f(x: &Vec<i32>) {}')"
check "a Vec" 1 bash "$CHECK" "$f"

f="$(plant 'use std::collections::BTreeMap;')"
check "a BTreeMap" 1 bash "$CHECK" "$f"

check "the real estimator passes" 0 bash "$CHECK"

summary
exit $?
