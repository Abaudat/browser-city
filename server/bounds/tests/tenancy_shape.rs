//! Story 7.1: `tenancy` is one row per dwelling, keyed to its tenant by an
//! `actor_kind` code so a citizen's home is the same row kind, and its
//! bound is the two tenant tables' ceilings together.

use bounds::schema::{TableDef, module_src_dir, parse_module_schema};
use sim::table_bounds::TABLE_BOUNDS;

fn table(accessor: &str) -> TableDef {
    parse_module_schema(&module_src_dir())
        .tables
        .into_iter()
        .find(|t| t.accessor == accessor)
        .unwrap_or_else(|| panic!("no `{accessor}` table"))
}

#[test]
fn tenancy_has_exactly_its_columns() {
    let t = table("tenancy");
    let cols: Vec<(&str, &str)> = t
        .columns
        .iter()
        .map(|c| (c.name.as_str(), c.ty.as_str()))
        .collect();
    assert_eq!(
        cols,
        [
            ("tenancy_id", "u64"),
            ("building_id", "u64"),
            ("tenant_kind", "u32"),
            ("tenant_id", "u64"),
            ("weekly_rent", "u64"),
            ("started_at", "Timestamp"),
        ]
    );
    assert!(t.columns[0].primary_key && t.columns[0].auto_inc);
}

#[test]
fn tenancy_is_private_and_one_per_dwelling() {
    let src = std::fs::read_to_string(module_src_dir().join("tables").join("housing.rs"))
        .unwrap()
        .replace(char::from(13), "");
    assert!(
        src.contains("accessor = tenancy)"),
        "tenancy must not be public"
    );
    assert!(src.contains("#[unique]\n    pub building_id"));
}

#[test]
fn tenancy_bound_covers_every_character_and_every_citizen() {
    let max = |a: &str| {
        TABLE_BOUNDS
            .iter()
            .find(|b| b.accessor == a)
            .unwrap_or_else(|| panic!("no bound for {a}"))
            .max_rows
    };
    assert!(max("tenancy") >= max("citizen") + max("character") / 5);
    assert!(max("tenancy") >= max("citizen"));
}

#[test]
fn dwelling_is_one_row_per_building_and_building_stays_narrow() {
    let d = table("dwelling");
    assert_eq!(d.columns[0].name, "building_id");
    assert!(d.columns[0].primary_key && !d.columns[0].auto_inc);
    let b = table("building");
    let names: Vec<&str> = b.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["building_id", "created_at"]);
    let max = |a: &str| {
        TABLE_BOUNDS
            .iter()
            .find(|x| x.accessor == a)
            .unwrap_or_else(|| panic!("no bound for {a}"))
            .max_rows
    };
    assert!(max("dwelling") <= max("building"));
    // Occupancy is the tenancy rows' alone: no copy of it on the let row.
    assert!(
        d.columns
            .iter()
            .all(|c| !c.name.contains("open") && !c.name.contains("occup")),
        "dwelling carries a copy of whether it is let"
    );
}

#[test]
fn a_tenancy_document_is_keyed_by_its_instance() {
    let t = table("tenancy_document");
    let cols: Vec<(&str, &str)> = t
        .columns
        .iter()
        .map(|c| (c.name.as_str(), c.ty.as_str()))
        .collect();
    assert_eq!(cols, [("instance_id", "u64"), ("tenancy_id", "u64")]);
    assert!(t.columns[0].primary_key);
}
