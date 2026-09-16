#!/usr/bin/env bash
# scripts/ci/check-rule-engine-no-content-keys.sh's own fast, no-real-tree
# coverage (story 2.10, AC3): plants a fake manifest and a fake engine
# source tree and asserts the right exit code -- a guard nobody has seen
# fail, or seen pass on ordinary prose/identifiers, is not a guard.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-rule-engine-no-content-keys.sh"

# <manifest-lines> -- a fresh fake manifest with the given lines.
plant_manifest() {
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/manifest.golden"
  printf '%s' "$d"
}

d="$(plant_manifest 'object 1 cafe
tag 1 wall')"
mkdir -p "$d/engine"
cat > "$d/engine/mod.rs" <<'EOF'
// A clean engine: matches only on the closed RuleKind enum, never a key.
pub fn evaluate() {}
EOF
check "a clean engine tree with no content key literal passes" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/engine"

d="$(plant_manifest 'object 1 cafe')"
mkdir -p "$d/engine"
cat > "$d/engine/mod.rs" <<'EOF'
fn is_cafe(key: &str) -> bool {
    key == "cafe"
}
EOF
check "a hardcoded quoted-literal branch on a real content key fails" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/engine"

d="$(plant_manifest 'tag 1 wall')"
mkdir -p "$d/engine"
cat > "$d/engine/mod.rs" <<'EOF'
// A test fixture named after the tag, and prose using the plain English
// word wall -- neither is a hardcoded branch on the content key.
const WALL: u32 = 5;
/// Steps toward a wall run, one segment at a time.
fn noop() {}
EOF
check "a bare identifier or ordinary prose using the same word is never a false positive" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/engine"

d="$(plant_manifest 'object 1 cafe')"
mkdir -p "$d/no-engine-here"
check "a missing engine directory is a pass, not a crash (nothing to check yet)" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/does-not-exist"

check "a missing manifest fails loudly" 1 \
  bash "$CHECK" "$REPO_ROOT/does/not/exist.golden" "$REPO_ROOT/server/sim/src/rules"

summary
exit $?
