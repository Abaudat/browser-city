//! Regenerates `fixtures/world-conformance.v1.json` from `sim::world::
//! fixture`'s canonical world and hand-typed conformance cases. Run via
//! `cargo run -p bounds --bin regen-world-fixture` after any change to
//! that fixture. `bounds/tests/world_fixture_current.rs` fails CI if the
//! committed file and a fresh run of this binary ever disagree.

use bounds::world_fixture::{build_fixture_document, fixture_path};

fn main() {
    let document = build_fixture_document();
    let path = fixture_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    }
    std::fs::write(&path, document.to_pretty_json())
        .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
    eprintln!("regen-world-fixture: wrote {}", path.display());
}
