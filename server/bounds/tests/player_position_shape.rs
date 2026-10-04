//! Story 4.4 (FR138): `player_position` is one public row per character,
//! its shape pinned by name so adding a column fails here rather than
//! relying on a doc comment being read.

use bounds::schema::{module_src_dir, parse_module_schema};
use sim::table_bounds::{TABLE_BOUNDS, max_rows_of};

const WHY: &str = "player_position is the durable, public, per-character position row: nothing \
rides along (no identity, facing, velocity, sequence or online flag -- the receiver derives \
facing from motion and presence is a different write frequency); `chunk_key` exists solely so a \
chunk filter is expressible as a subscription; uniqueness per player is the primary key on \
`character_id`, never write-path discipline";

fn table() -> bounds::schema::TableDef {
    parse_module_schema(&module_src_dir())
        .tables
        .into_iter()
        .find(|t| t.accessor == "player_position")
        .expect("a player_position table")
}

#[test]
fn player_position_is_exactly_the_declared_columns() {
    let t = table();
    let columns: Vec<(&str, &str)> = t
        .columns
        .iter()
        .map(|c| (c.name.as_str(), c.ty.as_str()))
        .collect();
    assert_eq!(
        columns,
        [
            ("character_id", "u64"),
            ("chunk_key", "u64"),
            ("x", "i32"),
            ("y", "i32"),
            ("floor", "i8"),
            ("frac_x", "u8"),
            ("frac_y", "u8"),
            ("updated_at", "Timestamp"),
        ],
        "{WHY}"
    );
}

#[test]
fn player_position_is_keyed_by_character_public_and_chunk_indexed() {
    let t = table();
    let key = &t.columns[0];
    assert!(
        key.primary_key && !key.auto_inc,
        "`character_id` is the primary key and is never auto_inc. {WHY}"
    );
    assert!(
        t.public,
        "clients subscribe to player_position, so it is public"
    );
    assert!(
        t.scheduled_reducer.is_none(),
        "player_position is durable state, never scheduled"
    );
    let chunk = t.columns.iter().find(|c| c.name == "chunk_key").unwrap();
    assert!(chunk.indexed, "`chunk_key` must be btree-indexed. {WHY}");
}

#[test]
fn player_position_bound_equals_the_character_bound() {
    let bound = TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "player_position")
        .expect("player_position has a declared bound");
    assert_eq!(
        Some(bound.max_rows),
        max_rows_of("character"),
        "one row per character, so the ceiling is the character table's"
    );
}
