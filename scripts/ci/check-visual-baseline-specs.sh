#!/usr/bin/env bash
# Every client e2e spec that calls `toHaveScreenshot` owns a committed
# baseline directory, and update-visual-baselines.yml is the only thing
# that regenerates those on the CI image. This fails when a spec with a
# screenshot is missing from that workflow's `playwright test` line, from
# its `git add` of `<spec>-snapshots/**`, or from its header comment.
#
# Usage: check-visual-baseline-specs.sh [e2e-dir] [workflow]
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="${1:-$REPO_ROOT/client/tests/e2e}"
WORKFLOW="${2:-$REPO_ROOT/.github/workflows/update-visual-baselines.yml}"

[ -d "$E2E_DIR" ] || { echo "check-visual-baseline-specs: $E2E_DIR not found" >&2; exit 1; }
[ -f "$WORKFLOW" ] || { echo "check-visual-baseline-specs: $WORKFLOW not found" >&2; exit 1; }

PLAYWRIGHT_LINE="$(grep -E 'playwright test' "$WORKFLOW" || true)"
GIT_ADD_LINE="$(grep -E 'git add' "$WORKFLOW" || true)"
HEADER="$(awk '/^on:/ { exit } { print }' "$WORKFLOW")"

status=0
count=0
for spec in "$E2E_DIR"/*.spec.ts; do
  [ -e "$spec" ] || continue
  grep -q 'toHaveScreenshot' "$spec" || continue
  name="$(basename "$spec")"
  count=$((count + 1))
  printf '%s' "$PLAYWRIGHT_LINE" | grep -qF "tests/e2e/$name" || {
    echo "check-visual-baseline-specs: FAIL -- $name calls toHaveScreenshot but is not on $(basename "$WORKFLOW")'s playwright line" >&2
    status=1
  }
  printf '%s' "$GIT_ADD_LINE" | grep -qF "tests/e2e/$name-snapshots/**" || {
    echo "check-visual-baseline-specs: FAIL -- $name calls toHaveScreenshot but its -snapshots/** is not in $(basename "$WORKFLOW")'s git add" >&2
    status=1
  }
  printf '%s' "$HEADER" | grep -qF "$name-snapshots" || {
    echo "check-visual-baseline-specs: FAIL -- $name calls toHaveScreenshot but is not named in $(basename "$WORKFLOW")'s header comment" >&2
    status=1
  }
done

[ "$status" -eq 0 ] && echo "check-visual-baseline-specs: $count spec(s) with a baseline are all wired into $(basename "$WORKFLOW")" >&2
exit "$status"
