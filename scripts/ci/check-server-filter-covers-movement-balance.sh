#!/usr/bin/env bash
# Keeps ci.yml's `server:` changes filter (`.github/workflows/ci.yml`)
# covering `defs/balance/movement.toml` (Quentin's direction, story 2.4):
# `sim::world::walkability`'s doorway-width check reads `movement.player_
# body_width_subcells`/`_height_subcells` from the generated balance seeds,
# never a literal -- a PR that only edits that source balance file, before
# `defs.rs` is regenerated to match, must still run `sim`'s own tests, or
# a changed threshold could land with a stale test result.
#
# Usage: check-server-filter-covers-movement-balance.sh [ci-workflow]
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CI_WORKFLOW="${1:-$REPO_ROOT/.github/workflows/ci.yml}"

[ -f "$CI_WORKFLOW" ] || { echo "check-server-filter-covers-movement-balance: $CI_WORKFLOW not found" >&2; exit 1; }

# --- the `server:` filter's own body, from its "            server:" line
# (dorny/paths-filter's own indent, inside the `changes` job's `filters: |`
# block) to (but not including) the next same-indent filter name ----------
SERVER_FILTER="$(awk '
  /^ {12}server:$/ { inserver = 1; next }
  inserver && /^ {12}[A-Za-z0-9_-]+:$/ { inserver = 0 }
  inserver { print }
' "$CI_WORKFLOW")"

if [ -z "$SERVER_FILTER" ]; then
  echo "check-server-filter-covers-movement-balance: FAIL -- no 'server:' filter found in $CI_WORKFLOW (expected at 12-space indent, inside the changes job's filters: block)" >&2
  exit 1
fi

NEEDED="defs/balance/movement.toml"
if ! printf '%s\n' "$SERVER_FILTER" | grep -qF -- "$NEEDED"; then
  echo "check-server-filter-covers-movement-balance: FAIL -- $CI_WORKFLOW's own 'server:' filter does not cover '$NEEDED' -- a PR that only edits it would skip the job proving sim::world::walkability's doorway threshold" >&2
  exit 1
fi

echo "check-server-filter-covers-movement-balance: ci.yml's server: filter covers '$NEEDED'" >&2
exit 0
