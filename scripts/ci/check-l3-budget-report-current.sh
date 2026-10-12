#!/usr/bin/env bash
# Story 5.4: docs/spikes/5.4-l3-frame-budget.md must be exactly
# scripts/dev/generate-l3-budget-report.mjs's output over the committed raw
# JSON (docs/spikes/5.4-l3-frame-budget/*.json) -- the same idiom as
# check-boot-budget-report-current.sh. Needs only `node`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW_DIR="$REPO_ROOT/docs/spikes/5.4-l3-frame-budget"
COMMITTED="$REPO_ROOT/docs/spikes/5.4-l3-frame-budget.md"
GENERATOR="$REPO_ROOT/scripts/dev/generate-l3-budget-report.mjs"

for f in "$RAW_DIR/l3-budget.json" "$RAW_DIR/pre-fix.json" "$RAW_DIR/divergence.json" "$COMMITTED" "$GENERATOR"; do
  [ -f "$f" ] || {
    echo "check-l3-budget-report-current: $f not found" >&2
    exit 1
  }
done
command -v node >/dev/null 2>&1 || {
  echo "check-l3-budget-report-current: 'node' is not on PATH" >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REGENERATED="$WORK/report.md"

node "$GENERATOR" --raw-dir "$RAW_DIR" --out "$REGENERATED" >&2 || {
  echo "check-l3-budget-report-current: 'generate-l3-budget-report.mjs' failed" >&2
  exit 1
}

if ! diff -u "$REGENERATED" "$COMMITTED" >&2; then
  echo "check-l3-budget-report-current: FAIL -- $COMMITTED is stale -- run 'node scripts/dev/generate-l3-budget-report.mjs --raw-dir docs/spikes/5.4-l3-frame-budget --out docs/spikes/5.4-l3-frame-budget.md' and commit the result" >&2
  exit 1
fi

echo "check-l3-budget-report-current: docs/spikes/5.4-l3-frame-budget.md matches the generator's own output" >&2
