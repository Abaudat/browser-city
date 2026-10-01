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
    "$d/client/src/render" "$d/server/sim/src" \
    "$d/tools/defs-build/src/bin"
  printf 'pub const DEFS_VERSION: &str = "abc123";\n' \
    > "$d/server/sim/src/generated/defs.rs"
  printf '{ "defs_version": "abc123" }\n' > "$d/client/public/defs/defs.json"
  printf 'pub mod propose;\npub mod validate;\n' > "$d/tools/defs-build/src/lib.rs"
  printf 'pub fn propose() {}\n' > "$d/tools/defs-build/src/propose.rs"
  # Story 15.3: the one declaration of the threshold and of `is_opaque`.
  printf 'pub const ALPHA_OPAQUE_THRESHOLD: u8 = 200;\npub fn is_opaque() {}\n' \
    > "$d/tools/defs-build/src/alpha.rs"
  printf 'pub fn validate() {}\n' > "$d/tools/defs-build/src/validate.rs"
  # The proposer's own bin legitimately references `propose::` -- must
  # never itself be flagged.
  printf 'use defs_build::propose::propose;\nfn main() { propose(); }\n' \
    > "$d/tools/defs-build/src/bin/defs-propose.rs"
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
printf 'use crate::propose::propose;\n' >> "$d/tools/defs-build/src/validate.rs"
check "validate.rs (not lib.rs) referencing 'crate::propose' fails too" 1 \
  bash "$CHECK" "$d"

# --- story 2.5: contact_sheet.rs never reads pixel data ---------------------
d="$(plant)"
printf 'pub fn geometry() {}\n' > "$d/tools/defs-build/src/contact_sheet.rs"
check "a clean contact_sheet.rs (declared geometry only) passes" 0 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'use crate::atlas::image::decode_rgba8;\n' > "$d/tools/defs-build/src/contact_sheet.rs"
check "contact_sheet.rs importing crate::atlas::image fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'fn f() { let px = get_px(&rgba, 1, 0, 0); }\n' > "$d/tools/defs-build/src/contact_sheet.rs"
check "contact_sheet.rs calling get_px fails" 1 \
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

# --- story 15.3: pixels may refuse a build, never shape an artefact --------
d="$(plant)"
printf 'pub const ALPHA_OPAQUE_THRESHOLD: u8 = 1;\n' >> "$d/tools/defs-build/src/propose.rs"
check "a second ALPHA_OPAQUE_THRESHOLD declaration fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
rm "$d/tools/defs-build/src/alpha.rs"
check "no ALPHA_OPAQUE_THRESHOLD declaration at all fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'fn is_opaque(a: u8) -> bool { a > 0 }\n' >> "$d/tools/defs-build/src/propose.rs"
check "a second is_opaque function fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
mkdir -p "$d/tools/defs-build/src/atlas"
printf 'use crate::alpha::ALPHA_OPAQUE_THRESHOLD;\n' > "$d/tools/defs-build/src/propose.rs"
printf 'use crate::alpha::is_opaque;\n' > "$d/tools/defs-build/src/silhouette.rs"
printf 'use crate::alpha::ALPHA_OPAQUE_THRESHOLD;\n' > "$d/tools/defs-build/src/atlas/character.rs"
check "alpha:: referenced from propose.rs, silhouette.rs and atlas/character.rs passes" 0 \
  bash "$CHECK" "$d"

for f in emit.rs validate.rs contact_sheet.rs lib.rs; do
  d="$(plant)"
  printf 'use crate::alpha::is_opaque;\n' >> "$d/tools/defs-build/src/$f"
  check "alpha:: referenced from $f fails" 1 \
    bash "$CHECK" "$d"
done

# --- story 15.3 review: no second definition of transparent, and the check's
# Err never reaches an artefact -------------------------------------------
d="$(plant)"
printf 'fn f(px: [u8; 4]) -> bool { px[3] != 0 }\n' >> "$d/tools/defs-build/src/propose.rs"
check "an alpha-channel comparison outside alpha.rs fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'fn f(px: [u8; 4]) -> bool { px[3] >= 5 }\n' >> "$d/tools/defs-build/src/validate.rs"
check "a >= on the alpha channel in another file fails" 1 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'fn f(px: [u8; 4]) -> u8 { px[3] }\nfn g(a: [u32; 4]) -> bool { a[1] > 0 }\n' >> "$d/tools/defs-build/src/propose.rs"
check "reading the alpha byte without comparing it, and other indices, never false-positive" 0 \
  bash "$CHECK" "$d"

d="$(plant)"
printf 'use crate::silhouette::check;\n' > "$d/tools/defs-build/src/lib.rs"
printf 'use crate::silhouette::check_collider_against_art;\n' > "$d/tools/defs-build/src/propose.rs"
check "silhouette:: referenced from lib.rs and propose.rs passes" 0 \
  bash "$CHECK" "$d"

for f in emit.rs validate.rs contact_sheet.rs; do
  d="$(plant)"
  printf 'use crate::silhouette::check_collider_against_art;\n' >> "$d/tools/defs-build/src/$f"
  check "silhouette:: referenced from $f fails" 1 \
    bash "$CHECK" "$d"
done

summary
exit $?
