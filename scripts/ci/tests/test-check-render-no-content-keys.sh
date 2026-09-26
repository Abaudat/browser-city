#!/usr/bin/env bash
# scripts/ci/check-render-no-content-keys.sh's own fast coverage: plants a
# fake manifest and fake renderer sources.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-render-no-content-keys.sh"

d="$(fake_dir)"
printf 'object 1 manhole\ntag 1 wall\n' > "$d/manifest.golden"
mkdir -p "$d/render"
echo 'export const pass = (layer: number) => layer;' > "$d/render/a.ts"
check "a renderer with no object key literal passes" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/render"

echo 'const flat = (key: string) => key === "manhole";' > "$d/render/b.ts"
check "a quoted object key in the renderer fails" 1 \
  bash "$CHECK" "$d/manifest.golden" "$d/render"

rm "$d/render/b.ts"
echo 'const wall = "wall"; // a tag key, and a manhole in prose' > "$d/render/c.ts"
check "a tag key or a bare word does not fail" 0 \
  bash "$CHECK" "$d/manifest.golden" "$d/render"
