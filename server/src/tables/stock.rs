//! Stock and the business instance (FR87). A holder is referenced by two
//! plain columns -- `holder_kind` (a `sim::codes::holder_kind` code) and
//! `holder_id` (the id in that kind's own table); there is no holder
//! table. Stock is never addressed by room, brand or position.
//!
//! At most one `stock` row per (`holder_kind`, `holder_id`, `item_id`); an
//! absent row is zero and no row stores zero. SpacetimeDB has no composite
//! unique constraint, so `sim::stock`'s plans uphold that. Only an authored
//! `sim::stock::Write` may change a quantity (FR89); `scripts/ci/check-stock-
//! write-path.sh` fails any other file under `server/src/` that names the
//! `stock` accessor, and this file carries no reducer.

use spacetimedb::Timestamp;

/// A business instance: one shop, one row -- two cafes of one chain are two
/// rows. Premises and brand arrive as additive columns.
#[derive(Clone)]
#[spacetimedb::table(accessor = business)]
pub struct Business {
    #[primary_key]
    #[auto_inc]
    pub business_id: u64,
    pub created_at: Timestamp,
}

/// One holder's quantity of one item, in the item's own unit (FR86).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock,
    index(accessor = by_holder_item, btree(columns = [holder_kind, holder_id, item_id]))
)]
pub struct Stock {
    #[primary_key]
    #[auto_inc]
    pub stock_id: u64,
    pub holder_kind: u32,
    pub holder_id: u64,
    pub item_id: u32,
    pub quantity: u64,
}
