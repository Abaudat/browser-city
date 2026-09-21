#!/usr/bin/env bash
# scripts/ci/check-generator-no-content-keys.sh's own fast, no-real-tree
# coverage (story 3.4), the same precedent test-check-rule-engine-no-
# content-keys.sh sets for its own sibling script.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-generator-no-content-keys.sh"

# <manifest-lines> -- a fresh fake manifest with the given lines.
plant_manifest() {
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/manifest.golden"
  printf '%s' "$d"
}

d="$(plant_manifest 'building_type 1 depot
tag 1 dwelling')"
mkdir -p "$d/generation"
cat > "$d/generation/mod.rs" <<'EOF'
// A clean generator: reads only numeric ids and rule row fields, never a
// content key.
pub fn run() {}
EOF
check "a clean generator tree with no content key literal passes" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/generation"

d="$(plant_manifest 'building_type 1 depot')"
mkdir -p "$d/generation"
cat > "$d/generation/building_types.rs" <<'EOF'
fn is_depot(key: &str) -> bool {
    key == "depot"
}
EOF
check "a hardcoded quoted-literal branch on a real content key fails" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/generation"

d="$(plant_manifest 'tag 1 dwelling')"
mkdir -p "$d/generation"
cat > "$d/generation/mod.rs" <<'EOF'
// A test fixture named after the tag, and prose using the plain English
// word dwelling -- neither is a hardcoded branch on the content key.
const DWELLING: u32 = 18;
/// Every dwelling-holding type carries this tag.
fn noop() {}
EOF
check "a bare identifier or ordinary prose using the same word is never a false positive" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/generation"

d="$(plant_manifest 'building_type 1 depot')"
mkdir -p "$d/no-generation-here"
check "a missing generation directory fails closed, never a silent pass" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/does-not-exist"

check "a missing manifest fails loudly" 1 \
  bash "$CHECK" "$REPO_ROOT/does/not/exist.golden" "$REPO_ROOT/server/sim/src/generation"

summary
exit $?
