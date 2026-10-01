//! Story 6.8 (FR92): a denomination is an item that plays the role of
//! money, declared by a `[[denomination]]` row in `defs/denominations/`.
//! The coins themselves are ordinary five-field `[[item]]` rows.

mod support;

use std::path::{Path, PathBuf};

use support::{build_err, code_tables, read_tree, sheet_dims, valid_dir};

fn assert_denomination_error(category: &str, expected: &str) {
    assert_eq!(build_err(category).to_string(), expected, "{category}");
}

fn build_ok(files: &[(PathBuf, String)]) -> defs_build::BuildOutput {
    defs_build::build(
        files,
        &sheet_dims(),
        &support::object_sheet_bytes(),
        &support::appearance_sheet_bytes(),
        &code_tables(),
        "",
        "test-version",
    )
    .unwrap()
}

#[test]
fn a_face_value_of_zero_is_refused_at_the_value() {
    assert_denomination_error(
        "denomination-face-value-zero",
        "defs/denominations/cash.toml:3:14: denomination 'coin_1' face_value of 0 -- a denomination is worth at least 1",
    );
}

#[test]
fn a_face_value_over_the_cap_is_refused_at_the_value() {
    assert_denomination_error(
        "denomination-face-value-over-cap",
        &format!(
            "defs/denominations/cash.toml:3:14: denomination 'coin_1' face_value 1001 exceeds MAX_FACE_VALUE ({})",
            defs_build::model::MAX_FACE_VALUE
        ),
    );
    assert_eq!(defs_build::model::MAX_FACE_VALUE, 1_000);
}

#[test]
fn a_face_value_of_the_wrong_type_is_refused() {
    assert_denomination_error(
        "denomination-face-value-wrong-type",
        "defs/denominations/cash.toml:3:14: invalid type: string \"one\", expected u32",
    );
}

#[test]
fn a_denomination_naming_no_item_is_refused() {
    assert_denomination_error(
        "denomination-unknown-item",
        "defs/denominations/cash.toml:2:8: denomination names unknown item 'dollar'",
    );
}

#[test]
fn an_item_named_twice_is_refused_at_the_second() {
    assert_denomination_error(
        "denomination-item-twice",
        "defs/denominations/cash.toml:6:8: item 'coin_1' is already a denomination",
    );
}

#[test]
fn a_denomination_not_counted_in_pieces_is_refused() {
    assert_denomination_error(
        "denomination-not-piece",
        "defs/denominations/cash.toml:2:8: denomination 'grain' must be counted in 'piece', not 'gram'",
    );
}

#[test]
fn a_denomination_that_spoils_is_refused() {
    assert_denomination_error(
        "denomination-perishable",
        "defs/denominations/cash.toml:2:8: denomination 'stale' must never spoil: its shelf_life_minutes is not 0",
    );
}

#[test]
fn two_denominations_with_one_face_value_are_refused_at_the_second() {
    assert_denomination_error(
        "denomination-face-value-duplicate",
        "defs/denominations/cash.toml:7:14: denomination 'coin_5' face_value 5 is already item 'coin_1''s",
    );
}

#[test]
fn more_denominations_than_the_cap_are_refused_at_the_first_excess() {
    assert_denomination_error(
        "denominations-over-cap",
        &format!(
            "defs/denominations/cash.toml:66:8: denomination 'tok_17' is number 17, over MAX_DENOMINATIONS ({})",
            defs_build::model::MAX_DENOMINATIONS
        ),
    );
    assert_eq!(defs_build::model::MAX_DENOMINATIONS, 16);
}

