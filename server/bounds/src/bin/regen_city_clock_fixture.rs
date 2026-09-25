//! Regenerates `fixtures/city-clock-conformance.v1.json`. Run via
//! `cargo run -p bounds --bin regen-city-clock-fixture`;
//! `bounds/tests/city_clock_fixture_current.rs` fails CI if the committed
//! file goes stale.

use bounds::city_clock_fixture::{build_fixture_document, fixture_path};

fn main() {
    let path = fixture_path();
    std::fs::write(&path, build_fixture_document().to_pretty_json())
        .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
    eprintln!("regen-city-clock-fixture: wrote {}", path.display());
}
