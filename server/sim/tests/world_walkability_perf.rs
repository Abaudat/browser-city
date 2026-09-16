//! Quentin's direction: a performance guard, not a soak test -- one
//! `#[test]` runs `erode`, `enclosed_regions` *and* `narrow_passages`
//! (Epic 3's generator will call all three) on a grid the size of a
//! generated district (16 chunks' worth of `CHUNK_SIZE`-square cells, at
//! sub-cell resolution) and asserts it finishes within a generous time
//! ceiling. It also asserts a known, non-trivial finding count for each
//! function -- worked out by hand against this file's own fixed
//! geometry, never by calling the code under test -- so a regression that
//! returns early (an empty `Vec` "passing" by doing nothing) is still
//! caught. Run it `--release` (the debug build is dramatically slower and
//! not what this guards).
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
use sim::world::walkability::{
    Finding, WalkabilityGrid, enclosed_regions, erode, narrow_passages, player_body_subcells,
};

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

/// Vertical, full-height stripes -- every one of them touches both the
/// north and south window edges, so `enclosed_regions` must report none
/// of them (the edge exemption), never a wall of false positives.
const STRIPE_PERIOD: i32 = SUBCELLS_PER_CELL * 8;
const STRIPE_WIDTH: i32 = SUBCELLS_PER_CELL / 2;

fn stripe_colliders() -> Vec<Rect> {
    let mut colliders = Vec::new();
    let mut x = 0;
    while x < SIDE_SUBCELLS {
        colliders.push(Rect {
            x0: x,
            y0: 0,
            x1: (x + STRIPE_WIDTH).min(SIDE_SUBCELLS),
            y1: SIDE_SUBCELLS,
        });
        x += STRIPE_PERIOD;
    }
    colliders
}

/// Five small, fully sealed boxes (no door at all), one per stripe lane,
/// each with a known `16x16`-sub-cell interior -- `enclosed_regions`'s
/// own known, non-trivial finding count.
const SEALED_BOX_COUNT: i32 = 5;
const SEALED_BOX_INTERIOR: i32 = SUBCELLS_PER_CELL;
const SEALED_BOX_Y0: i32 = SIDE_SUBCELLS / 2;

fn sealed_box_colliders() -> Vec<Rect> {
    let mut colliders = Vec::new();
    let inner = SEALED_BOX_INTERIOR;
    for i in 0..SEALED_BOX_COUNT {
        // 40 sub-cells into the lane following stripe i -- clear of the
        // stripe itself (STRIPE_WIDTH=8) and of the next one (the lane is
        // STRIPE_PERIOD - STRIPE_WIDTH = 120 sub-cells wide).
        let x0 = STRIPE_PERIOD * i + 40;
        let y0 = SEALED_BOX_Y0;
        colliders.push(Rect {
            x0,
            y0,
            x1: x0 + inner + 2,
            y1: y0 + 1,
        }); // north wall
        colliders.push(Rect {
            x0,
            y0: y0 + inner + 1,
            x1: x0 + inner + 2,
            y1: y0 + inner + 2,
        }); // south wall
        colliders.push(Rect {
            x0,
            y0: y0 + 1,
            x1: x0 + 1,
            y1: y0 + inner + 1,
        }); // west wall
        colliders.push(Rect {
            x0: x0 + inner + 1,
            y0: y0 + 1,
            x1: x0 + inner + 2,
            y1: y0 + inner + 1,
        }); // east wall
    }
    colliders
}

fn expected_sealed_box_findings() -> Vec<Finding> {
    let inner = SEALED_BOX_INTERIOR;
    let mut findings: Vec<Finding> = (0..SEALED_BOX_COUNT)
        .map(|i| {
            let x0 = STRIPE_PERIOD * i + 40 + 1;
            let y0 = SEALED_BOX_Y0 + 1;
            Finding {
                bounds: Rect {
                    x0,
                    y0,
                    x1: x0 + inner,
                    y1: y0 + inner,
                },
                cell_count: (inner as u64) * (inner as u64),
            }
        })
        .collect();
    findings.sort_by_key(|f| (f.bounds.y0, f.bounds.x0));
    findings
}

/// One small room, in the lane right after the *second* stripe, reached
/// through a north doorway split by a full-row-height pillar into two
/// 6-sub-cell gaps -- each narrower than the real player body's own
/// width (8), and (unlike a partial-height obstruction) leaving no
/// row within the doorway a body could sneak through at any height, so
/// the interior's own valid erosion origins start cleanly at the room's
/// own north wall, no partial "bridge" rows to account for.
const ROOM_X0: i32 = STRIPE_PERIOD * 7 + 20; // well clear of stripes 7 and 8
/// In the same lane as the room (lane 7), a few sub-cells clear of
/// stripe 7's own east face (`x=904`) and well clear of the room itself
/// (`x=916`) -- the seed must share the room's own raw component, or
/// `narrow_passages` would never see it at all.
const SEED: (i32, i32) = (ROOM_X0 - 6, 1);
const ROOM_Y0: i32 = SIDE_SUBCELLS / 2;
const ROOM_INTERIOR: i32 = 64; // 4 cells
const ROOM_WALL: i32 = SUBCELLS_PER_CELL;
const ROOM_DOOR_WIDTH: i32 = SUBCELLS_PER_CELL;
const ROOM_PILLAR_WIDTH: i32 = 4;

