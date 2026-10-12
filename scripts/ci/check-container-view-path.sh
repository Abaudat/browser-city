#!/usr/bin/env bash
# Story 6.10 (FR94): a container's view is a piece of the world, drawn by one
# module and parented to one place. Under client/src/:
#
#   - `new PixiContainerView(` appears only in render/pixi-container-view.ts
#     (the module that constructs the view's display objects), so no other
#     code draws a container's cells.
#   - `.attachTransient(` appears only in render/pixi-container-view.ts and
#     is declared in render/floor-stacks.ts: a transient view is attached to
#     its object's own floor stack, never to the stage or a screen-space
#     layer, and nothing else attaches one.
#
# Comment lines are skipped. A mechanical grep, run by `client-check`.
# Usage: check-container-view-path.sh [client-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"
SRC="$CLIENT_DIR/src"
[ -d "$SRC" ] || { echo "check-container-view-path: $SRC not found" >&2; exit 1; }

BAD=""
scan() { # <pattern> <allowed file> <what>
  local hit file text rel
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    file="${hit%%:*}"
    rel="${file#./}"
    text="$(printf '%s' "${hit#*:}" | sed -E 's/^[0-9]+:[[:space:]]*//')"
    case "$text" in //*|\**|/\**) continue ;; esac
    [ "$rel" = "$2" ] && continue
    BAD+="$rel: $3"$'\n'
  done < <(cd "$SRC" && grep -rnE "$1" . --include='*.ts' || true)
}

scan 'new[[:space:]]+PixiContainerView[[:space:]]*\(' "render/pixi-container-view.ts" "constructs a PixiContainerView outside render/pixi-container-view.ts"
scan '\.attachTransient[[:space:]]*\(' "render/pixi-container-view.ts" "attaches a transient view outside render/pixi-container-view.ts"

if [ -n "$BAD" ]; then
  echo "check-container-view-path: FAIL -- a container view is built and attached by render/pixi-container-view.ts alone:" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-container-view-path: one module builds and attaches a container view" >&2
