#!/usr/bin/env bash
# scripts/ci/check-one-walk-helper.sh's own coverage: plants each banned
# construct in a throwaway client tree and asserts exit 1, plus the places
# that are allowed, expecting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-one-walk-helper.sh"

plant() { # <relative file> <content> -- a fresh client tree with that one file
  local d
  d="$(fake_dir)"
  mkdir -p "$d/tests/e2e" "$d/src/test-street" "$(dirname "$d/$1")"
  printf '%s\n' "$2" > "$d/$1"
  printf '%s' "$d"
}

KEYUP='window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));'

d="$(plant tests/e2e/walk-watcher.ts "$KEYUP")"
check "a keyup dispatched in walk-watcher.ts passes" 0 bash "$CHECK" "$d"

d="$(plant tests/e2e/boot-marks.spec.ts "$KEYUP")"
check "a keyup dispatched in boot-marks.spec.ts passes" 0 bash "$CHECK" "$d"

d="$(plant tests/e2e/other.spec.ts "$KEYUP")"
check "a keyup dispatched in another spec" 1 bash "$CHECK" "$d"

d="$(plant tests/e2e/other.spec.ts "window.dispatchEvent(new KeyboardEvent('keyup', { code }));")"
check "a keyup with single quotes in another spec" 1 bash "$CHECK" "$d"

d="$(plant tests/e2e/other.spec.ts "window.dispatchEvent(new KeyboardEvent(
  'keyup', { code }));")"
check "a keyup on the line after the constructor in another spec" 1 bash "$CHECK" "$d"

d="$(plant tests/e2e/walk-support.ts "$KEYUP")"
check "a keyup dispatched in walk-support.ts" 1 bash "$CHECK" "$d"

d="$(plant tests/e2e/other.spec.ts 'await walkRealSegment(page, { label: "x", key: "ArrowUp", until: { kind: "floor", value: 1 } });')"
check "a walk call with an inline segment literal" 1 bash "$CHECK" "$d"

d="$(plant tests/e2e/walk-lag.spec.ts 'await walkRealSegment(page, { label: "x", key: "ArrowUp", until: { kind: "floor", value: 1 } });')"
check "an inline segment in walk-lag.spec.ts passes" 0 bash "$CHECK" "$d"

d="$(plant tests/e2e/other.spec.ts 'for (const segment of route) await walkRealSegment(page, segment);')"
check "a walk call over a route is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant tests/e2e/other.spec.ts "await page.keyboard.up('ArrowRight');")"
check "page.keyboard.up is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant src/test-street/fixture.ts 'export const RELEASE_LAG = { stepMs: 100, releaseLagSteps: 1 } as const;')"
check "the literal lag in fixture.ts passes" 0 bash "$CHECK" "$d"

d="$(plant tests/unit/some.test.ts 'simulateStreetWalk(route, { releaseLagSteps: 2 });')"
check "a literal lag in a unit test" 1 bash "$CHECK" "$d"

d="$(plant tests/unit/some.test.ts 'simulateStreetWalk(route, { releaseLagSteps: 0 });')"
check "a zero lag (the ideal) is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant tests/unit/some.test.ts 'simulateStreetWalk(route, { ...RELEASE_LAG, releaseLagSteps: lag });')"
check "a lag passed as a variable is never a false positive" 0 bash "$CHECK" "$d"

check "a missing client directory fails loudly" 1 bash "$CHECK" "$(fake_dir)/missing"

summary
exit $?
