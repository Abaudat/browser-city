#!/usr/bin/env bash
# scripts/ci/check-one-body-path.sh's own coverage: plants each banned
# construct in a throwaway client tree and asserts exit 1, plus the places
# that are allowed, expecting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-one-body-path.sh"

plant() { # <relative file> <content> -- a fresh client tree with that one file
  local d
  d="$(fake_dir)"
  mkdir -p "$(dirname "$d/$1")"
  printf '%s\n' "$2" > "$d/$1"
  printf '%s' "$d"
}

d="$(plant src/render/body-sprite.ts 'return frames.frame(a, d, i);')"
check "a frame lookup in render/body-sprite.ts passes" 0 bash "$CHECK" "$d"

d="$(plant src/render/appearance/appearance-texture.ts 'return this.frame(a, d, i);')"
check "a frame lookup in render/appearance/ passes" 0 bash "$CHECK" "$d"

d="$(plant src/test-street/remote-players-layer.ts 'sprite.texture = frames.frame("idle", facing, 0);')"
check "a frame lookup in a layer" 1 bash "$CHECK" "$d"

d="$(plant src/test-street/scene.ts 'const t = playerFrames.frame("idle", "down", 0);')"
check "a frame lookup in the scene" 1 bash "$CHECK" "$d"

d="$(plant src/test-street/scene.ts 'playerSprite.texture = other;')"
check "a character sprite texture assignment in the scene" 1 bash "$CHECK" "$d"

d="$(plant src/test-street/scene.ts 'if (playerSprite.texture === other) return;')"
check "a texture comparison is not an assignment" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
check "a missing src directory" 1 bash "$CHECK" "$d"

summary
exit $?
