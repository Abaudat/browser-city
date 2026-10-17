#!/usr/bin/env bash
# scripts/ci/check-remote-actor-path.sh's own coverage: plants each banned
# construct in a throwaway remote-players-layer.ts and asserts exit 1, plus
# the clean shape, expecting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-remote-actor-path.sh"

plant() { # <content> -- a fresh client tree holding the layer with that content
  local d
  d="$(fake_dir)"
  mkdir -p "$d/src/render"
  printf '%s\n' "$1" > "$d/src/render/remote-players-layer.ts"
  printf '%s' "$d"
}

d="$(plant 'd.handle.place(pose.x, pose.y, pose.floor);')"
check "handing the pose to the host passes" 0 bash "$CHECK" "$d"

d="$(plant 'd.sprite.visible = pose.floor === CROWD_FLOOR;')"
check "a floor test on the crowd floor" 1 bash "$CHECK" "$d"

d="$(plant 'const px = worldPointPx(pose.x, pose.y, pose.floor, t, s, z, 0);')"
check "a projection with a literal offset" 1 bash "$CHECK" "$d"

d="$(plant 'const px = worldPointPx(pose.x, pose.y, pose.floor, t, s, z, flights.offsetPx(a, b, c));')"
check "a projection of its own even with the real offset" 1 bash "$CHECK" "$d"

d="$(plant 'layer.sortableChildren = true;')"
check "a container of its own that sorts" 1 bash "$CHECK" "$d"

d="$(plant 'd.sprite.zIndex = pose.y;')"
check "a sort key of its own" 1 bash "$CHECK" "$d"

plant_scene() { # <content> -- a clean layer plus a scene.ts with that content
  local d
  d="$(plant 'd.handle.place(pose.x, pose.y, pose.floor);')"
  printf '%s
' "$1" > "$d/src/render/world-scene.ts"
  printf '%s' "$d"
}

d="$(plant_scene 'positionSprite(
  sprite,
  fromSortUnits(drawable.x),
  drawable.floor,
  tileSizePx,
  storeyHeightPx,
  assetNudgePx(drawable),
  0,
);')"
check "a prop placed with positionSprite passes" 0 bash "$CHECK" "$d"

d="$(plant_scene 'positionSprite(
  playerSprite,
  walk.x,
  walk.y,
  walk.floor,
  tileSizePx,
  storeyHeightPx,
  0,
  0,
);')"
check "the player's sprite placed with positionSprite" 1 bash "$CHECK" "$d"

d="$(plant_scene 'positionSprite(
  sprite,
  drawX,
  drawY,
  frame.floor,
  tileSizePx,
  storeyHeightPx,
  0,
  flights.offsetPx(drawX, drawY, frame.floor),
);')"
check "an actor placed with positionSprite and a flight offset" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
check "a missing layer file" 1 bash "$CHECK" "$d"

summary
exit $?
