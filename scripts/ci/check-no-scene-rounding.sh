#!/usr/bin/env bash
# Story 15.6: every drawable position snaps to a whole screen pixel through
# `client/src/render/screen-position.ts`'s `snapToScreenPx`, so nothing
# under the scene modules (`world-scene.ts`, `prop-drawables.ts`,
# `actor-placement.ts`, the citizens/remote-players layers, `street-life.ts`)
# may call `Math.round`, `Math.floor` or
# `Math.trunc` itself -- a second rounding there is a sprite that moves in
# whole-world-pixel steps against a world that scrolls in screen pixels.
# A mechanical grep, run by `client-check`, in the style of
# check-no-masks.sh.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# `scripts/ci/tests/test-check-no-scene-rounding.sh`'s own use.
# `client-check` itself always calls this with no argument.
if [ "$#" -gt 0 ]; then
  TARGETS=("$1")
else
  R="$REPO_ROOT/client/src/render"
  TARGETS=("$R/world-scene.ts" "$R/prop-drawables.ts" "$R/actor-placement.ts" "$R/citizens-layer.ts" "$R/remote-players-layer.ts" "$R/street-life.ts")
fi
for t in "${TARGETS[@]}"; do
  [ -e "$t" ] || { echo "check-no-scene-rounding: $t not found" >&2; exit 1; }
done

# A call (the name followed by `(`), never prose naming one in a comment.
PATTERN='\bMath\.(round|floor|trunc)[[:space:]]*\('

MATCHES="$(grep -rnE "$PATTERN" "${TARGETS[@]}" --include='*.ts' 2>/dev/null || true)"

if [ -n "$MATCHES" ]; then
  echo "check-no-scene-rounding: FAIL -- Math.round/floor/trunc in the scene modules of client/src/render/; snap a position with render/screen-position.ts's snapToScreenPx instead:" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "check-no-scene-rounding: no Math.round/floor/trunc in the scene modules of client/src/render/" >&2
exit 0
