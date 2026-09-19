//! Keeps `docs/generation/*.svg` honest against `sim::generation`'s
//! current output, in the same style as `world_fixture_current.rs`.

use bounds::generation_evidence::{build_all, land_use_svg_path, streets_svg_path};

#[test]
fn generation_evidence_is_current() {
    for (seed, expected_land_use, expected_streets) in build_all() {
        let land_use_path = land_use_svg_path(seed);
        let committed_land_use = std::fs::read_to_string(&land_use_path).unwrap_or_else(|e| {
            panic!(
                "cannot read {}: {e} -- run `cargo run -p bounds --bin dump-generation` and commit the result",
                land_use_path.display()
            )
        });
        assert_eq!(
            committed_land_use,
            expected_land_use,
            "{} is stale -- run `cargo run -p bounds --bin dump-generation` and commit the result",
            land_use_path.display()
        );

        let streets_path = streets_svg_path(seed);
        let committed_streets = std::fs::read_to_string(&streets_path).unwrap_or_else(|e| {
            panic!(
                "cannot read {}: {e} -- run `cargo run -p bounds --bin dump-generation` and commit the result",
                streets_path.display()
            )
        });
        assert_eq!(
            committed_streets,
            expected_streets,
            "{} is stale -- run `cargo run -p bounds --bin dump-generation` and commit the result",
            streets_path.display()
        );
    }
}
