//! Story 6.2 (FR87): stock is held by a holder and an item alone, and its
//! declared row bound is a formula over the holder ceilings and the line
//! ceiling, recomputed here rather than trusted as a typed number.

use bounds::schema::{module_src_dir, parse_module_schema};
use sim::codes::holder_kind;
use sim::generated::defs;
use sim::generation::GenerationConfig;
use sim::stock::{HOLDER_TABLES, MAX_LINES_PER_HOLDER};
use sim::table_bounds::{TABLE_BOUNDS, max_rows_of};

/// NFR14: launch scale.
const LAUNCH_CITIZENS: u64 = 5_000;
const LAUNCH_SITE: i64 = 512 * 512;
const GROWTH_SITE: i64 = 1024 * 1024;

fn stock_bound() -> &'static sim::table_bounds::TableBound {
    TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "stock")
        .expect("stock has a declared bound")
}

/// The most workplaces (business instances) the generator ever settles on
/// a site of `site_cells`: the band's upper edge, which every seed is held
/// to by `inv_generation_workplace_count_within_tolerance`.
fn workplace_ceiling(site_cells: i64) -> u64 {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).expect("committed balance");
    cfg.workplace_count_band(site_cells).1 as u64
}

#[test]
fn stock_is_keyed_by_holder_and_item_alone() {
    let schema = parse_module_schema(&module_src_dir());
    let table = schema
        .tables
        .iter()
        .find(|t| t.accessor == "stock")
        .expect("a stock table");
    let columns: Vec<(&str, &str)> = table
        .columns
        .iter()
        .map(|c| (c.name.as_str(), c.ty.as_str()))
        .collect();
    assert_eq!(
        columns,
        [
            ("stock_id", "u64"),
            ("holder_kind", "u32"),
            ("holder_id", "u64"),
            ("item_id", "u32"),
            ("quantity", "u64"),
        ],
        "FR87: stock is held by a holder (kind, id) and an item -- not by the room and not by the brand"
    );
    assert!(table.columns[0].primary_key && table.columns[0].auto_inc);
    assert!(table.columns.iter().all(|c| !c.unique));
    let index: Vec<(&str, Vec<&str>)> = table
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
        [(
            "by_holder_item",
            vec!["holder_kind", "holder_id", "item_id"]
        )]
    );
}

#[test]
fn stock_max_rows_is_the_line_ceiling_times_every_holder_table() {
    let holders: u64 = HOLDER_TABLES
        .iter()
        .filter_map(|(_, table)| *table)
        .map(|t| max_rows_of(t).unwrap_or_else(|| panic!("holder table `{t}` has no bound")))
        .sum();
    assert_eq!(
        stock_bound().max_rows,
        MAX_LINES_PER_HOLDER as u64 * holders,
        "stock.max_rows must be MAX_LINES_PER_HOLDER x the max_rows of every holder table"
    );
}

#[test]
fn stock_across_the_settled_district_fits_its_declared_bound() {
    let bound = stock_bound();
    let lines = MAX_LINES_PER_HOLDER as u64;
    let launch = (workplace_ceiling(LAUNCH_SITE) + LAUNCH_CITIZENS) * lines;
    assert!(
        launch <= bound.alert_rows,
        "launch-scale stock {launch} rows is past alert_rows {} -- a healthy city would page the watcher",
        bound.alert_rows
    );
    let growth = (workplace_ceiling(GROWTH_SITE) + max_rows_of("citizen").unwrap()) * lines;
    assert!(
        growth <= bound.max_rows,
        "growth-target stock {growth} rows is past max_rows {}",
        bound.max_rows
    );
}

#[test]
fn every_holder_kind_names_its_table_or_has_none_yet() {
    let schema = parse_module_schema(&module_src_dir());
    for kind in holder_kind::CODES {
        let entry = HOLDER_TABLES
            .iter()
            .find(|(k, _)| *k == kind.code)
            .unwrap_or_else(|| {
                panic!(
                    "holder kind `{}` is missing from sim::stock::HOLDER_TABLES",
                    kind.name
                )
            });
        let real = schema.tables.iter().any(|t| t.accessor == kind.name);
        match entry.1 {
            Some(accessor) => assert!(
                schema.tables.iter().any(|t| t.accessor == accessor),
                "holder kind `{}` names table `{accessor}`, which does not exist",
                kind.name
            ),
            None => assert!(
                !real,
                "holder kind `{}` is marked tableless but a `{}` table now exists -- name it in HOLDER_TABLES so stock's bound counts it",
                kind.name, kind.name
            ),
        }
    }
}
