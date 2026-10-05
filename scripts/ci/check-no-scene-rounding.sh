#!/usr/bin/env bash
# Story 15.6: every drawable position snaps to a whole screen pixel through
# `client/src/render/screen-position.ts`'s `snapToScreenPx`, so nothing
# under client/src/test-street/ may call `Math.round`, `Math.floor` or
# `Math.trunc` itself -- a second rounding there is a sprite that moves in
# whole-world-pixel steps against a world that scrolls in screen pixels.
# A mechanical grep, run by `client-check`, in the style of
# check-no-masks.sh.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# `scripts/ci/tests/test-check-no-scene-rounding.sh`'s own use.
# `client-check` itself always calls this with no argument.
SRC_DIR="${1:-"$REPO_ROOT/client/src/test-street"}"

[ -d "$SRC_DIR" ] || { echo "check-no-scene-rounding: $SRC_DIR not found" >&2; exit 1; }

# A call (the name followed by `(`), never prose naming one in a comment.
PATTERN='\bMath\.(round|floor|trunc)[[:space:]]*\('

MATCHES="$(grep -rnE "$PATTERN" "$SRC_DIR" --include='*.ts' 2>/dev/null || true)"

if [ -n "$MATCHES" ]; then
  echo "check-no-scene-rounding: FAIL -- Math.round/floor/trunc under client/src/test-street/; snap a position with render/screen-position.ts's snapToScreenPx instead:" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "check-no-scene-rounding: no Math.round/floor/trunc under client/src/test-street/" >&2
exit 0
