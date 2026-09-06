#!/usr/bin/env bash
# Runs every test-*.sh in this directory and aggregates the result. Wraps
# nothing external. The one rule: exit 1 if any test file failed, 0 only if
# every one of them passed -- so this is what CI or a pre-push hook calls.
# A file that prints a line starting "SKIP:" and exits 0 (a platform
# requirement it cannot meet here, e.g. test-keepalive.sh on anything but
# Windows) is reported as SKIPPED, not PASS -- still not a failure, but not
# silently conflated with having actually run.
set -u
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

overall=0
for f in "$SCRIPT_DIR"/test-*.sh; do
  [ -e "$f" ] || continue
  echo "=== $(basename "$f") ==="
  tmp="$(mktemp)"
  bash "$f" 2>&1 | tee "$tmp"
  rc="${PIPESTATUS[0]}"
  if [ "$rc" -ne 0 ]; then
    echo "=== $(basename "$f"): FAIL ==="
    overall=1
  elif grep -q '^SKIP:' "$tmp"; then
    echo "=== $(basename "$f"): SKIPPED ==="
  else
    echo "=== $(basename "$f"): PASS ==="
  fi
  rm -f "$tmp"
  echo
done

exit "$overall"
