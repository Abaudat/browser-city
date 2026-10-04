#!/usr/bin/env bash
# Story 4.4: positions are public, durable and drawn, so a spec that owns a
# pixel baseline must never see other tests' players. A DEV build draws no
# remote players unless the page opts in with `?remotePlayers`; a spec that
# owns a `-snapshots` directory must not opt in.
#
# Usage: check-e2e-remote-players-isolation.sh [e2e-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="${1:-"$REPO_ROOT/client/tests/e2e"}"
[ -d "$E2E_DIR" ] || { echo "check-e2e-remote-players-isolation: $E2E_DIR not found" >&2; exit 1; }

status=0
count=0
for dir in "$E2E_DIR"/*.spec.ts-snapshots; do
  [ -d "$dir" ] || continue
  spec="${dir%-snapshots}"
  count=$((count + 1))
  [ -f "$spec" ] || continue
  if grep -q 'remotePlayers' "$spec"; then
    echo "check-e2e-remote-players-isolation: FAIL -- $(basename "$spec") owns a baseline but opts in to remote players" >&2
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "check-e2e-remote-players-isolation: $count baseline spec(s) draw no remote players" >&2
exit "$status"
