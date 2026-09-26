#!/usr/bin/env bash
# Story 15.5 (AC2): which pass an object draws in is read from its layer
# (`render/layer-table.ts`'s `passOfLayer`), never from a client-side list
# of object keys. Fails if any `object` key in `tools/defs-build/goldens/
# defs-manifest.golden` appears as a quoted string literal in the
# renderer's own source -- `client/src/render/**`, `test-street/scene.ts`
# and `test-street/drawables.ts`. `test-street/fixture.ts` is the one
# legitimate place a key may be typed and is not scanned. Quoted matches
# only, like `check-rule-engine-no-content-keys.sh`.
# Usage: check-render-no-content-keys.sh [manifest] [path...]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

MANIFEST="${1:-"$REPO_ROOT/tools/defs-build/goldens/defs-manifest.golden"}"
if [ "$#" -gt 1 ]; then
  shift
  TARGETS=("$@")
else
  TARGETS=(
    "$REPO_ROOT/client/src/render"
    "$REPO_ROOT/client/src/test-street/scene.ts"
    "$REPO_ROOT/client/src/test-street/drawables.ts"
  )
fi

[ -f "$MANIFEST" ] || {
  echo "check-render-no-content-keys: $MANIFEST not found" >&2
  exit 1
}
for t in "${TARGETS[@]}"; do
  [ -e "$t" ] || {
    echo "check-render-no-content-keys: FAIL -- $t not found" >&2
    exit 1
  }
done

FAILED=0
while IFS=' ' read -r kind _id key; do
  [ "$kind" = "object" ] && [ -n "${key:-}" ] || continue
  PATTERN="[\"']${key}[\"']"
  MATCHES="$(grep -rnE "$PATTERN" "${TARGETS[@]}" --include='*.ts' 2>/dev/null || true)"
  if [ -n "$MATCHES" ]; then
    echo "check-render-no-content-keys: FAIL -- object key '$key' appears as a literal in the renderer:" >&2
    echo "$MATCHES" >&2
    FAILED=1
  fi
done < "$MANIFEST"

[ "$FAILED" -eq 0 ] || exit 1
echo "check-render-no-content-keys: no defs/objects key appears as a literal in the renderer (story 15.5)" >&2
