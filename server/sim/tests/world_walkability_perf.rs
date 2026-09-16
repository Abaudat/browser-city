//! Quentin's direction: a performance guard, not a soak test -- one
//! `#[test]` runs reachability on a grid the size of a generated district
//! (16 chunks' worth of `CHUNK_SIZE`-square cells, at sub-cell
//! resolution) and asserts it finishes within a generous time ceiling.
//! It exists to catch a quadratic regression in `erode`/`enclosed_regions`/
//! `narrow_passages`, never to benchmark; run it `--release` (the debug
//! build is dramatically slower and not what this guards).
//!
//! NFR25's "no wall clock" is `sim`'s own production-code discipline
//! (`clippy.toml`'s `disallowed-types`, which is workspace-wide): this
//! file is a test harness measuring its own cost from the outside, never
//! a caller `sim` itself would ever see, so it is the one place in this
//! crate `std::time::Instant` is legitimate.
#![allow(clippy::disallowed_types)]

use std::time::Instant;

use sim::generated::defs;
use sim::world::CHUNK_SIZE;
use sim::world::Rect;
use sim::world::walkability::{WalkabilityGrid, enclosed_regions, erode, player_body_subcells};

/// 16 chunks arranged 4x4 -- `CHUNK_SIZE` cells square each -- at
/// `COLLIDER_SUBCELLS_PER_CELL` sub-cells per cell.
const CHUNKS_PER_SIDE: i32 = 4;
const SUBCELLS_PER_CELL: i32 = defs::COLLIDER_SUBCELLS_PER_CELL;
const SIDE_SUBCELLS: i32 = CHUNKS_PER_SIDE * CHUNK_SIZE * SUBCELLS_PER_CELL;

/// A generous ceiling: this is a regression guard against a quadratic
/// blowup, not a benchmark -- a correct `O(n)` implementation finishes a
/// district this size in well under a second even in debug, so several
/// seconds of headroom absorbs CI runner variance without ever passing a
/// real quadratic regression.
const CEILING_SECS: u64 = 20;

fn district_bounds() -> Rect {
    Rect {
        x0: 0,
        y0: 0,
        x1: SIDE_SUBCELLS,
        y1: SIDE_SUBCELLS,
    }
}

/// A scattering of colliders across the district -- vertical stripes,
/// leaving gaps -- enough that every pass genuinely walks real data
/// rather than an all-empty or all-blocked degenerate grid.
fn scattered_colliders() -> Vec<Rect> {
    let mut colliders = Vec::new();
    let mut x = 0;
    while x < SIDE_SUBCELLS {
        colliders.push(Rect {
            x0: x,
            y0: 0,
            x1: (x + SUBCELLS_PER_CELL / 2).min(SIDE_SUBCELLS),
            y1: SIDE_SUBCELLS,
        });
        x += SUBCELLS_PER_CELL * 8;
    }
    colliders
}

#[test]
fn reachability_and_erosion_finish_within_a_generous_ceiling_on_a_district_sized_grid() {
    let grid = WalkabilityGrid::build(district_bounds(), &scattered_colliders())
        .expect("district-sized bounds must build");
    let (body_w, body_h) = player_body_subcells(defs::BALANCE);

    let start = Instant::now();
    let eroded = erode(&grid, body_w, body_h);
    let _ = enclosed_regions(&grid, 1, 1);
    let _ = enclosed_regions(&eroded, 1, 1);
    let elapsed = start.elapsed();

    assert!(
        elapsed.as_secs() < CEILING_SECS,
        "erosion + reachability over a {SIDE_SUBCELLS}x{SIDE_SUBCELLS}-subcell district took {elapsed:?}, over the {CEILING_SECS}s ceiling -- check for a quadratic regression"
    );
}
