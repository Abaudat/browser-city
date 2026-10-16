#!/usr/bin/env bash
# scripts/ci/check-placed-object-path.sh's own coverage (story 7.1).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-placed-object-path.sh"

tree() {
  local d f
  d="$(fake_dir)"
  mkdir -p "$d/tables"
  for f in world district housing restore metrics; do
    printf '%s\n' 'pub fn x(ctx: &ReducerContext) { ctx.db.placed_object().iter(); }' > "$d/tables/$f.rs"
  done
  printf '%s' "$d"
}

d="$(tree)"
check "the declaring file and the three writers pass" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn f(ctx: &ReducerContext) { ctx.db.placed_object().insert(r); }' > "$d/tables/identity.rs"
check "another file naming the accessor fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' '// placed_object() is written elsewhere' > "$d/tables/identity.rs"
check "a comment naming it passes" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
check "a tree with no world.rs fails loudly" 1 bash "$CHECK" "$d"

summary
