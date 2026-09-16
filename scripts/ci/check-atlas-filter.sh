#!/usr/bin/env bash
# Keeps ci.yml's `defs:` changes filter (`.github/workflows/ci.yml`) a
# superset of the one directory a packed atlas page ever lands in --
# `tools/defs-build/src/model.rs`'s `ATLAS_PAGES_DIR` (story 2.6). That
# directory is outside `client/**`'s own build inputs (it is a build
# *output* the `defs` job's own check-defs-current.sh regenerates and
# diffs), so a `defs:` filter that does not name it would let a PR that
# only hand-edits a page, or adds/removes one, skip the job that catches
# that -- the same class of drift check-defs-sprite-root-filter.sh already
# guards on the sprite-sheet side.
#
# Usage: check-atlas-filter.sh [model.rs] [ci-workflow]
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL_RS="${1:-$REPO_ROOT/tools/defs-build/src/model.rs}"
CI_WORKFLOW="${2:-$REPO_ROOT/.github/workflows/ci.yml}"

[ -f "$MODEL_RS" ] || { echo "check-atlas-filter: $MODEL_RS not found" >&2; exit 1; }
[ -f "$CI_WORKFLOW" ] || { echo "check-atlas-filter: $CI_WORKFLOW not found" >&2; exit 1; }

DIR="$(grep -oE 'ATLAS_PAGES_DIR: &str = "[^"]*"' "$MODEL_RS" | grep -oE '"[^"]*"$' | tr -d '"')"
if [ -z "$DIR" ]; then
  echo "check-atlas-filter: FAIL -- could not find ATLAS_PAGES_DIR in $MODEL_RS" >&2
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
  echo "check-atlas-filter: FAIL -- no 'defs:' filter found in $CI_WORKFLOW (expected at 12-space indent, inside the changes job's filters: block)" >&2
  exit 1
fi

NEEDED="${DIR}/**"
if ! printf '%s\n' "$DEFS_FILTER" | grep -qF -- "$NEEDED"; then
  echo "check-atlas-filter: FAIL -- $CI_WORKFLOW's own 'defs:' filter does not cover '$NEEDED' ($MODEL_RS's own ATLAS_PAGES_DIR) -- a PR that only edits a packed atlas page would skip the defs job" >&2
  exit 1
fi

echo "check-atlas-filter: ci.yml's defs: filter covers ATLAS_PAGES_DIR ('$DIR')" >&2
exit 0
