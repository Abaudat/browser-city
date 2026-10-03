#!/usr/bin/env bash
# Scripted e2e walks go through one helper: under client/tests/e2e/ the
# string `keyup` appears only in walk-watcher.ts (and boot-marks.spec.ts,
# which measures input latency, not a walk); a walk call never takes an
# inline segment literal (the route lives in `walkedRoutes()`); and the
# release lag is given a non-zero literal only in client/src/test-street/
# fixture.ts. A mechanical grep, run by `client-check`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the client directory --
# `scripts/ci/tests/test-check-one-walk-helper.sh`'s own use.
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"
E2E_DIR="$CLIENT_DIR/tests/e2e"

[ -d "$E2E_DIR" ] || { echo "check-one-walk-helper: $E2E_DIR not found" >&2; exit 1; }

FAIL=0

KEYUP="$(grep -rnE "[\"'\`]keyup[\"'\`]" "$E2E_DIR" --include='*.ts'   | grep -vE '/(walk-watcher\.ts|boot-marks\.spec\.ts):' || true)"
if [ -n "$KEYUP" ]; then
  echo "check-one-walk-helper: FAIL -- a keyup is named under tests/e2e/ outside walk-watcher.ts; walk through the helper instead:" >&2
  echo "$KEYUP" >&2
  FAIL=1
fi

INLINE="$(grep -rnE 'walk(Real|Synthetic)Segment\([^)]*,[[:space:]]*\{' "$E2E_DIR" --include='*.ts'   | grep -vE '/walk-lag\.spec\.ts:' || true)"
if [ -n "$INLINE" ]; then
  echo "check-one-walk-helper: FAIL -- a walk call takes an inline segment literal; export the route from street-world.ts and register it in walkedRoutes():" >&2
  echo "$INLINE" >&2
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
