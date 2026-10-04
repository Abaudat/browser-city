#!/usr/bin/env bash
# scripts/ci/check-e2e-remote-players-isolation.sh's own fast coverage (story 4.4).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-e2e-remote-players-isolation.sh"

tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/a.spec.ts-snapshots"
  printf '%s\n' 'await page.goto("/");' > "$d/a.spec.ts"
  printf '%s\n' 'await page.goto("/");' > "$d/b.spec.ts"
  printf '%s\n' 'await page.goto("/?remotePlayers=1");' > "$d/player-position.spec.ts"
  printf '%s\n' 'await page.goto("/?remotePlayers=1");' > "$d/street-perf.spec.ts"
  printf '%s' "$d"
}

d="$(tree)"
check "only the two named specs opting in passes" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'export const URL = "/?remotePlayers=1";' > "$d/walk-support.ts"
check "a shared support file adding the parameter fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'await page.goto("/?remotePlayers=1");' > "$d/b.spec.ts"
check "a spec with no baseline opting in fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'await page.goto("/?remotePlayers=1");' > "$d/a.spec.ts"
check "a baseline spec opting in fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'await page.goto("/");' > "$d/street-perf.spec.ts"
check "an allow-listed spec that no longer opts in fails" 1 bash "$CHECK" "$d"

check "a missing directory fails loudly" 1 bash "$CHECK" "$d/none"

summary