/// The caps themselves build: sixteen denominations, the largest at the
/// largest face value.
#[test]
fn denominations_at_both_caps_build() {
    let mut items = String::new();
    let mut dens = String::new();
    for n in 1..=defs_build::model::MAX_DENOMINATIONS as u32 {
        let face = if n == 1 {
            defs_build::model::MAX_FACE_VALUE
        } else {
            n
        };
        items.push_str(&format!(
            "[[item]]\nid = {}\nkey = \"tok_{n}\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = {{ width = 1, height = 1 }}\n\n",
            100 + n
        ));
        dens.push_str(&format!(
            "[[denomination]]\nitem = \"tok_{n}\"\nface_value = {face}\n\n"
        ));
    }
    let mut files = read_tree(&valid_dir());
    files.retain(|(p, _)| p != Path::new("defs/denominations/cash.toml"));
    files.push((PathBuf::from("defs/items/extra.toml"), items));
    files.push((PathBuf::from("defs/denominations/cash.toml"), dens));
    build_ok(&files);
}

/// The money rows reach both artefacts as a separate table, largest face
/// value first, and the item rows stay as they were.
#[test]
fn denominations_reach_both_artefacts_largest_first_beside_unchanged_items() {
    let out = build_ok(&read_tree(&valid_dir()));
    assert!(out.rust.contains(
        "pub const DENOMINATIONS: &[Denomination] = &[\n    Denomination { item_id: 5, face_value: 20 },\n    Denomination { item_id: 6, face_value: 5 },\n    Denomination { item_id: 4, face_value: 1 },\n];"
    ));
    assert!(out.rust.contains(
        "ItemDef { id: 4, key: \"coin_1\", unit: 0, shelf_life_minutes: 0, width: 1, height: 1 }"
    ));
    assert!(out.json.contains(
        "\"denominations\": [\n    { \"item_id\": 5, \"face_value\": 20 },\n    { \"item_id\": 6, \"face_value\": 5 },\n    { \"item_id\": 4, \"face_value\": 1 }\n  ],"
    ));
    assert!(out.rust.contains("pub const MAX_FACE_VALUE: u32 = 1000;"));
    assert!(
        out.rust
            .contains("pub const MAX_DENOMINATIONS: usize = 16;")
    );
    assert!(out.json.contains("\"max_face_value\": 1000,"));
    assert!(out.json.contains("\"max_denominations\": 16,"));
    assert!(out.json.contains("\"denomination_unit\": 0,"));
}

/// No `face_value` ever lands on an item row: being money is not a field of
/// being an item.
#[test]
fn the_item_row_carries_no_face_value() {
    let out = build_ok(&read_tree(&valid_dir()));
    assert!(!out.rust.contains("pub face_value: u32,\n    pub width"));
    assert!(
        !out.json
            .contains("\"shelf_life_minutes\": 0, \"face_value\"")
    );
}

/// A unit table without `piece` is a build failure, not a default.
#[test]
fn a_unit_table_without_piece_fails_the_build() {
    let codes = defs_build::codes::CodeTables::from_entries(&[
        ("layer", "furniture", 2),
        ("layer", "objects", 3),
        ("layer", "walls", 4),
        ("layer", "ground_objects", 7),
        ("unit", "gram", 1),
    ]);
    let files = read_tree(&valid_dir());
    let err = defs_build::build(
        &files,
        &sheet_dims(),
        &support::object_sheet_bytes(),
        &support::appearance_sheet_bytes(),
        &codes,
        "",
        "test-version",
    );
    assert!(err.is_err());
}

/// A denomination row has no id, but its item and its value are pinned: the
/// manifest carries `denomination <face_value> <item key>`, so deleting a
/// row or revaluing a coin moves a line `check-defs-ids-append-only.sh`
/// holds.
#[test]
fn the_manifest_pins_each_denominations_item_and_face_value() {
    let out = build_ok(&read_tree(&valid_dir()));
    let lines: Vec<&str> = out.id_manifest.lines().collect();
    for want in [
        "denomination 1 coin_1",
        "denomination 5 coin_5",
        "denomination 20 note_20",
    ] {
        assert!(lines.contains(&want), "{want} missing from {lines:?}");
    }
}
