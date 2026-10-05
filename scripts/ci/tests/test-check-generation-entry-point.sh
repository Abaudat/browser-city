#!/usr/bin/env bash
# scripts/ci/check-generation-entry-point.sh's own fast coverage (story
# 3.5 adds pass 6): a hand-chained pass call in a cross-pass harness
# fails unless the line carries the allow marker, and every pass from the
# plot pass on is covered -- the interior pass included.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-generation-entry-point.sh"

# <line> -- a fresh fake git tree whose one test file holds <line>.
plant() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/server/sim/tests"
  printf '%s\n' "$1" > "$d/server/sim/tests/harness.rs"
  (cd "$d" && git init -q . && git add -A >/dev/null 2>&1)
  printf '%s' "$d"
}

d="$(plant 'let d = sim::generation::plan(seed, &cfg, &content);')"
check "a harness that goes through plan passes" 0 bash "$CHECK" "$d"

for which in plots envelopes building_types interiors; do
  d="$(plant "let x = sim::generation::$which::run(seed);")"
  check "a hand-chained $which::run call fails" 1 bash "$CHECK" "$d"
  d="$(plant "let x = sim::generation::$which::run(seed); // generation-entry-point: allow")"
  check "a marked $which::run call passes" 0 bash "$CHECK" "$d"
done

summary
exit $?
