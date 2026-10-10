#!/usr/bin/env bash
# scripts/ci/check-generation-entry-point.sh's own coverage: a throwaway git
# repo, one planted violation per case.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK_SRC="$REPO_ROOT/scripts/ci/check-generation-entry-point.sh"

repo() { # -- a clean tree
  local d
  d="$(fake_dir)"
  (
    cd "$d" || exit 1
    git init -q . && git config user.email t@t && git config user.name t
    mkdir -p scripts/ci server/sim/src/generation server/sim/tests server/bounds
    cp "$CHECK_SRC" scripts/ci/
    printf '%s\n' 'fn f(rng: &mut Rng) -> u64 { rng.below(4) }' > server/sim/src/generation/plots.rs
    printf '%s\n' 'fn t() { plan(1); }' > server/sim/tests/a.rs
    git add -A
  ) >/dev/null 2>&1
  printf '%s' "$d"
}

run() { ( cd "$1" && bash scripts/ci/check-generation-entry-point.sh ); }

d="$(repo)"
check "a clean tree passes" 0 run "$d"

d="$(repo)"
printf '%s\n' 'fn g(rng: &mut Rng) -> u64 { rng.next_u64() % 4 }' > "$d/server/sim/src/generation/streets.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a raw next_u64 under generation/ fails" 1 run "$d"
check_contains "names the file" "streets.rs" "$(run "$d" 2>&1)"

d="$(repo)"
printf '%s\n' 'fn t() { plots::run(1); }' > "$d/server/sim/tests/b.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a hand-chained pass in a harness fails" 1 run "$d"

d="$(repo)"
printf '%s\n' 'fn t() { plots::run(1); } // generation-entry-point: allow' > "$d/server/sim/tests/b.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "the allow marker passes" 0 run "$d"

d="$(repo)"
printf '%s\n' 'fn t() { interiors::run(1); }' > "$d/server/bounds/c.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a hand-chained pass 6 in a harness fails" 1 run "$d"
check_contains "names the file" "c.rs" "$(run "$d" 2>&1)"

d="$(repo)"
printf '%s\n' 'fn t() { interiors::run(1); } // generation-entry-point: allow' > "$d/server/bounds/c.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "the allow marker passes pass 6 too" 0 run "$d"

d="$(repo)"
printf '%s\n' 'fn t(rng: &mut Rng) { rng.next_u64(); }' > "$d/server/sim/tests/c.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "next_u64 outside generation/ passes" 0 run "$d"

summary
exit $?
