#!/usr/bin/env bash
# A remote player is an actor, placed by the scene's one `placeActor` like the
# local player and the commuter (story 4.9, FR120-FR122, FR124, FR182): the
# remote players layer owns no floor test, no flight offset, no projection, no
# container and no sorting, and `world-scene.ts` never calls `positionSprite` (the
# prop placement) on the player's sprite or with a flight offset, so no actor
# has a second placement. A mechanical grep, run by `client-check`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the client directory --
# `scripts/ci/tests/test-check-remote-actor-path.sh`'s own use.
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"
FILE="$CLIENT_DIR/src/render/remote-players-layer.ts"

[ -f "$FILE" ] || { echo "check-remote-actor-path: $FILE not found" >&2; exit 1; }

HITS="$(grep -nE 'CROWD_FLOOR|worldPointPx|positionSprite|offsetPx|floorOffsetPx|zIndex|sortableChildren|crowdContainer|new Container|\.floor[[:space:]]*===|\.visible[[:space:]]*=[^=]' "$FILE" || true)"
if [ -n "$HITS" ]; then
  echo "check-remote-actor-path: FAIL -- remote-players-layer.ts places, sorts, floor-tests or shows a sprite itself; hand the pose to the scene's ActorHost:" >&2
  echo "$HITS" >&2
  exit 1
fi
SCENE="$CLIENT_DIR/src/render/world-scene.ts"
if [ -f "$SCENE" ]; then
  SCENE_HITS="$(grep -Pzo 'positionSprite\([^;]*?(playerSprite|offsetPx|FlightOffsetPx)[^;]*;' "$SCENE" | tr '\0' '\n' || true)"
  if [ -n "$SCENE_HITS" ]; then
    echo "check-remote-actor-path: FAIL -- scene.ts places an actor with positionSprite; go through placeActor:" >&2
    echo "$SCENE_HITS" >&2
    exit 1
  fi
fi
echo "check-remote-actor-path: remote players are placed by the scene" >&2
exit 0
