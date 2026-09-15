#!/usr/bin/env bash
# Story 1.14, cycle 2 (Quentin's/Tim's direction): "never a hand
# reduction" made mechanical, the same idiom as check-defs-current.sh.
# docs/spikes/1.14-boot-budget.md must be exactly
# scripts/dev/generate-boot-budget-report.mjs's own output over the
# committed raw JSON and run metadata (docs/spikes/1.14-boot-budget/*.json,
# run-metadata.json) -- regenerates into a scratch file and diffs against
# the committed report, failing on any drift. Needs only `node`: the
# generator and the pure modules it imports
# (client/tests/e2e/boot-budget/{reduce,profiles}.mjs) have no npm
# dependency of their own, so this never needs `npm ci`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW_DIR="$REPO_ROOT/docs/spikes/1.14-boot-budget"
METADATA="$RAW_DIR/run-metadata.json"
COMMITTED="$REPO_ROOT/docs/spikes/1.14-boot-budget.md"
GENERATOR="$REPO_ROOT/scripts/dev/generate-boot-budget-report.mjs"

for f in "$METADATA" "$COMMITTED" "$GENERATOR"; do
  [ -f "$f" ] || {
    echo "check-boot-budget-report-current: $f not found" >&2
    exit 1
  }
done

command -v node >/dev/null 2>&1 || {
  echo "check-boot-budget-report-current: 'node' is not on PATH" >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REGENERATED="$WORK/report.md"

if ! node "$GENERATOR" --raw-dir "$RAW_DIR" --out "$REGENERATED" --metadata "$METADATA" >&2; then
  echo "check-boot-budget-report-current: 'generate-boot-budget-report.mjs' failed" >&2
  exit 1
fi

if ! diff -u "$REGENERATED" "$COMMITTED" >&2; then
  echo "check-boot-budget-report-current: FAIL -- $COMMITTED is stale -- run 'node scripts/dev/generate-boot-budget-report.mjs --raw-dir docs/spikes/1.14-boot-budget --out docs/spikes/1.14-boot-budget.md --metadata docs/spikes/1.14-boot-budget/run-metadata.json' and commit the result" >&2
  exit 1
fi

echo "check-boot-budget-report-current: docs/spikes/1.14-boot-budget.md matches the generator's own output" >&2
exit 0
