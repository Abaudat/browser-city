#!/usr/bin/env bash
# scripts/ci/check-player-position-path.sh's own fast coverage (story 4.4).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-player-position-path.sh"

tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/server/tables" "$d/client/net"
  printf '%s\n' 'pub fn x(ctx: &ReducerContext) { ctx.db.player_position().iter(); }' > "$d/server/tables/player_position.rs"
  printf '%s\n' 'use super::player_position::player_position;' > "$d/server/tables/restore.rs"
  printf '%s\n' 'use super::player_position::player_position;' > "$d/server/tables/metrics.rs"
  printf '%s\n' 'conn.reducers.setPlayerPosition(p);' > "$d/client/net/position-sender.ts"
  printf '%s' "$d"
}

d="$(tree)"
check "the one reducer file, restore, metrics and the sender pass" 0 bash "$CHECK" "$d/server" "$d/client"

d="$(tree)"
printf '%s\n' 'pub fn f(ctx: &ReducerContext) { ctx.db.player_position().iter(); }' > "$d/server/tables/world.rs"
check "another table file naming the accessor fails" 1 bash "$CHECK" "$d/server" "$d/client"

d="$(tree)"
printf '%s\n' '// player_position() is public' > "$d/server/tables/world.rs"
check "a comment naming it passes" 0 bash "$CHECK" "$d/server" "$d/client"

d="$(tree)"
printf '%s\n' 'conn.reducers.setPlayerPosition(p);' > "$d/client/main.ts"
check "the client reducer called outside the sender fails" 1 bash "$CHECK" "$d/server" "$d/client"

d="$(tree)"
rm "$d/client/net/position-sender.ts"
check "a tree with no sender fails loudly" 1 bash "$CHECK" "$d/server" "$d/client"

summary
