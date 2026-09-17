#!/usr/bin/env bash
# scripts/ci/check-no-runtime-footprint-inference.sh's own fast,
# no-real-tree coverage (story 2.3, AC3/AC4): plants a fake repo root
# with the shape the real check expects and asserts the right exit code,
# with one planted violation per side (client and server).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-runtime-footprint-inference.sh"

# plant -- a fresh fake repo root with clean generated artefacts, a
# clean lib.rs, and empty client/server trees. Each test case then
# overwrites one file to plant its own violation (or none at all).
plant() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/server/sim/src/generated" "$d/client/public/defs" \
    "$d/client/src/render" "$d/server/sim/src" "$d/tools/defs-build/src"
  printf 'pub const DEFS_VERSION: &str = "abc123";\n' \
    > "$d/server/sim/src/generated/defs.rs"
  printf '{ "defs_version": "abc123" }\n' > "$d/client/public/defs/defs.json"
  printf 'pub mod propose;\n' > "$d/tools/defs-build/src/lib.rs"
  printf 'export function draw() {}\n' > "$d/client/src/render/draw.ts"
  printf 'pub fn simulate() {}\n' > "$d/server/sim/src/lib.rs"
  printf '%s' "$d"
}

d="$(plant)"
check "a clean tree with no archetype/proposer reference anywhere passes" 0 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'pub const ARCHETYPE_COUNT: u32 = 3;\n' >> "$d/server/sim/src/generated/defs.rs"
check "'archetype' in the generated Rust artefact fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf '{ "archetype": "pole" }\n' > "$d/client/public/defs/defs.json"
check "'archetype' in the generated JSON artefact fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'const archetype = "pole";\n' > "$d/client/src/render/draw.ts"
check "'archetype' under client/src/ fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'fn resolve_archetype() {}\n' >> "$d/server/sim/src/lib.rs"
check "'archetype' under server/ fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'use defs_build::propose::propose;\n' >> "$d/tools/defs-build/src/lib.rs"
check "lib.rs referencing 'propose::' fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'const { data } = ctx.getImageData(0, 0, 1, 1);\n' >> "$d/client/src/render/draw.ts"
check "'getImageData' under client/src/ (outside test-street) fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
mkdir -p "$d/client/src/test-street"
printf 'const { data } = ctx.getImageData(0, 0, 1, 1);\n' \
  > "$d/client/src/test-street/compare.ts"
check "'getImageData' under client/src/test-street/ is never a false positive" 0 \
  bash "$CHECK" "$d"

summary
exit $?
