#!/usr/bin/env bash
# scripts/ci/check-no-runtime-collision-inference.sh's own coverage: a
# throwaway git repo, one planted violation per case.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK_SRC="$REPO_ROOT/scripts/ci/check-no-runtime-collision-inference.sh"

repo() { # -- a clean tree
  local d
  d="$(fake_dir)"
  (
    cd "$d" || exit 1
    git init -q . && git config user.email t@t && git config user.name t
    mkdir -p scripts/ci server/src server/sim/src/generation server/sim/src/world
    cp "$CHECK_SRC" scripts/ci/
    printf '%s\n' 'fn b() { FloorCollision::build(r, &c); }' > server/sim/src/world/collision.rs
    printf '%s\n' 'fn b() { FloorCollision::build(r, &c); walkability::rasterise(r, 0, &p, o); }' > server/sim/src/generation/props.rs
    printf '%s\n' 'fn reducer() { let _ = 1; }' > server/src/lib.rs
    git add -A
  ) >/dev/null 2>&1
  printf '%s' "$d"
}

run() { ( cd "$1" && bash scripts/ci/check-no-runtime-collision-inference.sh ); }

d="$(repo)"
check "a clean tree passes" 0 run "$d"

d="$(repo)"
printf '%s\n' 'fn spawn() { FloorCollision::build(r, &c); }' > "$d/server/sim/src/routing.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a collision grid built outside generation/ and world/ fails" 1 run "$d"
check_contains "names the file" "routing.rs" "$(run "$d" 2>&1)"

d="$(repo)"
printf '%s
' 'fn spawn() { let g = floor_grids(b, &p, o); }' > "$d/server/sim/src/routing.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "the rows-to-grids function outside generation/ and world/ fails" 1 run "$d"

d="$(repo)"
printf '%s
' 'fn repair() { grid.repaint(r, &c); }' > "$d/server/src/lib.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a runtime window repaint passes" 0 run "$d"

d="$(repo)"
printf '%s
' 'fn d() { floor_grids(b, &p, o); }' > "$d/server/sim/src/generation/mod.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "generation/ may build the whole grids" 0 run "$d"

d="$(repo)"
printf '%s\n' 'fn spawn() { walkability::rasterise(b, 0, &p, o); }' > "$d/server/sim/src/routing.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "rasterising placements outside generation/ and world/ fails" 1 run "$d"

d="$(repo)"
printf '%s\n' 'fn v() { walkability::rasterise(b, 0, &p, o); } // collision-inference: allow' > "$d/server/sim/src/validation.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "the allow marker passes" 0 run "$d"

d="$(repo)"
printf '%s\n' 'fn reducer() { props::run(1, &s, &i, &c, &x); }' > "$d/server/src/lib.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a reducer calling the generator's builder fails" 1 run "$d"
check_contains "names the file" "lib.rs" "$(run "$d" 2>&1)"

d="$(repo)"
printf '%s
' 'fn g() { walkability::rasterise(b, 0, &p, o); }' > "$d/server/sim/src/generation/interiors.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a sibling generation module may not rasterise" 1 run "$d"
check_contains "names the file" "interiors.rs" "$(run "$d" 2>&1)"

d="$(repo)"
printf '%s
' 'fn g() { WalkabilityGrid::build(b, &c); }' > "$d/server/sim/src/routing.rs"
( cd "$d" && git add -A ) >/dev/null 2>&1
check "a walkability grid built outside the allowed modules fails" 1 run "$d"

summary
exit $?
