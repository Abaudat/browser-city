#!/usr/bin/env bash
# Story 4.4: positions are public, durable and drawn, so a spec must never see
# other tests' players unless it means to. A DEV build draws no remote players
# unless the page opts in with `?remotePlayers`; the opt-in is an allow-list:
# `remotePlayers` appears under client/tests/e2e only in the named specs.
# A shared support file that adds the parameter for every spec, a spec with no
# baseline and a spec with one all fail the same way.
#
# Usage: check-e2e-remote-players-isolation.sh [e2e-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="${1:-"$REPO_ROOT/client/tests/e2e"}"
[ -d "$E2E_DIR" ] || { echo "check-e2e-remote-players-isolation: $E2E_DIR not found" >&2; exit 1; }

# player-position.spec.ts is the story's own proof; street-perf.spec.ts runs
# on its own instance and must hold the subscription every production client
# runs (NFR2).
ALLOWED="player-position.spec.ts street-perf.spec.ts"

status=0
while IFS= read -r f; do
  name="$(basename "$f")"
  case " $ALLOWED " in *" $name "*) continue ;; esac
  echo "check-e2e-remote-players-isolation: FAIL -- $name mentions remotePlayers but is not on the allow-list ($ALLOWED)" >&2
  status=1
done < <(grep -rl 'remotePlayers' "$E2E_DIR" --include='*.ts' --include='*.mjs' | sort || true)

for name in $ALLOWED; do
  if [ -f "$E2E_DIR/$name" ] && ! grep -q 'remotePlayers' "$E2E_DIR/$name"; then
    echo "check-e2e-remote-players-isolation: FAIL -- $name is on the allow-list but never opts in" >&2
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "check-e2e-remote-players-isolation: remotePlayers appears only in: $ALLOWED" >&2
exit "$status"
