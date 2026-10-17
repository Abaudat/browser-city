#!/usr/bin/env bash
# A trace-matrix row is a promise a test keeps. A change that swaps a
# fixture must not drop the promise with it: every requirement cell the base
# matrix holds is either still in the head matrix (its first 48 characters
# match a row) or named on a line carrying `retired:` and the story that
# retired it. A row that vanishes silently fails.
#
# Usage: check-trace-matrix-retired.sh <base-matrix> [head-matrix]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${1:-}"
HEAD_FILE="${2:-$REPO_ROOT/docs/trace-matrix.md}"
[ -f "$BASE" ] || { echo "check-trace-matrix-retired: usage: $0 <base-matrix> [head-matrix]" >&2; exit 1; }
[ -f "$HEAD_FILE" ] || { echo "check-trace-matrix-retired: $HEAD_FILE not found" >&2; exit 1; }

key() { # first cell of a table row, trimmed, first 48 chars
  local row="${1#|}"
  row="${row%%|*}"
  row="$(printf '%s' "$row" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  printf '%s' "${row:0:48}"
}

HEAD_KEYS="$(grep '^|' "$HEAD_FILE" | tr -d '\r' | while IFS= read -r l; do key "$l"; printf '\n'; done)"
RETIRED="$(grep -F 'retired:' "$HEAD_FILE" | tr -d '\r' || true)"

FAILED=0
while IFS= read -r l; do
  [ -n "$l" ] || continue
  k="$(key "$l")"
  case "$k" in ''|'Requirement'|'Invariant id'|---*) continue ;; esac
  if grep -qxF -- "$k" <<< "$HEAD_KEYS"; then continue; fi
  if [ -n "$RETIRED" ] && grep -qF -- "$k" <<< "$RETIRED"; then continue; fi
  echo "check-trace-matrix-retired: FAIL -- the row '$k...' left the matrix with no \`retired:\` line naming the story that retired it" >&2
  FAILED=1
done < <(grep '^|' "$BASE" | tr -d '\r')

[ "$FAILED" -eq 0 ] || exit 1
echo "check-trace-matrix-retired: every base row is still a row or is named as retired" >&2
