//! Story 2.4's integration layer (Tim's direction): a wall ring laid from
//! real `wall_segment`/`lamppost` definitions, rasterised by the same
//! `sim::world::walkability::rasterise` the game uses, then passed to both
//! checks. One canonical block passes (its door is wide enough); one
//! mutated copy fails each check.
//!
//! Doorway and reachability checks on world *arrangements* have no
//! emitter today (`tools/defs-build` never places anything) -- their
//! "build fails" is this test job going red, not a defs-build fixture.
//! The generator story that emits districts (Epic 3) must call
//! [`sim::world::walkability::rasterise`]/[`enclosed_regions`]/
//! [`narrow_passages`] unchanged, as a post-condition on what it places.

use sim::generated::defs;
use sim::world::Rect;
use sim::world::walkability::{
    Finding, Placement, enclosed_regions, erode, narrow_passages, player_body_subcells, rasterise,
};

const WALL_SEGMENT_ID: u32 = 6;
const LAMPPOST_ID: u32 = 4;
const COLLIDER_SUBCELLS_PER_CELL: i32 = defs::COLLIDER_SUBCELLS_PER_CELL;

/// An 8x6-cell ring (`RING_X0..RING_X1`, `RING_Y0..RING_Y1`), walled on
/// every perimeter cell except the door cell `(DOOR_X, RING_Y0)` on the
/// north wall -- open into the exterior above it.
const RING_X0: i32 = 0;
const RING_Y0: i32 = 0;
const RING_X1: i32 = 8;
const RING_Y1: i32 = 6;
const DOOR_X: i32 = 4;

/// One margin cell of exterior on every side, so the seed (just outside
/// the door) and every flood fill have real open space to start from.
fn grid_bounds() -> Rect {
    let margin = COLLIDER_SUBCELLS_PER_CELL;
    Rect {
        x0: (RING_X0 - 1) * COLLIDER_SUBCELLS_PER_CELL - margin,
        y0: (RING_Y0 - 1) * COLLIDER_SUBCELLS_PER_CELL - margin,
        x1: (RING_X1 + 1) * COLLIDER_SUBCELLS_PER_CELL + margin,
        y1: (RING_Y1 + 1) * COLLIDER_SUBCELLS_PER_CELL + margin,
    }
}

/// The seed cell's own sub-cell centre: one cell north of the door, in
/// the open exterior.
fn seed_subcell() -> (i32, i32) {
    (
        DOOR_X * COLLIDER_SUBCELLS_PER_CELL + COLLIDER_SUBCELLS_PER_CELL / 2,
        (RING_Y0 - 1) * COLLIDER_SUBCELLS_PER_CELL + COLLIDER_SUBCELLS_PER_CELL / 2,
    )
}

/// `wall_segment` at every ring perimeter cell; `door_open` skips the
/// door cell entirely (an ordinary walkable cell, FR118); `lamppost_in_door`
/// additionally places a `lamppost` anchored on the (still-open) door
/// cell, narrowing it from within.
fn ring_placements(door_open: bool, lamppost_in_door: bool) -> Vec<Placement> {
    let mut placements = Vec::new();
    let is_door = |x: i32, y: i32| x == DOOR_X && y == RING_Y0;
    for y in RING_Y0..RING_Y1 {
        for x in RING_X0..RING_X1 {
            let on_perimeter = x == RING_X0 || x == RING_X1 - 1 || y == RING_Y0 || y == RING_Y1 - 1;
            if !on_perimeter {
                continue;
            }
            if is_door(x, y) {
                if !door_open {
                    placements.push(Placement {
                        def_id: WALL_SEGMENT_ID,
                        anchor_x: x,
                        anchor_y: y,
                        floor: 0,
                    });
                }
                continue;
            }
            placements.push(Placement {
                def_id: WALL_SEGMENT_ID,
                anchor_x: x,
                anchor_y: y,
                floor: 0,
            });
        }
    }
    if lamppost_in_door {
        placements.push(Placement {
            def_id: LAMPPOST_ID,
            anchor_x: DOOR_X,
            anchor_y: RING_Y0,
            floor: 0,
        });
    }
    placements
}

fn build_grid(placements: &[Placement]) -> sim::world::walkability::WalkabilityGrid {
    rasterise(grid_bounds(), 0, placements, defs::OBJECTS)
        .expect("test geometry must name real object def ids")
}

