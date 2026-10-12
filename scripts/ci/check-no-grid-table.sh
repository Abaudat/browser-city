#!/usr/bin/env bash
# Story 3.8 (FR135): the walkability grid is derived, never stored or sent.
# No table or column in `server/schema.snapshot.json` is named for a
# collision or walkability grid.
#
# Usage: check-no-grid-table.sh [snapshot]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SNAPSHOT="${1:-"$REPO_ROOT/server/schema.snapshot.json"}"

HITS="$(grep -inE '"(accessor|struct_name|name)": *"[^"]*(collision|walkab)' "$SNAPSHOT" || true)"
if [ -n "$HITS" ]; then
  echo "check-no-grid-table: FAIL -- a table or column stores or sends a collision/walkability grid (FR135: the grid is derived, never stored):" >&2
  printf '%s\n' "$HITS" >&2
  exit 1
fi
echo "check-no-grid-table: no table or column carries a grid"
