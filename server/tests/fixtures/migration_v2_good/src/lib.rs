//! `migration_v1` plus one appended column carrying `#[default(0)]` --
//! publishing this over a live database already running `migration_v1`
//! must succeed (story 1.2, AC3's positive half).

use spacetimedb::{ReducerContext, Table};

#[spacetimedb::table(accessor = fixture_row)]
pub struct FixtureRow {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub label: String,
    #[default(0)]
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
