#!/usr/bin/env bash
# Stories 3.6 and 3.8 (FR110, FR128, FR135): the district's walkability is
# rasterised once, by generation (`District::new`); nothing infers it again
# at spawn time or at runtime. So:
#
#   1. a whole-grid build -- `FloorCollision::build(`, `floor_grids(` -- is
#      reachable only from `server/sim/src/generation/` and `world/`;
#      runtime code may only `FloorCollision::repaint` a window;
#   2. only `generation/props.rs` and `world/` rasterise placements --
#      `rasterise(` -- unless the line carries the marker
#
#          // collision-inference: allow
#
#      reserved for a verdict over a candidate a caller hands in (the
#      hand-laid-block validator), never over generated placements;
#   3. no reducer path under `server/src/` names the generator's grid
#      builder (`props::run(`, `floor_grids(`, `District::new(`).
#
# Usage: check-no-runtime-collision-inference.sh [repo-root]
set -euo pipefail
REPO_ROOT="${1:-"$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"}"
cd "$REPO_ROOT"

fail=0

# A whole-grid build is reachable only from generation/ (and world/, which
# defines it): runtime code under server/src/ may only repaint a window.
GRIDS="$(
  git ls-files 'server/src/*.rs' 'server/sim/src/*.rs' -z |
    xargs -0 -r grep -nHE '(FloorCollision::build|[^_a-zA-Z]floor_grids)\(' |
    grep -vE '^server/sim/src/(generation|world)/' |
    grep -v 'collision-inference: allow' || true
)"
if [ -n "$GRIDS" ]; then
  echo "check-no-runtime-collision-inference: FAIL -- a whole-grid build is reachable only from generation/; runtime code may only FloorCollision::repaint a window:" >&2
  printf '%s
' "$GRIDS" >&2
  fail=1
fi

BUILDS="$(
  git ls-files 'server/src/*.rs' 'server/sim/src/*.rs' -z |
    xargs -0 -r grep -nHE '(WalkabilityGrid::build|[^_a-zA-Z]rasterise)\(' |
    grep -vE '^server/sim/src/(generation/props\.rs|world/)' |
    grep -v 'collision-inference: allow' || true
)"
if [ -n "$BUILDS" ]; then
  echo "check-no-runtime-collision-inference: FAIL -- nothing but pass 7 and world/ may rasterise placements (mark a caller-supplied candidate '// collision-inference: allow'):" >&2
  printf '%s
' "$BUILDS" >&2
  fail=1
fi

REDUCERS="$(
  git ls-files 'server/src/*.rs' -z |
    xargs -0 -r grep -nHE '(props::run|floor_grids|District::new)\(' |
    grep -v 'collision-inference: allow' || true
)"
if [ -n "$REDUCERS" ]; then
  echo "check-no-runtime-collision-inference: FAIL -- a reducer path calls the generator's grid builder:" >&2
  printf '%s
' "$REDUCERS" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "check-no-runtime-collision-inference: walkability is built once, by generation, and only repainted at runtime"
