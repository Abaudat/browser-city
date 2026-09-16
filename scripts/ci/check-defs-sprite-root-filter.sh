#!/usr/bin/env bash
# Keeps ci.yml's `defs:` changes filter (`.github/workflows/ci.yml`) a
# superset of the one root an object's `sprite.sheet` (or an appearance
# part's `sheet`) may ever name -- `tools/defs-build/src/model.rs`'s
# `SPRITE_SHEET_ALLOWED_ROOT` (Quentin's direction, cycle 1). A `defs:`
# filter narrower than that root would let a PR that only swaps a vendor
# PNG somewhere under it skip the job that re-validates every sprite
# rect's own `IHDR` bounds -- exactly the same class of drift
# `check-deploy-client-paths-current.sh` guards on the client side.
#
# Usage: check-defs-sprite-root-filter.sh [model.rs] [ci-workflow]
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL_RS="${1:-$REPO_ROOT/tools/defs-build/src/model.rs}"
CI_WORKFLOW="${2:-$REPO_ROOT/.github/workflows/ci.yml}"

[ -f "$MODEL_RS" ] || { echo "check-defs-sprite-root-filter: $MODEL_RS not found" >&2; exit 1; }
[ -f "$CI_WORKFLOW" ] || { echo "check-defs-sprite-root-filter: $CI_WORKFLOW not found" >&2; exit 1; }

ROOT="$(grep -oE 'SPRITE_SHEET_ALLOWED_ROOT: &str = "[^"]*"' "$MODEL_RS" | grep -oE '"[^"]*"$' | tr -d '"')"
if [ -z "$ROOT" ]; then
  echo "check-defs-sprite-root-filter: FAIL -- could not find SPRITE_SHEET_ALLOWED_ROOT in $MODEL_RS" >&2
  exit 1
fi

# --- the `defs:` filter's own body, from its "            defs:" line
# (dorny/paths-filter's own indent, inside the `changes` job's `filters: |`
# block) to (but not including) the next same-indent filter name ----------
DEFS_FILTER="$(awk '
  /^ {12}defs:$/ { indefs = 1; next }
  indefs && /^ {12}[A-Za-z0-9_-]+:$/ { indefs = 0 }
  indefs { print }
' "$CI_WORKFLOW")"

if [ -z "$DEFS_FILTER" ]; then
  echo "check-defs-sprite-root-filter: FAIL -- no 'defs:' filter found in $CI_WORKFLOW (expected at 12-space indent, inside the changes job's filters: block)" >&2
  exit 1
fi

NEEDED="${ROOT}**"
if ! printf '%s\n' "$DEFS_FILTER" | grep -qF -- "$NEEDED"; then
  echo "check-defs-sprite-root-filter: FAIL -- $CI_WORKFLOW's own 'defs:' filter does not cover '$NEEDED' ($MODEL_RS's own SPRITE_SHEET_ALLOWED_ROOT) -- a PR that only swaps a vendor PNG under that root would skip the defs job" >&2
  exit 1
fi

echo "check-defs-sprite-root-filter: ci.yml's defs: filter covers SPRITE_SHEET_ALLOWED_ROOT ('$ROOT')" >&2
exit 0
