#!/usr/bin/env bash
# check-routing-search-determinism.sh's own coverage: plants each banned
# construct in a throwaway directory.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-routing-search-determinism.sh"

plant() {
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/search.rs"
  printf '%s' "$d"
}

d="$(plant 'use std::collections::BTreeMap;')"
check "an ordered map is fine" 0 bash "$CHECK" "$d"

d="$(plant '// never a HashMap here')"
check "a comment naming HashMap is fine" 0 bash "$CHECK" "$d"

d="$(plant 'use std::collections::HashMap;')"
check "a HashMap" 1 bash "$CHECK" "$d"

d="$(plant 'let s: std::collections::HashSet<u64> = Default::default();')"
check "a HashSet" 1 bash "$CHECK" "$d"

d="$(plant 'use std::collections::hash_map::Entry;')"
check "a hash_map path alias" 1 bash "$CHECK" "$d"

check "the real routing/ passes" 0 bash "$CHECK"

summary
exit $?
