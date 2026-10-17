#!/usr/bin/env bash
# scripts/ci/check-no-test-street.sh's own coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-test-street.sh"

plant() { # <relative file> <content>
  local d
  d="$(fake_dir)"
  mkdir -p "$d/src" "$d/tests" "$(dirname "$d/$1")"
  printf '%s\n' "$2" > "$d/$1"
  printf '%s' "$d"
}

d="$(plant src/render/a.ts 'import { x } from "../world/chunk";')"
check "a clean tree passes" 0 bash "$CHECK" "$d"

d="$(plant src/test-street/scene.ts 'export const x = 1;')"
check "a test-street directory fails" 1 bash "$CHECK" "$d"

d="$(plant src/main.ts 'import { s } from "./test-street/scene";')"
check "a test-street import fails" 1 bash "$CHECK" "$d"

d="$(plant tests/unit/a.test.ts 'import { s } from "../../src/test-street/fixture";')"
check "a test-street import from a test fails" 1 bash "$CHECK" "$d"

d="$(plant src/render/a.ts 'import { r } from "../debug/rush-crowd";')"
check "a crowd import outside debug fails" 1 bash "$CHECK" "$d"

d="$(plant src/main.ts 'const m = await import("./debug/rush-crowd");')"
check "the dynamic crowd import in main.ts passes" 0 bash "$CHECK" "$d"

d="$(plant src/render/a.ts '// the old test-street/ scene is gone')"
check "prose naming test-street is never a false positive" 0 bash "$CHECK" "$d"

check "a missing client directory fails loudly" 1 bash "$CHECK" "/nonexistent-dir-$$"

summary
exit $?
