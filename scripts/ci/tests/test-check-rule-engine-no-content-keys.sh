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
check "a missing engine directory fails closed, never a silent pass" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/does-not-exist"

check "a missing manifest fails loudly" 1 \
  bash "$CHECK" "$REPO_ROOT/does/not/exist.golden" "$REPO_ROOT/server/sim/src/rules"

# Story 6.8: the same guard run against one source file (the cash module).
d="$(plant_manifest 'item 3 coin_1')"
cat > "$d/cash.rs" <<'EOT'
fn is_penny(key: &str) -> bool {
    key == "coin_1"
}
EOT
check "a quoted denomination key in a single source file fails" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/cash.rs"

cat > "$d/cash.rs" <<'EOT'
// A table passed in by the caller: no key is named here.
pub fn value_of() {}
EOT
check "a clean single source file passes" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/cash.rs"

check "the real cash module names no manifest key" 0 \
  bash "$CHECK" "$REPO_ROOT/tools/defs-build/goldens/defs-manifest.golden" "$REPO_ROOT/server/sim/src/cash.rs"

summary
exit $?
