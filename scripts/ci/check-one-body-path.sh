#!/usr/bin/env bash
# A character's texture is chosen in one place (NFR24): under client/src/ the
# composite-frames lookup `.frame(` and a character's `.texture =` are named
# only in render/body-sprite.ts (and render/appearance/, which owns the
# frames). The local player, remote players and citizens draw through it. A
# mechanical grep, run by `client-check`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the client directory --
# `scripts/ci/tests/test-check-one-body-path.sh`'s own use.
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"
SRC="$CLIENT_DIR/src"

[ -d "$SRC" ] || { echo "check-one-body-path: $SRC not found" >&2; exit 1; }

HITS="$(grep -rnE '\.frame\(|[A-Za-z_]*[sS]prite\.texture[[:space:]]*=[^=]' "$SRC" --include='*.ts' \
  | grep -vE '/render/(body-sprite\.ts|appearance/)' || true)"
if [ -n "$HITS" ]; then
  echo "check-one-body-path: FAIL -- a character's frame or sprite texture is chosen outside render/body-sprite.ts; use bodyTexture/newBodySprite/setBodyFrame:" >&2
  echo "$HITS" >&2
  exit 1
fi
echo "check-one-body-path: one body path" >&2
exit 0
