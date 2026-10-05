#!/usr/bin/env bash
# scripts/ci/check-render-no-content-keys.sh's own fast coverage: plants a
# fake manifest, fake fixture and fake renderer sources.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-render-no-content-keys.sh"

d="$(fake_dir)"
printf 'object 1 manhole\ntag 1 wall\n' > "$d/manifest.golden"
printf 'const rows = [{ assetKey: "doormat" }, { assetKey: "sidewalk" }];\n' > "$d/fixture.ts"
export BC_RENDER_FIXTURE="$d/fixture.ts"
mkdir -p "$d/render"
run() { bash "$CHECK" "$d/manifest.golden" "$d/render"; }

echo 'export const pass = (layer: number) => layer;' > "$d/render/a.ts"
check "a renderer with no key literal passes" 0 run

echo 'const flat = (key: string) => key === "manhole";' > "$d/render/b.ts"
check "a quoted defs object key in the renderer fails" 1 run
rm "$d/render/b.ts"

echo 'if (assetKey === "doormat") flat();' > "$d/render/c.ts"
check "a quoted fixture assetKey in the renderer fails" 1 run

echo 'textureFor("sidewalk", textures);' > "$d/render/c.ts"
check "an allow-listed asset key passes" 0 run

echo 'const wall = "wall"; // a tag key, and a manhole or doormat in prose' > "$d/render/c.ts"
check "a tag key or a bare word does not fail" 0 run

summary
exit $?
