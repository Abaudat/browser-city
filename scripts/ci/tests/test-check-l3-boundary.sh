#!/usr/bin/env bash
# scripts/ci/check-l3-boundary.sh's own coverage (story 5.1): plants each
# banned construct in a throwaway directory and asserts exit 1, plus the
# imports L3 really makes, asserting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-l3-boundary.sh"

plant() { # <content> -- writes it to a fresh fake dir's only *.ts file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/body.ts"
  printf '%s' "$d"
}

d="$(plant 'import type { Defs } from "../defs/types";')"
check "a defs type import" 0 bash "$CHECK" "$d"

d="$(plant 'import { findMicroPath } from "./micro-path";')"
check "a sibling import" 0 bash "$CHECK" "$d"

d="$(plant '// never reads window or Date.now: time is an argument')"
check "a comment naming a banned global is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant 'const windowSize = 3; const documentation = 1; export { windowSize, documentation };')"
check "an identifier containing window or document is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant 'import { callReducer } from "../net/bindings";')"
check "a net bindings import" 1 bash "$CHECK" "$d"

d="$(plant 'import type { Row } from "../net/bindings/types";')"
check "a type-only net import" 1 bash "$CHECK" "$d"

d="$(plant 'import { Sprite } from "pixi.js";')"
check "a pixi.js import" 1 bash "$CHECK" "$d"

d="$(plant 'import { STREET_PROPS } from "../test-street/fixture";')"
check "a test-street import" 1 bash "$CHECK" "$d"

d="$(plant 'import { step } from "../world/movement";')"
check "the player's movement module" 1 bash "$CHECK" "$d"

d="$(plant 'import { stepAndTransition } from "../world/floor-walk";')"
check "the floor-walk module" 1 bash "$CHECK" "$d"

d="$(plant 'import { keyboard } from "../input/keyboard";')"
check "an input import" 1 bash "$CHECK" "$d"

d="$(plant 'const m = await import("../net/connection");')"
check "a dynamic net import" 1 bash "$CHECK" "$d"

d="$(plant 'export const t = performance.now();')"
check "performance.now" 1 bash "$CHECK" "$d"

d="$(plant 'export const t = Date.now();')"
check "Date.now" 1 bash "$CHECK" "$d"

d="$(plant 'export const r = Math.random();')"
check "Math.random" 1 bash "$CHECK" "$d"

d="$(plant 'export const w = window.innerWidth;')"
check "a window read" 1 bash "$CHECK" "$d"

d="$(plant 'export const e = document.body;')"
check "a document read" 1 bash "$CHECK" "$d"

summary
exit $?
