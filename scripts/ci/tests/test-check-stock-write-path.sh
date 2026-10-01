#!/usr/bin/env bash
# scripts/ci/check-stock-write-path.sh's own fast coverage (story 6.3,
# FR89): plants each violation in a throwaway tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-stock-write-path.sh"

tree() { # -- a clean tree: the declaration, restore and metrics
  local d
  d="$(fake_dir)"
  mkdir -p "$d/tables"
  printf '%s\n' '#[spacetimedb::table(accessor = stock)]
pub struct Stock { pub quantity: u64 }' > "$d/tables/stock.rs"
  printf '%s\n' 'use super::stock::{Business, Stock, business, stock};
pub fn begin_restore(ctx: &ReducerContext) { if ctx.db.stock().iter().next().is_some() {} }
pub fn restore_stock(ctx: &ReducerContext) {
    ctx
        .db
        .stock()
        .insert(s);
}' > "$d/tables/restore.rs"
  printf '%s\n' 'use super::stock::{business, stock};' > "$d/tables/metrics.rs"
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
check "stock.rs, restore.rs and metrics.rs naming it pass" 0 bash "$CHECK" "$d"

d="$(plant tables/other.rs '#[spacetimedb::reducer]
pub fn fiat(ctx: &ReducerContext) { ctx.db.stock().insert(Stock { quantity: 9 }); }')"
check "a new reducer using the accessor on one line fails" 1 bash "$CHECK" "$d"
check_contains "names the file" "tables/other.rs" "$(bash "$CHECK" "$d" 2>&1)"

d="$(plant tables/other.rs 'fn f(ctx: &ReducerContext) {
    ctx
        .db
        .stock()
        .insert(x);
}')"
check "the accessor split across lines fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use crate::tables::stock::*;')"
check "a glob import fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use crate::tables::stock::{
    Business,
    stock,
};')"
check "a multi-line brace import fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{Business, stock};')"
check "a single-line brace import fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::stock;')"
check "a direct import fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'let t = super::stock::stock;')"
check "a path use fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'let rows = ctx.db.stock().iter();')"
check "a read through the accessor fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{Business, Stock, business};
fn f() { let _ = stock_total(); }')"
check "importing the row types without the accessor passes" 0 bash "$CHECK" "$d"

d="$(plant tables/other.rs '// ctx.db.stock().insert(x) is banned
/// use super::stock::stock;')"
check "the accessor in a comment passes" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' '#[spacetimedb::reducer]
pub fn move_stock(ctx: &ReducerContext) {}' >> "$d/tables/stock.rs"
check "a reducer attribute inside stock.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'fn f(ctx: &ReducerContext) { ctx.db.stock().insert(x); }' >> "$d/tables/stock.rs"
check "a .stock() call inside stock.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
mkdir -p "$d/generated"
printf '%s\n' 'use x::stock::stock;' > "$d/generated/skip.rs"
check "generated/ is excluded" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s\n' 'pub fn nothing() {}' > "$d/lib.rs"
check "a tree with no stock declaration fails (the scan found nothing)" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{Stock, stock as s};
fn f(ctx: &ReducerContext) { s::stock(&ctx.db).insert(Stock { quantity: 9 }); }')"
check "an aliased accessor fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock as st;
use st::stock as tr;
fn f(ctx: &ReducerContext) { tr::stock(&ctx.db).insert(x); }')"
check "a renamed module path fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{stock as _, Stock};')"
check "an accessor imported as _ fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{stock};')"
check "a sole-brace import fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{stock, Stock};')"
check "the accessor first in a brace list fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock;')"
check "importing the stock module itself fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::{business::x, stock};')"
check "the module inside a nested group fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{stock, Stock};
macro_rules! sample { ($t:ident) => { ctx.db.$t().iter() }; }
fn f() { sample!(stock); }')"
check "a macro with the accessor first in the brace list fails" 1 bash "$CHECK" "$d"

d="$(plant tables/other.rs 'use super::stock::{Business, Stock, business};
use sim::stock::{plan_make, StockLine};
use sim::stock;')"
check "the capitalised types, business and sim::stock pass" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s
' '#[spacetimedb::reducer]
pub fn seed_opening_stock(ctx: &ReducerContext) { ctx.db.stock().insert(x); }' >> "$d/tables/restore.rs"
check "a new reducer appended to restore.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s
' 'fn sneaky(ctx: &ReducerContext) { ctx.db.stock().insert(x); }' >> "$d/tables/metrics.rs"
check "a .stock() call in metrics.rs fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s
' 'use spacetimedb::reducer;
#[reducer]
pub fn r(ctx: &ReducerContext) {}' >> "$d/tables/stock.rs"
check "a bare #[reducer] inside stock.rs fails" 1 bash "$CHECK" "$d"

check "the real server/src passes" 0 bash "$CHECK"

summary
exit $?
