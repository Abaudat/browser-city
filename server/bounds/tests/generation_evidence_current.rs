//! Keeps `docs/generation/*.svg` honest against `sim::generation`'s
//! current output, in the same style as `world_fixture_current.rs`.

use bounds::generation_evidence::{build_all, envelopes_svg_path, land_use_svg_path, streets_svg_path};

fn assert_current(path: std::path::PathBuf, expected: &str) {
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e} -- run `cargo run -p bounds --bin dump-generation` and commit the result",
            path.display()
        )
    });
    assert_eq!(
        committed,
        expected,
        "{} is stale -- run `cargo run -p bounds --bin dump-generation` and commit the result",
        path.display()
    );
}

#[test]
fn generation_evidence_is_current() {
    for svgs in build_all() {
        assert_current(land_use_svg_path(svgs.seed), &svgs.land_use);
        assert_current(streets_svg_path(svgs.seed), &svgs.streets);
        assert_current(envelopes_svg_path(svgs.seed), &svgs.envelopes);
    }
}
