#!/usr/bin/env bash
# scripts/ci/check-character-identity-path.sh's own fast coverage (story 4.5).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-character-identity-path.sh"

tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/tables"
  printf '%s\n' 'pub fn x(ctx: &ReducerContext) { ctx.db.character_identity().iter(); }' > "$d/tables/identity.rs"
  printf '%s\n' 'use super::identity::character_identity;' > "$d/tables/restore.rs"
  printf '%s\n' 'use super::identity::character_identity;' > "$d/tables/metrics.rs"
  printf '%s' "$d"
}

d="$(tree)"
check "identity, restore and metrics naming it pass" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn f(ctx: &ReducerContext) { ctx.db.character_identity().iter(); }' > "$d/tables/world.rs"
check "another table file naming the accessor fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'use crate::tables::identity::character_identity;' > "$d/lib.rs"
check "lib.rs importing the accessor fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' '// character_identity is private' > "$d/tables/world.rs"
check "a comment naming it passes" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
check "a tree with no identity.rs fails loudly" 1 bash "$CHECK" "$d"

summary
