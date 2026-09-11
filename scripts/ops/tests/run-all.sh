#!/usr/bin/env bash
# Runs every test-*.sh in this directory (scripts/ops/'s own fast,
# stub-`spacetime` tests -- never agentic-team/scripts/tests/, which
# tests the agent tooling, not game operations, per Tim's direction).
# Exit 1 if any test file failed, 0 only if every one of them passed.
set -u
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

overall=0
for f in "$SCRIPT_DIR"/test-*.sh; do
  [ -e "$f" ] || continue
  echo "=== $(basename "$f") ==="
  bash "$f"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "=== $(basename "$f"): FAIL ==="
    overall=1
  else
    echo "=== $(basename "$f"): PASS ==="
  fi
  echo
done

exit "$overall"
