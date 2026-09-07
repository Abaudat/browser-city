//! The "before" schema `scripts/ci/check-live-migration.sh` publishes
//! first, before republishing either `migration_v2_good` or
//! `migration_v2_bad` over the same live database (story 1.2, AC3).

use spacetimedb::{ReducerContext, Table};

#[spacetimedb::table(accessor = fixture_row)]
pub struct FixtureRow {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub label: String,
}

#[spacetimedb::reducer]
pub fn add_fixture_row(ctx: &ReducerContext, label: String) {
    ctx.db.fixture_row().insert(FixtureRow { id: 0, label });
}
