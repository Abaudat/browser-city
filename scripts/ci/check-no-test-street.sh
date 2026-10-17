#!/usr/bin/env bash
# Story 3.16: the world the client draws is the generated district, streamed
# from the module. Fails if
#   - `client/src/test-street/` exists, or
#   - any file under client/src/ or client/tests/ imports a `test-street/`
#     path, or
#   - client/src/ (outside `debug/`) imports a rush-crowd or other
#     harness-only crowd module.
# Usage: check-no-test-street.sh [client-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"

[ -d "$CLIENT_DIR" ] || { echo "check-no-test-street: $CLIENT_DIR not found" >&2; exit 1; }
FAIL=0

if [ -e "$CLIENT_DIR/src/test-street" ]; then
  echo "check-no-test-street: FAIL -- $CLIENT_DIR/src/test-street exists; the world is the streamed district" >&2
  FAIL=1
fi

IMPORT='(from|import)[[:space:]]*\(?[[:space:]]*["'"'"'][^"'"'"']*test-street'
HITS="$(grep -rnE "$IMPORT" "$CLIENT_DIR/src" "$CLIENT_DIR/tests" --include='*.ts' --include='*.mjs' 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  echo "check-no-test-street: FAIL -- a test-street/ import:" >&2
  echo "$HITS" >&2
  FAIL=1
fi

CROWD="$(grep -rnE '(from|import)[[:space:]]*\(?[[:space:]]*["'"'"'][^"'"'"']*(rush-crowd|harness/crowd)' "$CLIENT_DIR/src" --include='*.ts' 2>/dev/null \
  | grep -vE '/src/debug/|/src/main\.ts:' || true)"
if [ -n "$CROWD" ]; then
  echo "check-no-test-street: FAIL -- a harness-only crowd module is imported outside debug/ and main.ts:" >&2
  echo "$CROWD" >&2
  FAIL=1
fi

[ "$FAIL" -eq 0 ] || exit 1
echo "check-no-test-street: no test-street directory or import; the crowd stays behind debug/" >&2
