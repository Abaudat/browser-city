#!/usr/bin/env bash
# "Generated, never hand-written" (architecture.md) is a rule that can be
# made mechanical, so this makes it mechanical: regenerates
# client/src/net/bindings from the module that is actually in `server/`
# and fails on any diff. Drift between the module's schema and the
# committed bindings is exactly the bug story 1.1 can leave behind for
# every later story to trip over.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
BINDINGS_DIR="$REPO_ROOT/client/src/net/bindings"

[ -d "$BINDINGS_DIR" ] || {
  echo "check-bindings-current: $BINDINGS_DIR not found" >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -r "$BINDINGS_DIR" "$WORK/committed"

if ! spacetime generate --lang typescript --out-dir "$BINDINGS_DIR" --module-path "$REPO_ROOT/server" >&2; then
  echo "check-bindings-current: 'spacetime generate' failed" >&2
  exit 1
fi

if ! diff -rq "$WORK/committed" "$BINDINGS_DIR" >&2; then
  echo "check-bindings-current: FAIL -- client/src/net/bindings is stale; run the generate command above and commit the result" >&2
  exit 1
fi

echo "check-bindings-current: committed bindings match the module" >&2
exit 0
