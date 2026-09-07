//! `migration_v1` plus one appended column with neither a default nor
//! `#[auto_inc]` -- publishing this over a live database already running
//! `migration_v1` must fail loudly rather than silently (story 1.2, AC3's
//! negative half).

use spacetimedb::{ReducerContext, Table};

#[spacetimedb::table(accessor = fixture_row)]
pub struct FixtureRow {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub label: String,
    pub note_count: u32,
}

#[spacetimedb::reducer]
pub fn add_fixture_row(ctx: &ReducerContext, label: String) {
    ctx.db.fixture_row().insert(FixtureRow {
        id: 0,
        label,
        note_count: 0,
    });
}
