//! Layer two of NFR33's guard: `server/schema.snapshot.json` is the
//! committed, normalised pin of every table's shape -- primary key, unique
//! constraints, scheduled status. `scripts/ci/check-schema-additive.sh`
//! diffs it against the PR's merge base; this test only keeps it honest
//! against the *current* source, in the same style as
//! `check-bindings-current.sh` keeps the client bindings honest.

use bounds::schema::{module_dir, module_src_dir, parse_module_schema};

#[test]
fn schema_snapshot_is_current() {
    let schema = parse_module_schema(&module_src_dir());
    let expected = schema.to_pretty_json();

    let snapshot_path = module_dir().join("schema.snapshot.json");
    let committed = std::fs::read_to_string(&snapshot_path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e} -- run `cargo run -p bounds --bin regen-schema-snapshot` and commit the result",
            snapshot_path.display()
        )
    });

    assert_eq!(
        committed,
        expected,
        "{} is stale -- run `cargo run -p bounds --bin regen-schema-snapshot` and commit the result",
        snapshot_path.display()
    );
}
