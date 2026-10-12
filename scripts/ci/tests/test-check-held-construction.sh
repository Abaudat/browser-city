#!/usr/bin/env bash
# scripts/ci/check-held-construction.sh's own fast coverage (story 6.10,
# FR95): plants each violation in a throwaway tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-held-construction.sh"

tree() { # -- a clean tree: the declaration, restore and metrics
  local d
  d="$(fake_dir)"
  mkdir -p "$d/tables"
  printf '%s\n' '#[spacetimedb::table(accessor = item_held, public)]
pub struct ItemHeld { pub instance_id: u64 }' > "$d/tables/item_instance.rs"
  printf '%s\n' 'pub fn restore_item_held(ctx: &ReducerContext) { ctx.db.item_held().insert(r); }' > "$d/tables/restore.rs"
  printf '%s\n' 'use super::item_instance::{item_held, item_instance};
fn f() { sample!(item_held); }' > "$d/tables/metrics.rs"
  printf '%s' "$d"
}

plant() { # <file> <content> -- a clean tree plus one more file
  local d
  d="$(tree)"
  mkdir -p "$(dirname "$d/$1")"
  printf '%s\n' "$2" > "$d/$1"
  printf '%s' "$d"
}

d="$(tree)"
check "the declaration, restore and metrics pass" 0 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'fn f() { let h = Held::new(c, (0, 0), 0); }')"
check "building a Held outside restore fails" 1 bash "$CHECK" "$d"
check_contains "names the file" "tables/other.rs" "$(bash "$CHECK" "$d" 2>&1)"

d="$(plant tables/other.rs 'fn f() { let h = sim::item_instance::Held::new(c, (0, 0), 0); }')"
check "a path-qualified Held::new fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'fn f(ctx: &ReducerContext) {
    ctx
        .db
        .item_held()
        .insert(x);
}')"
check "the accessor split across lines fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'let rows = ctx.db.item_held().iter();')"
check "a read through the accessor fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'let t = super::item_instance::item_held(ctx);')"
check "a path call fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::item_instance::{ItemHeld, item_instance};')"
check "importing the row type passes" 0 bash "$CHECK" "$d"

d="$(plant tables/other.rs '// Held::new(c, s, o) is banned
/// ctx.db.item_held().insert(x)')"
check "the construct in a comment passes" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'fn f(ctx: &ReducerContext) { ctx.db.item_held().insert(r); }' >> "$d/tables/metrics.rs"
check "metrics.rs calling the accessor fails" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
mkdir -p "$d/tables"
check "a tree without the declaration fails loudly" 1 bash "$CHECK" "$d"

check "the real server/src passes" 0 bash "$CHECK"

summary
exit $?
