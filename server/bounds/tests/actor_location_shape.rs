//! Story 4.3 (FR136, FR58): `actor_location` is a chunk-keyed index of
//! where actors stand, and its shape is pinned by name so adding a column
//! fails here rather than relying on a doc comment being read.

use bounds::schema::{module_src_dir, parse_module_schema};
use sim::actor_location::ACTOR_TABLES;
use sim::codes::actor_kind;
use sim::table_bounds::{TABLE_BOUNDS, max_rows_of};

const WHY: &str = "`chunk_key` exists solely so a chunk filter is expressible as a subscription \
(a derived value cannot be subscribed to); no x or y is ever added to actor_location -- \
position at cell grain belongs to a per-actor table joined through actor_id";

fn table() -> bounds::schema::TableDef {
    parse_module_schema(&module_src_dir())
        .tables
        .into_iter()
        .find(|t| t.accessor == "actor_location")
        .expect("an actor_location table")
}

#[test]
fn actor_location_is_exactly_actor_kind_actor_chunk_and_floor() {
    let t = table();
    let columns: Vec<(&str, &str)> = t
        .columns
        .iter()
        .map(|c| (c.name.as_str(), c.ty.as_str()))
        .collect();
    assert_eq!(
        columns,
        [
            ("location_id", "u64"),
            ("actor_kind", "u32"),
            ("actor_id", "u64"),
            ("chunk_key", "u64"),
            ("floor", "i8"),
        ],
        "{WHY}"
    );
    assert!(t.columns[0].primary_key && t.columns[0].auto_inc);
    assert!(t.columns.iter().all(|c| !c.unique));
}

#[test]
fn actor_location_is_public_and_indexes_chunk_and_actor() {
    let t = table();
    assert!(
        t.public,
        "actor_location is subscribed to by clients, so it is public"
    );
    for name in ["chunk_key", "actor_id"] {
        let c = t.columns.iter().find(|c| c.name == name).unwrap();
        assert!(c.indexed, "`{name}` must be btree-indexed. {WHY}");
    }
}

#[test]
fn every_actor_kind_names_an_existing_table() {
    let schema = parse_module_schema(&module_src_dir());
    // A character carries its own chunk on `player_position`, so it never
    // has an `actor_location` row; its kind code stays minted.
    for kind in actor_kind::CODES
        .iter()
        .filter(|k| k.code != actor_kind::CHARACTER)
    {
        let entry = ACTOR_TABLES
            .iter()
            .find(|(k, _)| *k == kind.code)
            .unwrap_or_else(|| panic!("actor kind `{}` is missing from ACTOR_TABLES", kind.name));
        assert!(
            schema.tables.iter().any(|t| t.accessor == entry.1),
            "actor kind `{}` names table `{}`, which does not exist",
            kind.name,
            entry.1
        );
    }
}

#[test]
fn a_character_is_never_located_through_actor_location() {
    assert!(
        ACTOR_TABLES
            .iter()
            .all(|(k, _)| *k != actor_kind::CHARACTER),
        "a character's chunk is `player_position.chunk_key`; one fact, one row, one write"
    );
}

#[test]
fn actor_location_max_rows_is_the_sum_of_every_actor_table() {
    let actors: u64 = ACTOR_TABLES
        .iter()
        .map(|(_, t)| max_rows_of(t).unwrap_or_else(|| panic!("`{t}` has no bound")))
        .sum();
    let bound = TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "actor_location")
        .expect("actor_location has a declared bound");
    assert_eq!(
        bound.max_rows, actors,
        "actor_location.max_rows {} must equal the sum of every actor table's max_rows ({actors})",
        bound.max_rows
    );
}

#[test]
fn the_region_tables_are_public() {
    let schema = parse_module_schema(&module_src_dir());
    for name in [
        "placed_object",
        "floor_transition",
        "building_area",
        "room_area",
    ] {
        let t = schema.tables.iter().find(|t| t.accessor == name).unwrap();
        assert!(
            t.public,
            "`{name}` is read by the client's region subscription"
        );
        assert!(
            t.columns.iter().any(|c| c.name == "chunk_key" && c.indexed),
            "`{name}` needs an indexed chunk_key to be subscribed per chunk"
        );
    }
}
