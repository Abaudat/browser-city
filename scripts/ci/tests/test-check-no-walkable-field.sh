#!/usr/bin/env bash
# scripts/ci/check-no-walkable-field.sh's own fast, no-real-tree coverage:
# plants a `walkable` key (and, separately, legitimate prose using the
# same word) in a throwaway temp tree and asserts the right exit code --
# a guard nobody has seen fail, or seen pass on ordinary prose, is not a
# guard.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-walkable-field.sh"

# <defs-content> -- a fresh fake defs/ tree with one objects/*.toml file,
# plus two never-present rust/json paths (most cases here never touch
# those two).
plant_defs() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/defs/objects"
  printf '%s\n' "$1" > "$d/defs/objects/x.toml"
  printf '%s' "$d"
}

d="$(plant_defs 'id = 1
key = "trash_bin"
width = 1
height = 1')"
check "a clean tree with no 'walkable' anywhere passes" 0 \
  bash "$CHECK" "$d/defs" "$d/no-rust.rs" "$d/no-json.json"

d="$(plant_defs 'id = 1
key = "trash_bin"
walkable = true')"
check "an authored 'walkable = true' field fails" 1 \
  bash "$CHECK" "$d/defs" "$d/no-rust.rs" "$d/no-json.json"

d="$(plant_defs '# A door is an ordinary walkable cell (FR118).
id = 1
key = "trash_bin"')"
check "ordinary English prose using the word 'walkable' is never a false positive" 0 \
  bash "$CHECK" "$d/defs" "$d/no-rust.rs" "$d/no-json.json"

d="$(fake_dir)"
mkdir -p "$d/defs/objects"
printf 'id = 1\nkey = "trash_bin"\n' > "$d/defs/objects/x.toml"
printf 'pub const OBJECTS: &[ObjectDef] = &[\n    ObjectDef { id: 1, walkable: true },\n];\n' > "$d/defs.rs"
check "the generated Rust artefact carrying a 'walkable:' field fails" 1 \
  bash "$CHECK" "$d/defs" "$d/defs.rs" "$d/no-json.json"

d="$(fake_dir)"
mkdir -p "$d/defs/objects"
printf 'id = 1\nkey = "trash_bin"\n' > "$d/defs/objects/x.toml"
printf '{ "objects": [{ "id": 1, "walkable": true }] }\n' > "$d/defs.json"
check "the generated JSON artefact carrying a \"walkable\" key fails" 1 \
  bash "$CHECK" "$d/defs" "$d/no-rust.rs" "$d/defs.json"

summary
exit $?
