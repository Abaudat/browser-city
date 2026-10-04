#!/usr/bin/env bash
# scripts/ci/check-e2e-remote-players-isolation.sh's own fast coverage (story 4.4).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-e2e-remote-players-isolation.sh"

d="$(fake_dir)"
mkdir -p "$d/a.spec.ts-snapshots"
printf '%s\n' 'await page.goto("/");' > "$d/a.spec.ts"
printf '%s\n' 'await page.goto("/?remotePlayers=1");' > "$d/players.spec.ts"
check "a baseline spec that does not opt in passes, a spec with no baseline may" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
mkdir -p "$d/a.spec.ts-snapshots"
printf '%s\n' 'await page.goto("/?remotePlayers=1");' > "$d/a.spec.ts"
check "a baseline spec that opts in fails" 1 bash "$CHECK" "$d"

check "a missing directory fails loudly" 1 bash "$CHECK" "$d/none"

summary
