#!/usr/bin/env bash
# scripts/ci/check-no-scene-rounding.sh's own coverage: plants each banned
# call in a throwaway directory and asserts exit 1, plus the constructs
# that must never be false positives, expecting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-scene-rounding.sh"

plant() { # <content> -- writes it to a fresh fake dir's only *.ts file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/scene.ts"
  printf '%s' "$d"
}

d="$(plant 'tile.x = snapToScreenPx(x * tileSizePx, zoom);')"
check "a position placed through snapToScreenPx passes" 0 bash "$CHECK" "$d"

d="$(plant 'sprite.x = Math.round(pose.x * tileSizePx);')"
check "Math.round(...)" 1 bash "$CHECK" "$d"

d="$(plant 'const cell = Math.floor(x);')"
check "Math.floor(...)" 1 bash "$CHECK" "$d"

d="$(plant 'const cell = Math.trunc (x);')"
check "Math.trunc (...) with a space before the paren" 1 bash "$CHECK" "$d"

d="$(plant 'const up = Math.max(0, Math.ceil(h / tile));')"
check "Math.ceil/Math.max are never a false positive" 0 bash "$CHECK" "$d"

d="$(plant '// the cell (`cellOf`, `Math.floor`) the player stands in')"
check "prose naming Math.floor in a comment is never a false positive" 0 bash "$CHECK" "$d"

check "a missing scan directory fails loudly" 1 bash "$CHECK" "$(fake_dir)/missing"

summary
exit $?
