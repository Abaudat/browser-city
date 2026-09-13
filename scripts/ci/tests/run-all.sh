#!/usr/bin/env bash
# Runs every test-*.sh in this directory (scripts/ci/'s own fast,
# no-toolchain-needed tests for its mechanical guards). Exit 1 if any test
# file failed, 0 only if every one of them passed.
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
