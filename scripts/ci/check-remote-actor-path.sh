#!/usr/bin/env bash
# A remote player is an actor, placed by the scene's one `placeActor` like the
# local player and the commuter (story 4.5, FR120-FR122, FR124, FR182): the
# remote players layer owns no floor test, no flight offset, no projection, no
# container and no sorting, so it cannot bring back a second placement. A
# mechanical grep, run by `client-check`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the client directory --
# `scripts/ci/tests/test-check-remote-actor-path.sh`'s own use.
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"
FILE="$CLIENT_DIR/src/test-street/remote-players-layer.ts"

[ -f "$FILE" ] || { echo "check-remote-actor-path: $FILE not found" >&2; exit 1; }

HITS="$(grep -nE 'CROWD_FLOOR|worldPointPx|positionSprite|offsetPx|floorOffsetPx|zIndex|sortableChildren|crowdContainer|new Container|\.floor[[:space:]]*===|\.visible[[:space:]]*=[^=]' "$FILE" || true)"
if [ -n "$HITS" ]; then
  echo "check-remote-actor-path: FAIL -- remote-players-layer.ts places, sorts, floor-tests or shows a sprite itself; hand the pose to the scene's ActorHost:" >&2
  echo "$HITS" >&2
  exit 1
fi
echo "check-remote-actor-path: remote players are placed by the scene" >&2
exit 0
