//! Regenerates `fixtures/district-pinned.v1.json` from the live city's
//! generator output. Run via `cargo run -p bounds --release --bin
//! regen-district-fixture` after any change to generation code, `defs/` or
//! `GENERATION_VERSION`; `bounds/tests/district_fixture_current.rs` fails CI
//! when the committed file and a fresh run disagree.

use bounds::district_fixture::{build_document, fixture_path};

fn main() {
    let path = fixture_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    }
    std::fs::write(&path, build_document())
        .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
    eprintln!("regen-district-fixture: wrote {}", path.display());
}
