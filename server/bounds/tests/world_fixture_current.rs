//! Keeps `fixtures/world-conformance.v1.json` honest against
//! `sim::world::fixture`'s current source, in the same style as
//! `schema_snapshot_current.rs` keeps the schema snapshot honest.

use bounds::world_fixture::{build_fixture_document, fixture_path};

#[test]
fn world_fixture_is_current() {
    let expected = build_fixture_document().to_pretty_json();

    let path = fixture_path();
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e} -- run `cargo run -p bounds --bin regen-world-fixture` and commit the result",
            path.display()
        )
    });

    assert_eq!(
        committed,
        expected,
        "{} is stale -- run `cargo run -p bounds --bin regen-world-fixture` and commit the result",
        path.display()
    );
}
