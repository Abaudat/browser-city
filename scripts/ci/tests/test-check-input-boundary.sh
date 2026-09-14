#!/usr/bin/env bash
# scripts/ci/check-input-boundary.sh's own fast, no-real-source-tree
# coverage (story 1.9): plants each banned import in a throwaway temp
# directory and asserts exit 1, plus the legitimate imports the input
# layer really does make, asserting exit 0 -- a guard nobody has seen fail
# is not a guard, and one that fails on correct code is worse.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-input-boundary.sh"

plant() { # <content> -- writes it to a fresh fake dir's only *.ts file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/pick.ts"
  printf '%s' "$d"
}

d="$(plant 'import { compareDrawables } from "../render/sort-key";')"
check "the render imports the input layer really makes" 0 bash "$CHECK" "$d"

d="$(plant 'import type { FootprintEntry } from "../world/footprint-index";')"
check "a world type-only import is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant 'const interaction = resolve(); export { interaction };')"
check "a local identifier named interaction is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant 'import { sendProcedure } from "../net/bindings";')"
check "a reducer binding import" 1 bash "$CHECK" "$d"

d="$(plant 'import { connect } from "../net/connection";')"
check "a net/ import" 1 bash "$CHECK" "$d"

d="$(plant 'import { DEMO_PROPS } from "../demo/fixture";')"
check "a demo/ import" 1 bash "$CHECK" "$d"

d="$(plant 'import { runProcedure } from "../procedures/vend";')"
check "a procedure module import" 1 bash "$CHECK" "$d"

d="$(plant 'import type { Interaction } from "../interaction/model";')"
check "an interaction module import" 1 bash "$CHECK" "$d"

d="$(plant 'import { Sprite } from "pixi.js";')"
check "a pixi.js import" 1 bash "$CHECK" "$d"

d="$(plant 'const later = await import("../procedures/vend");')"
check "a dynamic procedure import" 1 bash "$CHECK" "$d"

summary
exit $?
