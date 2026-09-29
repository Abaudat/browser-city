//! Story 4.13 (NFR17): every `#[spacetimedb::reducer]` and
//! `#[spacetimedb::procedure]` in `server/src` is assigned exactly one cost
//! class in `sim::reducer_classes::REDUCER_CLASSES`, and nothing is
//! registered that the module does not export. Same shape as
//! `metrics_coverage.rs`, over the same source scanner.

use bounds::schema::{module_src_dir, procedure_names_in, read_rust_files, reducer_names_in};
use sim::reducer_classes::{ALL_CLASSES, REDUCER_CLASSES};

/// Code lines only: a doc comment that names `#[spacetimedb::reducer]` is
/// not a reducer.
fn exported() -> Vec<String> {
    let mut names = Vec::new();
    for (_path, text) in read_rust_files(&module_src_dir()) {
        let code: String = text
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join(
                "
",
            );
        names.extend(reducer_names_in(&code));
        names.extend(procedure_names_in(&code));
    }
    names
}

#[test]
fn every_exported_reducer_and_procedure_has_a_class() {
    let registered: Vec<&str> = REDUCER_CLASSES.iter().map(|(n, _)| *n).collect();
    let names = exported();
    assert!(names.len() > 10, "the source scan found almost nothing");
    for name in names {
        assert!(
            registered.contains(&name.as_str()),
            "`{name}` has no class in sim::reducer_classes::REDUCER_CLASSES (NFR17)"
        );
    }
}

#[test]
fn nothing_unexported_is_registered() {
    let names = exported();
    for (name, _) in REDUCER_CLASSES {
        assert!(
            names.iter().any(|n| n == name),
            "REDUCER_CLASSES registers `{name}`, which the module does not export"
        );
    }
}

#[test]
fn every_export_is_classed_exactly_once() {
    let mut names = exported();
    let mut registered: Vec<String> = REDUCER_CLASSES.iter().map(|(n, _)| n.to_string()).collect();
    names.sort_unstable();
    registered.sort_unstable();
    assert_eq!(names, registered);
}

#[test]
fn the_counter_table_holds_one_row_per_class() {
    let bound = bounds::TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "reducer_class_counter")
        .expect("reducer_class_counter has no bound");
    assert_eq!(bound.max_rows, ALL_CLASSES.len() as u64);
}
