#!/usr/bin/env bash
# Story 15.5 (AC2): which pass an object draws in is read from its layer
# (`render/layer-table.ts`'s `passOfLayer`), never from a client-side list
# of object keys. Fails if, as a quoted string literal in the renderer's own
# source -- `client/src/render/**`, `test-street/scene.ts` and
# `test-street/drawables.ts` -- appears either
#   - any `object` key in `tools/defs-build/goldens/defs-manifest.golden`, or
#   - any `assetKey` value the fixture's rows carry (the manhole and doormat
#     are `assetKey` rows, not defs objects), except the allow-list below.
# `test-street/fixture.ts` is the one legitimate place a key may be typed and
# is not scanned. Quoted matches only, like
# `check-rule-engine-no-content-keys.sh`.
# Usage: check-render-no-content-keys.sh [manifest] [path...]
# Env: BC_RENDER_FIXTURE overrides the fixture path (for the self-test).
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
FIXTURE="${BC_RENDER_FIXTURE:-$REPO_ROOT/client/src/test-street/fixture.ts}"

for f in "$MANIFEST" "$FIXTURE" "${TARGETS[@]}"; do
  [ -e "$f" ] || {
    echo "check-render-no-content-keys: FAIL -- $f not found" >&2
    exit 1
  }
done

# Asset keys the renderer legitimately names, each with its reason:
#   floor     -- the key of the cropped interior-floor texture scene.ts builds
#   sidewalk  -- the raw sheet name the ground pass's textureFor reads
#   wallTile  -- the wall-run swatch picker, keyed on the run, not on a def
ASSET_ALLOW=" floor sidewalk wallTile "

FAILED=0
scan() { # <label> <key>
  local matches
  matches="$(grep -rnE "[\"']$2[\"']" "${TARGETS[@]}" --include='*.ts' 2>/dev/null || true)"
  if [ -n "$matches" ]; then
    echo "check-render-no-content-keys: FAIL -- $1 '$2' appears as a literal in the renderer:" >&2
    echo "$matches" >&2
    FAILED=1
  fi
}

ASSET_KEYS="$(grep -oE 'assetKey: "[A-Za-z0-9_]+"' "$FIXTURE" | sed -E 's/assetKey: "(.*)"/\1/' | sort -u)"
if [ -z "$ASSET_KEYS" ]; then
  echo "check-render-no-content-keys: FAIL -- no assetKey rows parsed out of $FIXTURE" >&2
  exit 1
fi
for key in $ASSET_KEYS; do
  case "$ASSET_ALLOW" in *" $key "*) continue ;; esac
  scan "fixture assetKey" "$key"
done

while IFS=' ' read -r kind _id key; do
  [ "$kind" = "object" ] && [ -n "${key:-}" ] || continue
  scan "object key" "$key"
done < "$MANIFEST"

[ "$FAILED" -eq 0 ] || exit 1
echo "check-render-no-content-keys: no defs/objects key or fixture assetKey appears as a literal in the renderer (story 15.5)" >&2
