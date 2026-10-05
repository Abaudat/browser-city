#!/usr/bin/env bash
# `check-layer-table-current.sh` protects two hand-kept mirrors of
# `sim::codes::layer` (`client/src/render/layer-table.ts` and
# `tools/defs-build/src/codes.rs`'s `DEPRECATED_LAYER_NAMES`), but
# the guard itself is only as good as the CI filter that decides whether
# it runs. `client-check`'s own filter never covers `tools/defs-build/**`
# (Quentin's direction, cycle 2: adding it there would re-run the whole
# client suite on every defs-build change instead), so the `defs` job --
# whose own filter does cover `tools/defs-build/**` -- is what has to run
# this guard for a `codes.rs`-only PR to ever see it. This script
# is the mechanical proof that step exists, so a future edit to
# `.github/workflows/ci.yml` cannot silently drop it the way the filter
# gap itself went unnoticed for one whole review cycle.
#
# Usage: check-layer-table-guard-wired.sh [ci.yml path]
#   [ci.yml path]  defaults to .github/workflows/ci.yml at the repo root;
#                   overridden by scripts/ci/tests/
#                   test-check-layer-table-guard-wired.sh's own fixtures
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$REPO_ROOT/.github/workflows/ci.yml}"

[ -f "$WORKFLOW" ] || { echo "check-layer-table-guard-wired: $WORKFLOW not found" >&2; exit 1; }

# The `defs:` job's own body, from its "  defs:" line to (but not
# including) the next top-level "  <other>:" line -- same idiom
# check-deploy-workflow.sh's own job_block uses.
DEFS_BLOCK="$(awk '
  /^  defs:$/ { inblock = 1; print; next }
  inblock && /^  [A-Za-z0-9_-]+:$/ { inblock = 0 }
  inblock { print }
' "$WORKFLOW")"

if [ -z "$DEFS_BLOCK" ]; then
  echo "check-layer-table-guard-wired: FAIL -- no 'defs:' job found in $WORKFLOW" >&2
  exit 1
fi

if ! printf '%s\n' "$DEFS_BLOCK" | grep -qF 'check-layer-table-current.sh'; then
  echo "check-layer-table-guard-wired: FAIL -- the 'defs:' job in $WORKFLOW never runs check-layer-table-current.sh -- a PR that only edits tools/defs-build/src/codes.rs would skip client-check (its filter excludes tools/defs-build/**) and this drift guard would never run at all" >&2
  exit 1
fi

echo "check-layer-table-guard-wired: the 'defs:' job runs check-layer-table-current.sh" >&2
exit 0
