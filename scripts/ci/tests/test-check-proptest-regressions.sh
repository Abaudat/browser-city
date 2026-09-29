#!/usr/bin/env bash
# scripts/ci/check-proptest-regressions.sh's own coverage, over throwaway
# git repos.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-proptest-regressions.sh"

# repo <ignore-line|-> <track|untracked> -- a fake repo with one regressions file.
repo() {
  local d; d="$(fake_dir)"
  mkdir -p "$d/server/sim/tests"
  printf 'cc 00 # shrinks to seed = 1\n' > "$d/server/sim/tests/invariants.proptest-regressions"
  ( cd "$d" && git init -q . && git config user.email t@t && git config user.name t
    [ "$1" = "-" ] || printf '%s\n' "$1" > .gitignore
    if [ "$2" = "track" ]; then git add -f . && git commit -qm x; fi ) >/dev/null 2>&1
  printf '%s' "$d"
}

check "the real repo passes" 0 bash "$CHECK"
check "tracked and not ignored passes" 0 bash "$CHECK" "$(repo - track)"
check "an untracked file fails" 1 bash "$CHECK" "$(repo - untracked)"
check "an ignore rule fails" 1 bash "$CHECK" "$(repo '*.proptest-regressions' track)"

summary
exit $?
