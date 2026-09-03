#!/usr/bin/env bash
# Runs every test-*.sh in this directory and aggregates the result. Wraps
# nothing external. The one rule: exit 1 if any test file failed, 0 only if
# every one of them passed -- so this is what CI or a pre-push hook calls.
set -u
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

overall=0
for f in "$SCRIPT_DIR"/test-*.sh; do
  [ -e "$f" ] || continue
  echo "=== $(basename "$f") ==="
  if bash "$f"; then
    echo "=== $(basename "$f"): PASS ==="
  else
    echo "=== $(basename "$f"): FAIL ==="
    overall=1
  fi
  echo
done

exit "$overall"
