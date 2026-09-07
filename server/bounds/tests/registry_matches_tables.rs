//! NFR37: every `#[spacetimedb::table]` in `../src` must be registered in
//! `bounds::TABLE_BOUNDS`, and every registered bound must name a real
//! table. Reads `bounds::schema::parse_module_schema` -- the one parser
//! that scans `../src`, shared with `schema_shape.rs` and
//! `schema_snapshot_current.rs` -- rather than keeping a second, private
//! scanner here: two independent scanners of the same source drift the
//! first time a macro spelling changes, and only one parser can be the one
//! that fails closed on a bare `#[table(...)]` (see `schema.rs`). Lives in
//! this crate (not in `browser_city`'s own tests) because `browser_city`
//! cannot be natively `cargo test`ed -- see `src/lib.rs`.

use bounds::TABLE_BOUNDS;
use bounds::schema::{module_src_dir, parse_module_schema};

fn declared_accessors() -> Vec<String> {
    parse_module_schema(&module_src_dir())
        .tables
        .into_iter()
        .map(|t| t.accessor)
        .collect()
}

#[test]
fn every_table_has_a_declared_bound() {
    let registered: Vec<&str> = TABLE_BOUNDS.iter().map(|b| b.accessor).collect();
    for accessor in declared_accessors() {
        assert!(
            registered.contains(&accessor.as_str()),
            "table `{accessor}` has no bound registered in bounds::TABLE_BOUNDS (NFR37)"
        );
    }
}

#[test]
fn every_registered_bound_has_a_matching_table() {
    let declared = declared_accessors();
    for bound in TABLE_BOUNDS {
        assert!(
            declared.iter().any(|d| d == bound.accessor),
            "bounds::TABLE_BOUNDS registers `{}` but no #[spacetimedb::table] with that accessor exists",
            bound.accessor
        );
    }
}
