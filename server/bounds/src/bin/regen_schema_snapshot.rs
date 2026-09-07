//! Regenerates `server/schema.snapshot.json` from `../src`'s current
//! source. Run via `scripts/dev/regen-schema-snapshot.sh` (or `cargo run -p
//! bounds --bin regen-schema-snapshot`) after any change to a
//! `#[spacetimedb::table]`. `bounds/tests/schema_snapshot_current.rs` fails
//! CI if the committed file and a fresh run of this binary ever disagree.

use bounds::schema::{module_dir, module_src_dir, parse_module_schema};

fn main() {
    let schema = parse_module_schema(&module_src_dir());
    let path = module_dir().join("schema.snapshot.json");
    std::fs::write(&path, schema.to_pretty_json())
        .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
    eprintln!("regen-schema-snapshot: wrote {}", path.display());
}
