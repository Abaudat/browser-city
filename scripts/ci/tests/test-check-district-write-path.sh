#!/usr/bin/env bash
# scripts/ci/check-district-write-path.sh's own fast coverage: plants each
# violation in a throwaway tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-district-write-path.sh"

tree() { # -- a clean tree: the declaration, restore and metrics
  local d
  d="$(fake_dir)"
  mkdir -p "$d/tables"
  printf '%s\n' 'use sim::generation::create;
#[spacetimedb::table(accessor = district)]
pub struct District { pub seed: u64 }
#[spacetimedb::reducer]
pub fn create_district(ctx: &ReducerContext) {
    let rows = ctx.db.district().iter();
    ctx.db.district().insert(r);
}' > "$d/tables/district.rs"
  printf '%s\n' 'use super::district::{District, district};
pub fn begin_restore(ctx: &ReducerContext) { if ctx.db.district().iter().next().is_some() {} }
pub fn restore_district(ctx: &ReducerContext) {
    ctx
        .db
        .district()
        .insert(s);
}' > "$d/tables/restore.rs"
  printf '%s\n' 'use super::district::district;
macro_rules! sample { ($a:ident) => {}; }
fn f() { sample!(district); }' > "$d/tables/metrics.rs"
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
check "district.rs, restore.rs and metrics.rs as designed pass" 0 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'fn f(ctx: &ReducerContext) { ctx.db.district().insert(x); }')"
check "another file calling the accessor fails" 1 bash "$CHECK" "$d"
check_contains "names the file" "tables/other.rs" "$(bash "$CHECK" "$d" 2>&1)"

d="$(plant tables/other.rs 'fn f(ctx: &ReducerContext) {
    ctx
        .db
        .district()
        .iter();
}')"
check "the accessor split across lines fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::district::{District, district};')"
check "importing the accessor fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::district::*;')"
check "a glob import fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'let t = super::district::district(&ctx.db);')"
check "a path call fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::district::District;')"
check "importing only the row type passes" 0 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use sim::generation::create;')"
check "naming the generator outside district.rs fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use sim::generated::defs;')"
check "sim::generated is not the generator" 0 bash "$CHECK" "$d"

d="$(plant tables/other.rs '// ctx.db.district().insert(x) is banned
/// use sim::generation::create;')"
check "comments pass" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn regen(ctx: &ReducerContext) { ctx.db.district().insert(x); }' >> "$d/tables/district.rs"
check "a second writer inside district.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn wipe(ctx: &ReducerContext) { ctx.db.district().district_id().delete(1); }' >> "$d/tables/restore.rs"
check "a delete in another restore.rs function fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn sneak(ctx: &ReducerContext) { ctx.db.district().insert(x); }' >> "$d/tables/restore.rs"
check "an insert in another restore.rs function fails" 1 bash "$CHECK" "$d"

d="$(tree)"
sed -i 's/ctx.db.district().insert(r);/ctx.db.district().district_id().update(r);/' "$d/tables/district.rs"
check "an update in district.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
sed -i 's/ctx.db.district().insert(r);/ctx.db.district().district_id().delete(1);/' "$d/tables/district.rs"
check "a delete in district.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'fn sneaky(ctx: &ReducerContext) { ctx.db.district().insert(x); }' >> "$d/tables/metrics.rs"
check "a call in metrics.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
mkdir -p "$d/generated"
printf '%s\n' 'use x::district::district; use sim::generation::y;' > "$d/generated/skip.rs"
check "generated/ is excluded" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s\n' 'pub fn nothing() {}' > "$d/lib.rs"
check "a tree with no district declaration fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn sneaky(ctx: &ReducerContext) { let d = sim::generation::generate(1); }' >> "$d/tables/district.rs"
check "generate called by path inside district.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
sed -i 's/use sim::generation::create;/use sim::generation::{create, plan};/' "$d/tables/district.rs"
check "plan imported inside district.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
sed -i 's/use sim::generation::create;/use sim::generation as g;/' "$d/tables/district.rs"
check "an aliased generation module in district.rs fails" 1 bash "$CHECK" "$d"

d="$(plant lib.rs 'use sim::generation as g;
fn f() { g::generate(1); }')"
check "an aliased generation module elsewhere fails" 1 bash "$CHECK" "$d"

d="$(plant lib.rs 'use sim::{generation as g, rng};')"
check "an aliased generation module in a brace list fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub(in crate::tables) fn wipe(ctx: &ReducerContext) { ctx.db.district().district_id().delete(1); }' >> "$d/tables/restore.rs"
check "a qualified-visibility fn deleting in restore.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'const X: () = { ctx.db.district().iter(); };' >> "$d/tables/restore.rs"
sed -i '1i const Y: () = { ctx.db.district().iter(); };' "$d/tables/restore.rs"
check "a call whose enclosing fn cannot be determined fails" 1 bash "$CHECK" "$d"

check "the real server/src passes" 0 bash "$CHECK"

summary
exit $?
