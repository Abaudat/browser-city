#!/usr/bin/env bash
# scripts/ci/check-actor-location-path.sh's own coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-actor-location-path.sh"

plant() { # <relative file> <content> -- a fresh server src with tables/actor.rs and that file
  local d
  d="$(fake_dir)"
  mkdir -p "$d/tables"
  printf '%s\n' 'ctx.db.actor_location().insert(row);' > "$d/tables/actor.rs"
  mkdir -p "$(dirname "$d/$1")"
  printf '%s\n' "$2" >> "$d/$1"
  printf '%s' "$d"
}

d="$(plant tables/restore.rs 'ctx.db.actor_location().iter();')"
check "restore.rs may name the accessor" 0 bash "$CHECK" "$d"

d="$(plant tables/metrics.rs 'ctx.db.actor_location().count();')"
check "metrics.rs may name the accessor" 0 bash "$CHECK" "$d"

d="$(plant tables/citizen.rs '// ctx.db.actor_location().insert(row);')"
check "a comment naming it passes" 0 bash "$CHECK" "$d"

d="$(plant tables/citizen.rs 'ctx.db.actor_location().insert(row);')"
check "a second writer in another table module" 1 bash "$CHECK" "$d"

d="$(plant lib.rs 'ctx.db.actor_location().location_id().update(row);')"
check "a writer in lib.rs" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
check "no tables/actor.rs fails loudly" 1 bash "$CHECK" "$d"

summary
exit $?
