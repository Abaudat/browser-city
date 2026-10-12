#!/usr/bin/env bash
# Story 3.6 (FR110, FR128): the district's collision is composited once, by
# pass 7 (`sim::generation::props`), and cached on the `PropMap`; nothing
# infers it again at spawn time or at runtime. So, outside
# `generation/props.rs` and `world/` (the map's own modules):
#
#   1. nothing under `server/src/` or `server/sim/src/` builds a collision
#      grid -- `FloorCollision::build(` -- or rasterises placements --
#      `rasterise(` -- unless the line carries the marker
#
#          // collision-inference: allow
#
#      reserved for a verdict over a candidate a caller hands in (the
#      hand-laid-block validator), never over generated placements;
#   2. no reducer path under `server/src/` names the generator's collision
#      builder (`props::run(`, `build_collision(`).
#
# Usage: check-no-runtime-collision-inference.sh [repo-root]
set -euo pipefail
REPO_ROOT="${1:-"$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"}"
cd "$REPO_ROOT"

fail=0

BUILDS="$(
  git ls-files 'server/src/*.rs' 'server/sim/src/*.rs' -z |
    xargs -0 -r grep -nHE '(FloorCollision::build|WalkabilityGrid::build|[^_a-zA-Z]rasterise)\(' |
    grep -vE '^server/sim/src/(generation/props\.rs|world/)' |
    grep -v 'collision-inference: allow' || true
)"
if [ -n "$BUILDS" ]; then
  echo "check-no-runtime-collision-inference: FAIL -- collision is composited once by pass 7 and read from the PropMap; nothing else may build a collision grid or rasterise placements (mark a caller-supplied candidate '// collision-inference: allow'):" >&2
  printf '%s\n' "$BUILDS" >&2
  fail=1
fi

REDUCERS="$(
  git ls-files 'server/src/*.rs' -z |
    xargs -0 -r grep -nHE '(props::run|build_collision)\(' |
    grep -v 'collision-inference: allow' || true
)"
if [ -n "$REDUCERS" ]; then
  echo "check-no-runtime-collision-inference: FAIL -- a reducer path calls the generator's collision builder:" >&2
  printf '%s\n' "$REDUCERS" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "check-no-runtime-collision-inference: collision is built once, by pass 7, and read from the PropMap"
