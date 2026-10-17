//! Keeps `fixtures/district-pinned.v1.json` honest against the generator:
//! the client's unit tests and e2e specs build their world from this file,
//! so a generation, `defs/` or `GENERATION_VERSION` change that did not
//! regenerate it fails here.

use bounds::district_fixture::{build_document, fixture_path};

#[test]
fn district_fixture_is_current() {
    let expected = build_document();
    let path = fixture_path();
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e} -- run `cargo run -p bounds --release --bin regen-district-fixture` and commit the result",
            path.display()
        )
    });
    // A checkout may have converted line endings; the content is what is pinned.
    let committed = committed.replace("\r\n", "\n");
    assert!(
        committed == expected,
        "{} is stale -- run `cargo run -p bounds --release --bin regen-district-fixture` and commit the result",
        path.display()
    );
}
