#!/usr/bin/env bash
# Story 6.17 (NFR50): every client property draws from the one seed the
# setup file configures from FAST_CHECK_SEED; nothing may bypass it. Line-
# based; comment lines are ignored.
#   1. The setup file exists and vitest.config.ts lists it under setupFiles.
#   2. `configureGlobal`/`resetConfigureGlobal` appear nowhere under client/
#      outside tests/unit/setup/ (a call with only numRuns drops the seed).
#   3. A file importing fast-check under client/tests, outside
#      tests/unit/setup/, has no `seed` or `path` key (any line: params
#      objects span lines), no `fc.sample(`/`fc.check(`/`fc.statistics(`
#      (they bypass the seed or collapse under it), and no time-limit option
#      (`interruptAfterTimeLimit`, `skipAllAfterTimeLimit`).
#   4. No file under client/tests/e2e imports fast-check (Playwright never
#      loads the setup file).
#
# Usage: check-client-property-seed.sh [client dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT="${1:-$REPO_ROOT/client}"
SETUP_REL="tests/unit/setup/property-seed.ts"

FAILED=0
fail() { echo "check-client-property-seed: FAIL -- $1" >&2; FAILED=1; }

code() { sed 's/\r$//' "$1" | grep -vE '^[[:space:]]*(//|/\*|\*)' || true; }

[ -f "$CLIENT/$SETUP_REL" ] || fail "$SETUP_REL is missing"
if [ -f "$CLIENT/vitest.config.ts" ]; then
  code "$CLIENT/vitest.config.ts" | grep -E 'setupFiles' | grep -qF "$SETUP_REL" \
    || fail "vitest.config.ts does not list $SETUP_REL under setupFiles"
else
  fail "vitest.config.ts is missing"
fi

while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#"$CLIENT"/}"
  case "$rel" in tests/unit/setup/*) continue ;; esac
  if code "$f" | grep -qE '(configureGlobal|resetConfigureGlobal)'; then
    fail "$rel configures fast-check globally -- only $SETUP_REL may"
  fi
  code "$f" | grep -qE "from ['\"]fast-check['\"]|require\(['\"]fast-check['\"]\)" || continue
  case "$rel" in tests/e2e/*) fail "$rel imports fast-check -- Playwright never loads the seed setup" ;; esac
  if code "$f" | grep -qE '\b(seed|path)[[:space:]]*(:|,|\})'; then
    fail "$rel passes a seed or path -- the seed comes from FAST_CHECK_SEED only"
  fi
  if code "$f" | grep -qE 'fc\.(sample|check|statistics)\('; then
    fail "$rel calls fc.sample/fc.check/fc.statistics -- use fc.assert"
  fi
  if code "$f" | grep -qE '(interruptAfterTimeLimit|skipAllAfterTimeLimit)'; then
    fail "$rel uses a time limit -- the cases drawn would depend on the clock"
  fi
done < <(find "$CLIENT/tests" "$CLIENT/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' 2>/dev/null | sort)

[ "$FAILED" -eq 0 ] || exit 1
echo "check-client-property-seed: every client property is seeded by the one setup file (story 6.17)" >&2
exit 0
