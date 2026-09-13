#!/usr/bin/env bash
# scripts/ci/check-no-masks.sh's own fast, no-real-source-tree coverage
# (Tim's direction, story 1.7 cycle 2): plants each banned construct in a
# throwaway temp directory and asserts exit 1, plus a clean file expecting
# exit 0 -- a guard nobody has seen fail is not a guard.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-masks.sh"

plant() { # <content> -- writes it to a fresh fake dir's only *.ts file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/scene.ts"
  printf '%s' "$d"
}

d="$(plant 'export const clean = 1;')"
check "a file with none of the banned constructs passes" 0 bash "$CHECK" "$d"

d="$(plant 'sprite.mask = graphics;')"
check "mask assignment (sprite.mask = ...)" 1 bash "$CHECK" "$d"

d="$(plant 'const view = { mask: graphics };')"
check "mask object-literal option ({ mask: g })" 1 bash "$CHECK" "$d"

d="$(plant 'sprite.setMask(graphics);')"
check "setMask(...) call" 1 bash "$CHECK" "$d"

d="$(plant 'const f = new AlphaFilter();')"
check "a Pixi *Filter class (new AlphaFilter())" 1 bash "$CHECK" "$d"

d="$(plant 'container.filters = [blur];')"
check "filters assignment (container.filters = [...])" 1 bash "$CHECK" "$d"

d="$(plant 'sprite.filterArea = new Rectangle();')"
check "filterArea assignment" 1 bash "$CHECK" "$d"

d="$(plant 'const tex = RenderTexture.create({ width: 1, height: 1 });')"
check "RenderTexture construct" 1 bash "$CHECK" "$d"

d="$(plant 'renderer.stencil = true;')"
check "stencil reference" 1 bash "$CHECK" "$d"

d="$(plant 'const kept = items.filter((x) => x.visible);')"
check "Array.prototype.filter(...) is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant 'expect(view.mask === null).toBe(true);')"
check "a read comparing .mask to null is never a false positive" 0 bash "$CHECK" "$d"

summary
exit $?
