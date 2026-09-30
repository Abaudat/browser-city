//! Story 6.11 (FR95): an item instance is in one of two stored forms, each
//! its own table with exactly its own columns, and each declared bound is a
//! formula recomputed here rather than trusted as a typed number.

use bounds::schema::{TableDef, module_src_dir, parse_module_schema};
use sim::item_instance::MAX_ITEMS_PER_CONTAINER;
use sim::table_bounds::{TABLE_BOUNDS, max_rows_of};

fn columns(t: &TableDef) -> Vec<(&str, &str)> {
    t.columns
        .iter()
        .map(|c| (c.name.as_str(), c.ty.as_str()))
        .collect()
}

fn table(accessor: &str) -> TableDef {
    parse_module_schema(&module_src_dir())
        .tables
        .into_iter()
        .find(|t| t.accessor == accessor)
        .unwrap_or_else(|| panic!("FR95: no `{accessor}` table"))
}

#[test]
fn the_identity_row_carries_no_placement() {
    let t = table("item_instance");
    assert_eq!(
        columns(&t),
        [
            ("instance_id", "u64"),
            ("def_id", "u32"),
            ("created_at", "Timestamp")
        ],
        "FR95: the identity is an id, a definition and a creation time"
    );
    assert!(t.columns[0].primary_key && t.columns[0].auto_inc);
}

#[test]
fn the_placed_form_has_a_cell_an_offset_and_a_floor_and_no_holder() {
    let t = table("item_placed");
    assert_eq!(
        columns(&t),
        [
            ("instance_id", "u64"),
            ("x", "i32"),
            ("y", "i32"),
            ("floor", "i8"),
            ("offset_x", "u8"),
            ("offset_y", "u8"),
            ("orientation", "u8"),
            ("chunk_key", "u64"),
        ],
        "FR95: a placed item has a world position and physically no holder column"
    );
    assert!(t.columns[0].primary_key && !t.columns[0].auto_inc);
}

#[test]
fn the_held_form_has_a_container_and_a_slot_and_no_world_position() {
    let t = table("item_held");
    assert_eq!(
        columns(&t),
        [
            ("instance_id", "u64"),
            ("container_kind", "u32"),
            ("container_id", "u64"),
            ("slot_x", "u8"),
            ("slot_y", "u8"),
            ("orientation", "u8"),
        ],
        "FR95: a held item has a grid slot and physically no x, y, floor or offset column"
    );
    assert!(t.columns[0].primary_key && !t.columns[0].auto_inc);
    let index: Vec<(&str, Vec<&str>)> = t
        .indexes
        .iter()
        .map(|i| {
            (
                i.accessor.as_str(),
                i.columns.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(
        index,
        [("by_container", vec!["container_kind", "container_id"])]
    );
}

#[test]
fn no_item_table_has_a_parent_or_references_a_placed_object() {
    const BANNED: &[&str] = &[
        "parent",
        "parent_id",
        "parent_kind",
        "container_id_fk",
        "object_id",
        "supported_by",
    ];
    let schema = parse_module_schema(&module_src_dir());
    let items: Vec<&TableDef> = schema
        .tables
        .iter()
        .filter(|t| t.accessor.starts_with("item"))
        .collect();
    assert_eq!(
        items.len(),
        3,
        "FR95: the schema footprint is three item tables -- identity and two forms"
    );
    for t in items {
        for c in &t.columns {
            assert!(
                !BANNED.contains(&c.name.as_str()),
                "FR95: `{}.{}` is a parent relationship",
                t.accessor,
                c.name
            );
            assert!(
                !c.ty.contains("placed_object") && !c.name.contains("placed_object"),
                "FR95: `{}.{}` references placed_object",
                t.accessor,
                c.name
            );
        }
        for i in &t.indexes {
            assert!(
                i.columns.iter().all(|c| !BANNED.contains(&c.as_str()))
                    && !i.accessor.contains("placed_object"),
                "FR95: `{}` index `{}` is a parent relationship",
                t.accessor,
                i.accessor
            );
        }
    }
}

fn bound(accessor: &str) -> &'static sim::table_bounds::TableBound {
    TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == accessor)
        .unwrap_or_else(|| panic!("FR95: `{accessor}` has no declared bound"))
}

#[test]
fn item_held_max_rows_is_the_placed_objects_times_the_per_container_ceiling() {
    assert_eq!(
        bound("item_held").max_rows,
        max_rows_of("placed_object").unwrap() * MAX_ITEMS_PER_CONTAINER,
        "FR95: item_held.max_rows is placed_object.max_rows x MAX_ITEMS_PER_CONTAINER"
    );
}

#[test]
fn item_placed_max_rows_follows_placed_objects_density() {
    assert_eq!(
        bound("item_placed").max_rows,
        max_rows_of("placed_object").unwrap(),
        "FR95: items are placed at the same density bound as objects"
    );
}

#[test]
fn item_instance_max_rows_covers_both_forms() {
    let both = bound("item_placed").max_rows + bound("item_held").max_rows;
    assert!(
        bound("item_instance").max_rows >= both
            && bound("item_instance").max_rows <= both + both / 100,
        "FR95: item_instance.max_rows is the sum of the two forms' (up to 1% headroom)"
    );
}

#[test]
fn container_kind_mirrors_holder_kinds_bound() {
    let (c, h) = (bound("container_kind"), bound("holder_kind"));
    assert_eq!(
        (c.max_rows, c.expected_rows, c.alert_rows),
        (h.max_rows, h.expected_rows, h.alert_rows)
    );
}