fn room_colliders() -> Vec<Rect> {
    let outer_x0 = ROOM_X0;
    let outer_y0 = ROOM_Y0;
    let outer_x1 = ROOM_X0 + ROOM_WALL + ROOM_INTERIOR + ROOM_WALL;
    let outer_y1 = ROOM_Y0 + ROOM_WALL + ROOM_INTERIOR + ROOM_WALL;
    let interior_x0 = outer_x0 + ROOM_WALL;
    let door_x0 = interior_x0 + (ROOM_INTERIOR - ROOM_DOOR_WIDTH) / 2;
    let door_x1 = door_x0 + ROOM_DOOR_WIDTH;
    let pillar_x0 = door_x0 + (ROOM_DOOR_WIDTH - ROOM_PILLAR_WIDTH) / 2;
    let pillar_x1 = pillar_x0 + ROOM_PILLAR_WIDTH;
    vec![
        // North wall, split by the door, plus the door's own full-height pillar.
        Rect {
            x0: outer_x0,
            y0: outer_y0,
            x1: door_x0,
            y1: outer_y0 + ROOM_WALL,
        },
        Rect {
            x0: door_x1,
            y0: outer_y0,
            x1: outer_x1,
            y1: outer_y0 + ROOM_WALL,
        },
        Rect {
            x0: pillar_x0,
            y0: outer_y0,
            x1: pillar_x1,
            y1: outer_y0 + ROOM_WALL,
        },
        // South wall.
        Rect {
            x0: outer_x0,
            y0: outer_y1 - ROOM_WALL,
            x1: outer_x1,
            y1: outer_y1,
        },
        // West wall.
        Rect {
            x0: outer_x0,
            y0: outer_y0,
            x1: outer_x0 + ROOM_WALL,
            y1: outer_y1,
        },
        // East wall.
        Rect {
            x0: outer_x1 - ROOM_WALL,
            y0: outer_y0,
            x1: outer_x1,
            y1: outer_y1,
        },
    ]
}

/// The room interior's own eroded (`player_body_subcells`) component,
/// worked out by hand: the door row is blocked for every `x` (both
/// sub-gaps the pillar leaves are 6 sub-cells wide, under the body's own
/// width of 8), so the interior's valid origins start exactly at its own
/// north wall's inner face and run to its own south/east walls, a plain
/// rect with no partial "bridge" rows -- `(body_w, body_h)` are always
/// `(8, 4)` in the real, committed balance today; this fixture would need
/// re-deriving if that balance value ever changed.
fn expected_room_finding(body_w: i32, body_h: i32) -> Finding {
    let interior_x0 = ROOM_X0 + ROOM_WALL;
    let interior_y0 = ROOM_Y0 + ROOM_WALL;
    let interior_x1 = interior_x0 + ROOM_INTERIOR;
    let interior_y1 = interior_y0 + ROOM_INTERIOR;
    // Valid origins: x in [interior_x0, interior_x1 - body_w] (inclusive),
    // same for y -- the `Finding`'s own bounds are the *cells* (origins)
    // that earned a label, half-open, so the max valid origin's own
    // exclusive upper bound is one past it.
    let max_x = interior_x1 - body_w;
    let max_y = interior_y1 - body_h;
    let valid_w = (max_x - interior_x0 + 1) as u64;
    let valid_h = (max_y - interior_y0 + 1) as u64;
    Finding {
        bounds: Rect {
            x0: interior_x0,
            y0: interior_y0,
            x1: max_x + 1,
            y1: max_y + 1,
        },
        cell_count: valid_w * valid_h,
    }
}

#[test]
fn reachability_erosion_and_narrow_passages_finish_within_a_generous_ceiling_on_a_district_sized_grid()
 {
    let mut colliders = stripe_colliders();
    colliders.extend(sealed_box_colliders());
    colliders.extend(room_colliders());
    let grid = WalkabilityGrid::build(district_bounds(), &colliders)
        .expect("district-sized bounds must build");
    let (body_w, body_h) = player_body_subcells(defs::BALANCE);

    let start = Instant::now();
    let eroded = erode(&grid, body_w, body_h);
    let enclosed = enclosed_regions(&grid, SEED.0, SEED.1).unwrap();
    let narrow = narrow_passages(&grid, SEED.0, SEED.1, body_w, body_h).unwrap();
    let elapsed = start.elapsed();

    assert!(
        elapsed.as_secs() < CEILING_SECS,
        "erode + enclosed_regions + narrow_passages over a {SIDE_SUBCELLS}x{SIDE_SUBCELLS}-subcell district took {elapsed:?}, over the {CEILING_SECS}s ceiling -- check for a quadratic regression"
    );
    // Every stripe touches the north and south window edges: none of
    // them is reported, only the five sealed boxes -- a regression that
    // dropped the edge exemption (a wall of false positives) or one that
    // returns early (an empty Vec) both fail this the same way a real
    // one would.
    assert_eq!(enclosed, expected_sealed_box_findings());
    assert_eq!(narrow, vec![expected_room_finding(body_w, body_h)]);
    // `eroded` is exercised for real above (`narrow_passages` calls
    // `erode` itself); this direct call is kept only so `erode`'s own
    // cost is inside the timed block even if that internal call shape
    // ever changes.
    let _ = eroded;
}
