//! Regenerates `docs/generation/*.svg` from `sim::generation`'s own
//! output at the fixed evidence seeds. Run via `cargo run -p bounds --bin
//! dump-generation` after any change to `sim::generation` or `defs/
//! balance/generation.toml`. `bounds/tests/generation_evidence_current.
//! rs` fails CI if the committed files and a fresh run of this binary
//! ever disagree.

use bounds::generation_evidence::{build_all, land_use_svg_path, streets_svg_path};

fn write(path: std::path::PathBuf, content: &str) {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .unwrap_or_else(|e| panic!("cannot create {}: {e}", dir.display()));
    }
    std::fs::write(&path, content)
        .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
    eprintln!("dump-generation: wrote {}", path.display());
}

fn main() {
    for (seed, land_use_svg, streets_svg) in build_all() {
        write(land_use_svg_path(seed), &land_use_svg);
        write(streets_svg_path(seed), &streets_svg);
    }
}