#[test]
fn the_canonical_block_with_a_wide_enough_door_is_reachable() {
    let grid = build_grid(&ring_placements(true, false));
    let (seed_x, seed_y) = seed_subcell();
    assert!(
        enclosed_regions(&grid, seed_x, seed_y).unwrap().is_empty(),
        "the interior must be reachable through a full-cell-wide door"
    );
    let (body_w, body_h) = player_body_subcells(defs::BALANCE);
    assert!(
        narrow_passages(&grid, seed_x, seed_y, body_w, body_h)
            .unwrap()
            .is_empty(),
        "a full-cell-wide door must be wide enough for the player body"
    );
}

#[test]
fn a_closed_ring_reports_the_interior_as_enclosed() {
    let grid = build_grid(&ring_placements(false, false));
    let (seed_x, seed_y) = seed_subcell();
    let findings = enclosed_regions(&grid, seed_x, seed_y).unwrap();
    assert_eq!(
        findings.len(),
        1,
        "the fully sealed interior must be reported exactly once"
    );
    // The interior is 6x4 cells, in sub-cells.
    let interior_cells = (RING_X1 - RING_X0 - 2) as u64 * (RING_Y1 - RING_Y0 - 2) as u64;
    let interior_subcells = interior_cells * (COLLIDER_SUBCELLS_PER_CELL as u64).pow(2);
    assert_eq!(findings[0].cell_count, interior_subcells);
}

/// Quentin's direction: the exact reported `Finding`, worked out by hand
/// against the real, committed geometry, never by calling the code under
/// test.
///
/// The lamppost's own collider band (`y0=10, y1=14`, real def) leaves six
/// sub-cells clear on either side of it within the door cell (`x=64..80`)
/// -- less than the player body's own width (8) -- so an 8x4 body window
/// has no valid position for any origin `y` in `7..13` (its own window
/// always touches the lamppost band there), which severs the door.
/// Reachable-from-the-interior-side origins resume at `y=14` (bridging
/// the last two door-height rows, `x` still confined to the 8-wide door
/// span `64..72`) and widen into the fully open interior from `y=16`
/// onward (`x` the interior's own valid span `16..104`), down to the
/// interior's own southern limit at `y=76`: `9 + 9 + 61*89 = 5447`
/// sub-cells, bounds `(16, 14)-(105, 77)`.
#[test]
fn a_lamppost_narrowing_the_door_below_body_width_cuts_off_the_interior() {
    let grid = build_grid(&ring_placements(true, true));
    let (seed_x, seed_y) = seed_subcell();
    assert!(
        enclosed_regions(&grid, seed_x, seed_y).unwrap().is_empty(),
        "a single-subcell walker still fits past the lamppost on either side"
    );
    let (body_w, body_h) = player_body_subcells(defs::BALANCE);
    let findings = narrow_passages(&grid, seed_x, seed_y, body_w, body_h).unwrap();
    assert_eq!(
        findings,
        vec![Finding {
            bounds: Rect {
                x0: 16,
                y0: 14,
                x1: 105,
                y1: 77,
            },
            cell_count: 9 + 9 + 61 * 89,
        }]
    );
}

/// `erode` is exercised directly here too, over the same real geometry,
/// confirming the door cell's own centre is not body-passable once the
/// lamppost sits in it.
#[test]
fn erosion_over_the_real_ring_matches_the_narrow_passage_verdict() {
    let grid = build_grid(&ring_placements(true, true));
    let (body_w, body_h) = player_body_subcells(defs::BALANCE);
    let eroded = erode(&grid, body_w, body_h);
    // The lamppost's own collider band (`y0=10, y1=14`, the real,
    // committed def): every crossing origin must pass through this exact
    // band (4-connected movement changes y one sub-cell at a time), and
    // within it the door cell offers only six clear sub-cells on either
    // side of the lamppost -- less than the body's own width -- so no x
    // in the door cell is body-passable at any y in this band.
    let door_x0 = DOOR_X * COLLIDER_SUBCELLS_PER_CELL;
    let door_x1 = door_x0 + COLLIDER_SUBCELLS_PER_CELL;
    for y in 10..14 {
        for x in door_x0..door_x1 {
            assert!(
                !eroded.is_passable(x, y),
                "(x={x}, y={y}) should not be body-passable in the lamppost's own collider band"
            );
        }
    }
    // Well clear of the lamppost's band, the door cell is fully
    // body-passable.
    assert!(eroded.is_passable(door_x0, 0));
}
