#!/usr/bin/env bash
# scripts/ci/check-proposer-no-content-keys.sh's own fast, no-real-tree
# coverage (story 2.3): plants a fake manifest, a fake defs/ tree and a
# fake proposer source tree, and asserts the right exit code.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-proposer-no-content-keys.sh"

# plant <manifest-lines> <defs-object-toml> <propose.rs content> --
# writes a fresh fake tree and prints its path.
plant() {
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/manifest.golden"
  mkdir -p "$d/defs/objects" "$d/src"
  printf '%s\n' "$2" > "$d/defs/objects/city-props.toml"
  printf '%s\n' "$3" > "$d/src/propose.rs"
  printf '%s' "$d"
}

VALID_OBJECT='[[object]]
id = 1
key = "trash_bin"
sprite = { sheet = "ModernTileset/x/lamp.png", x = 0, y = 0, w = 16, h = 16 }
'

d="$(plant 'object 1 trash_bin' "$VALID_OBJECT" '// a clean proposer: no key, no filename, just geometry.
pub fn propose() {}
')"
check "a clean proposer with no content key or filename literal passes" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/src" "$d/defs"

d="$(plant 'object 1 trash_bin' "$VALID_OBJECT" 'fn is_trash_bin(key: &str) -> bool {
    key == "trash_bin"
}
')"
check "a hardcoded object key literal fails" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/src" "$d/defs"

d="$(plant 'object 1 trash_bin' "$VALID_OBJECT" 'fn is_lamp(sheet: &str) -> bool {
    sheet == "lamp.png"
}
')"
check "a hardcoded sheet filename literal fails" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/src" "$d/defs"

d="$(plant 'object 1 trash_bin' "$VALID_OBJECT" '// a test fixture constant and ordinary prose using the same word --
// neither is a hardcoded literal.
const TRASH_BIN: u32 = 5;
/// Proposes a footprint for a trash bin-shaped sprite.
pub fn propose() {}
')"
check "a bare identifier or ordinary prose using the same word is never a false positive" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/src" "$d/defs"

d="$(plant 'object 1 trash_bin' "$VALID_OBJECT" '// clean
pub fn propose() {}
')"
rm -rf "$d/src"
mkdir -p "$d/does-not-exist"
check "a missing proposer directory fails closed, never a silent pass" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/does-not-exist" "$d/defs"

check "a missing manifest fails loudly" 1 \
  bash "$CHECK" "$REPO_ROOT/does/not/exist.golden" "$REPO_ROOT/tools/defs-build/src" "$REPO_ROOT/defs"

summary
exit $?
