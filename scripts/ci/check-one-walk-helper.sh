#!/usr/bin/env bash
# Scripted e2e walks go through one helper: under client/tests/e2e/ a
# `keyup` KeyboardEvent is constructed only in walk-support.ts (and
# boot-marks.spec.ts, which measures input latency, not a walk), and the
# release lag is given a literal value only in client/src/test-street/
# fixture.ts. A mechanical grep, run by `client-check`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the client directory --
# `scripts/ci/tests/test-check-one-walk-helper.sh`'s own use.
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"
E2E_DIR="$CLIENT_DIR/tests/e2e"

[ -d "$E2E_DIR" ] || { echo "check-one-walk-helper: $E2E_DIR not found" >&2; exit 1; }

FAIL=0

KEYUP="$(grep -rnE "KeyboardEvent[[:space:]]*\([[:space:]]*[\"'\`]keyup" "$E2E_DIR" --include='*.ts' \
  | grep -vE '/(walk-support\.ts|boot-marks\.spec\.ts):' || true)"
if [ -n "$KEYUP" ]; then
  echo "check-one-walk-helper: FAIL -- a keyup is dispatched in the page outside walk-support.ts; walk through its helper instead:" >&2
  echo "$KEYUP" >&2
  FAIL=1
fi

LAG="$(grep -rnE 'releaseLagSteps[[:space:]]*:[[:space:]]*[1-9]' "$CLIENT_DIR/tests" "$CLIENT_DIR/src" --include='*.ts' 2>/dev/null \
  | grep -vE '/src/test-street/fixture\.ts:' || true)"
if [ -n "$LAG" ]; then
  echo "check-one-walk-helper: FAIL -- releaseLagSteps is given a literal outside src/test-street/fixture.ts; import RELEASE_LAG:" >&2
  echo "$LAG" >&2
  FAIL=1
fi

[ "$FAIL" -eq 0 ] || exit 1
echo "check-one-walk-helper: one walk helper, one release-lag bound" >&2
exit 0
