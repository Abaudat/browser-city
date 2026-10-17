#!/usr/bin/env bash
# scripts/ci/check-visibility-writer.sh's own coverage: plants each banned
# construct in a throwaway client tree and asserts exit 1, plus the places
# that are allowed, expecting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-visibility-writer.sh"

plant() { # <relative file> <content> -- a fresh client tree with that one file
  local d
  d="$(fake_dir)"
  mkdir -p "$(dirname "$d/src/$1")"
  printf '%s\n' "$2" > "$d/src/$1"
  printf '%s' "$d"
}

d="$(plant render/pixi-visibility.ts 'member.view.visible = state !== "hidden";')"
check "the visibility applier writes visible" 0 bash "$CHECK" "$d"

d="$(plant render/remote-players-layer.ts 'd.sprite.visible = pose.floor === 0;')"
check "a layer writes visible" 1 bash "$CHECK" "$d"

d="$(plant render/world-scene.ts '  sprite.alpha = 0.5;')"
check "the scene writes alpha" 1 bash "$CHECK" "$d"

d="$(plant render/pixi-highlight.ts '      overlay.alpha = spec.alpha;')"
check "the allowlisted highlight overlay passes" 0 bash "$CHECK" "$d"

d="$(plant render/pixi-highlight.ts 'sprite.alpha = spec.alpha;')"
check "another alpha write in the highlight file fails" 1 bash "$CHECK" "$d"

d="$(plant render/world-scene.ts 'if (sprite.visible === false) return;')"
check "a read is not a write" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
check "a missing src directory" 1 bash "$CHECK" "$d"

summary
exit $?
