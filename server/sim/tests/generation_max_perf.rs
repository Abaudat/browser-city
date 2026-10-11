//! Story 3.6 (Tim's direction): `create_district` runs the whole generator
//! inside one reducer transaction, and pass 7 added the heaviest verdict
//! yet -- the windowed reachability check over every building and street
//! frontage. A regression guard in the `world_walkability_perf.rs` idiom,
//! not a benchmark: `generate` at the largest site the balance range
//! allows (`generation.site_extent_cells`'s own max) finishes within a
//! generous ceiling, and the work it did is the work a district of that
//! size owes -- placements and collision bounded by the site's own area.
//! Run it `--release`.
//!
//! NFR25's "no wall clock" is `sim`'s production-code discipline; this
//! file is a harness measuring its own cost from outside, like
//! `world_walkability_perf.rs`.
#![allow(clippy::disallowed_types)]

use std::time::Instant;

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, generate};

/// Generous: a correct linear pass finishes well inside it, and a
/// quadratic regression at four times the live area does not.
const CEILING_SECS: u64 = 180;

#[test]
fn generate_at_the_balance_max_extent_stays_inside_its_ceiling() {
    let max_extent = defs::BALANCE
        .iter()
        .find(|b| b.key == "generation.site_extent_cells")
        .map(|b| b.max)
        .expect("the site extent balance key") as i32;
    let mut cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    cfg.site_extent_cells = max_extent;
    let content = GenerationContent::committed();

    let t = Instant::now();
    let d = generate(7, &cfg, &content)
        .unwrap_or_else(|e| panic!("the balance max extent must still generate: {e}"));
    let secs = t.elapsed().as_secs();
    assert!(
        secs <= CEILING_SECS,
        "generate at {max_extent} cells took {secs} s, past {CEILING_SECS} s"
    );

    let area = (max_extent as u64) * (max_extent as u64);
    assert!(
        (d.props.props().len() as u64) <= area,
        "{} placements over {area} cells",
        d.props.props().len()
    );
    let fc = d.props.collision(0).expect("floor 0 collision");
    // One bit per cell of the site extent padded two cells a side.
    let bytes = (max_extent as u64 + 4).pow(2).div_ceil(64) * 8;
    assert!(
        fc.dense_storage_bytes() as u64 <= bytes,
        "collision is more than a bit a cell"
    );
}
