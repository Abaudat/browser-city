//! Story 2.4 (FR128): the two placement invariants over an *arrangement*
//! of objects that no single definition can express -- a doorway must
//! leave a passable gap of at least the player body's own width, and a
//! walkable region enclosed with no door is unreachable. Both are pure
//! functions over a sub-cell walkability grid (Tim's direction), never
//! over a hand-laid map type, so the same check runs unmodified over a
//! generated district once Epic 3's generator exists.
//!
//! [`WalkabilityGrid`] is the same shape and idiom as [`super::collision::
//! FloorCollision`] -- a dense bitset over a [`super::Rect`], `checked_mul`,
//! bounded, total -- except its `Rect` is in *sub-cells*
//! (`crate::generated::defs::COLLIDER_SUBCELLS_PER_CELL` per cell), the
//! resolution a one-cell-wide doorway (16 sub-cells) actually needs: at
//! cell resolution "a gap at least the body width" is vacuously always
//! true, since the player body is capped at one cell wide.

use super::{Rect, cell_index};
use crate::generated::defs;

/// The largest number of sub-cells a single [`WalkabilityGrid`] may cover --
/// mirrors [`super::MAX_CELLS_PER_FLOOR`]'s own reasoning at sub-cell
/// resolution: bounded, not unbounded, allocation from a degenerate or
/// malicious extent.
pub const MAX_SUBCELLS: u64 = super::MAX_CELLS_PER_FLOOR;

fn words_for(bit_count: u64) -> usize {
    bit_count.div_ceil(64) as usize
}

/// The number of sub-cells `bounds` covers, checked (never an unchecked
/// multiplication, since the published profile's `overflow-checks` would
/// abort on one): `Err` on an invalid rect or one whose area overflows.
fn total_subcells(bounds: Rect) -> Result<u64, String> {
    if !bounds.is_valid() {
        return Err(format!("walkability: invalid bounds {bounds:?}"));
    }
    let count = bounds
        .width()
        .checked_mul(bounds.height())
        .ok_or_else(|| format!("walkability: {bounds:?} overflows a sub-cell count"))?;
    u64::try_from(count)
        .map_err(|_| format!("walkability: {bounds:?} has a negative sub-cell count"))
}

/// One arrangement's walkability, at sub-cell resolution: a dense bitset
/// over `bounds`, blocked wherever a stamped `collider` overlaps. Cells
/// outside `bounds` are never blocked, exactly like [`super::collision::
/// FloorCollision`] -- a query there means "no collider is known", FR128's
/// rule applied to the absence of any data at all.
#[derive(Debug, Clone)]
pub struct WalkabilityGrid {
    bounds: Rect,
    blocked: Vec<u64>,
}

impl WalkabilityGrid {
    /// Builds a grid covering `bounds` (sub-cells), blocked wherever any of
    /// `colliders` (also sub-cells) overlaps. Total: `Err` on an invalid
    /// `bounds` or one over [`MAX_SUBCELLS`], never a panic or an unbounded
    /// allocation.
    pub fn build(bounds: Rect, colliders: &[Rect]) -> Result<Self, String> {
        let subcell_count = total_subcells(bounds)?;
        if subcell_count > MAX_SUBCELLS {
            return Err(format!(
                "walkability: {bounds:?} covers {subcell_count} sub-cells, over the {MAX_SUBCELLS}-sub-cell ceiling"
            ));
        }
        let mut blocked = vec![0u64; words_for(subcell_count)];
        for collider in colliders {
            let x0 = collider.x0.max(bounds.x0);
            let y0 = collider.y0.max(bounds.y0);
            let x1 = collider.x1.min(bounds.x1);
            let y1 = collider.y1.min(bounds.y1);
            for y in y0..y1 {
                for x in x0..x1 {
                    let Some(idx) = cell_index(bounds, x, y) else {
                        continue;
                    };
                    blocked[idx / 64] |= 1u64 << (idx % 64);
                }
            }
        }
        Ok(WalkabilityGrid { bounds, blocked })
    }

    /// Builds a grid directly from a pre-computed passability bitset
    /// (`true` = passable), the same shape [`Self::build`] produces but
    /// inverted -- [`erode`]'s own constructor, never called with a
    /// `passable` slice of the wrong length for `bounds`.
    fn from_passable(bounds: Rect, passable: &[bool]) -> Self {
        debug_assert_eq!(passable.len() as u64, total_subcells(bounds).unwrap_or(0));
        let mut blocked = vec![0u64; words_for(passable.len() as u64)];
        for (idx, &p) in passable.iter().enumerate() {
            if !p {
                blocked[idx / 64] |= 1u64 << (idx % 64);
            }
        }
        WalkabilityGrid { bounds, blocked }
    }

    pub fn bounds(&self) -> Rect {
        self.bounds
    }

    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        self.bounds.contains(x, y)
    }

    /// Out of bounds is never blocked (FR128 applied to the absence of
    /// data), exactly like [`super::collision::FloorCollision::is_blocked`].
    pub fn is_blocked(&self, x: i32, y: i32) -> bool {
        let Some(idx) = cell_index(self.bounds, x, y) else {
            return false;
        };
        (self.blocked[idx / 64] >> (idx % 64)) & 1 == 1
    }

    pub fn is_passable(&self, x: i32, y: i32) -> bool {
        self.in_bounds(x, y) && !self.is_blocked(x, y)
    }
}

/// The footprint's own north-west cell -- where a `collider` rect's local
/// `(0, 0)` sub-cell sits in world cells -- from the anchor cell (the
/// footprint's south-west corner) and its extent. The one place this
/// arithmetic lives on the server, mirroring `client/src/world/
/// footprint.ts`'s own `footprintOrigin` exactly (Tim's direction): `x` is
/// unchanged, only `y` moves, north by `height - 1` cells.
pub fn footprint_origin(anchor_x: i32, anchor_y: i32, width: u32, height: u32) -> (i32, i32) {
    let _ = width;
    (anchor_x, anchor_y - (height as i32 - 1))
}

/// One sim-local placement: an object definition id, its anchor cell (the
/// footprint's south-west corner) and floor -- never a `defs::ObjectDef`
/// itself, so a caller (a hand-laid test block today, Epic 3's generator
/// later) never needs the def resolved before building this.
#[derive(Debug, Clone, Copy)]
pub struct Placement {
    pub def_id: u32,
    pub anchor_x: i32,
    pub anchor_y: i32,
    pub floor: i8,
}

/// Rasterises every `placements` entry on `floor` into a [`WalkabilityGrid`]
/// covering `bounds` (sub-cells): [`footprint_origin`] converts each
/// placement's anchor cell to its footprint's own north-west sub-cell, and
/// a declared `collider` is stamped relative to that origin -- the same
/// rasterisation the client's collision grid performs, a second,
/// independent implementation (NFR30). A placement naming an unknown
/// `def_id` is a hard error: silently skipping it would rasterise a
/// district that does not match what was actually placed.
pub fn rasterise(
    bounds: Rect,
    floor: i8,
    placements: &[Placement],
    objects: &[defs::ObjectDef],
) -> Result<WalkabilityGrid, String> {
    let mut colliders = Vec::new();
    for p in placements {
        if p.floor != floor {
            continue;
        }
        let Some(def) = objects.iter().find(|o| o.id == p.def_id) else {
            return Err(format!(
                "walkability::rasterise: placement names unknown object def id {}",
                p.def_id
            ));
        };
        let Some(c) = def.collider else {
            continue;
        };
        let (origin_x, origin_y) = footprint_origin(p.anchor_x, p.anchor_y, def.width, def.height);
        let subcells_per_cell = defs::COLLIDER_SUBCELLS_PER_CELL;
        colliders.push(Rect {
            x0: origin_x * subcells_per_cell + c.x0,
            y0: origin_y * subcells_per_cell + c.y0,
            x1: origin_x * subcells_per_cell + c.x1,
            y1: origin_y * subcells_per_cell + c.y1,
        });
    }
    WalkabilityGrid::build(bounds, &colliders)
}

/// Erodes `grid` by a `body_width x body_height` sub-cell rect: a sub-cell
/// `(x, y)` is passable in the result iff a body whose own north-west
/// corner sits at `(x, y)` fits entirely inside `grid`'s own passable
/// sub-cells. Two `O(n)` sliding-window passes (horizontal then vertical),
/// never the naive `O(n * body_area)` per-cell rescan -- this runs over a
/// generated-district-sized grid in the same test suite as every other
/// `sim` test (`tests/world_walkability_perf.rs`).
pub fn erode(grid: &WalkabilityGrid, body_width: i32, body_height: i32) -> WalkabilityGrid {
    let bounds = grid.bounds;
    let total = total_subcells(bounds).unwrap_or(0) as usize;
    let width = bounds.width();
    let height = bounds.height();

    // Horizontal pass: h[x, y] = every sub-cell in [x, x+body_width) on
    // row y is passable, and the window fits before bounds.x1.
    let mut h = vec![false; total];
    if body_width >= 1 && (body_width as i64) <= width {
        for y in bounds.y0..bounds.y1 {
            let mut blocked_in_window: i64 = 0;
            for dx in 0..body_width {
                if grid.is_blocked(bounds.x0 + dx, y) {
                    blocked_in_window += 1;
                }
            }
            let mut x = bounds.x0;
            loop {
                if (x as i64) + body_width as i64 > bounds.x1 as i64 {
                    break;
                }
                if let Some(idx) = cell_index(bounds, x, y) {
                    h[idx] = blocked_in_window == 0;
                }
                let leaving = x;
                let entering = x + body_width;
                if entering < bounds.x1 {
                    if grid.is_blocked(leaving, y) {
                        blocked_in_window -= 1;
                    }
                    if grid.is_blocked(entering, y) {
                        blocked_in_window += 1;
                    }
                }
                x += 1;
            }
        }
    }

    // Vertical pass over h: eroded[x, y] = every h[x, y'] for y' in
    // [y, y+body_height) is true, and the window fits before bounds.y1.
    let mut eroded_passable = vec![false; total];
    if body_height >= 1 && (body_height as i64) <= height {
        let h_at =
            |x: i32, y: i32| -> bool { cell_index(bounds, x, y).map(|i| h[i]).unwrap_or(false) };
        for x in bounds.x0..bounds.x1 {
            let mut not_h_in_window: i64 = 0;
            for dy in 0..body_height {
                if !h_at(x, bounds.y0 + dy) {
                    not_h_in_window += 1;
                }
            }
            let mut y = bounds.y0;
            loop {
                if (y as i64) + body_height as i64 > bounds.y1 as i64 {
                    break;
                }
                if not_h_in_window == 0
                    && let Some(idx) = cell_index(bounds, x, y)
                {
                    eroded_passable[idx] = true;
                }
                let leaving = y;
                let entering = y + body_height;
                if entering < bounds.y1 {
                    if !h_at(x, leaving) {
                        not_h_in_window -= 1;
                    }
                    if !h_at(x, entering) {
                        not_h_in_window += 1;
                    }
                }
                y += 1;
            }
        }
    }

    WalkabilityGrid::from_passable(bounds, &eroded_passable)
}

/// Reads `movement.player_body_width_subcells`/`movement.player_body_
/// height_subcells` from `balance` (Tim's direction: never a literal --
/// a caller always passes [`crate::generated::defs::BALANCE`], but the
/// signature accepts any slice so a test can pin the verdict to a
/// deliberately different value).
pub fn player_body_subcells(balance: &[defs::BalanceSeed]) -> (i32, i32) {
    let get = |key: &str| -> i32 {
        balance
            .iter()
            .find(|b| b.key == key)
            .unwrap_or_else(|| panic!("sim::world::walkability: missing balance key '{key}'"))
            .value as i32
    };
    (
        get("movement.player_body_width_subcells"),
        get("movement.player_body_height_subcells"),
    )
}

/// One reported finding: a connected region's bounding rect (sub-cells)
/// and its own cell count -- never a boolean pass/fail, the caller checks
/// for an empty `Vec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Finding {
    pub bounds: Rect,
    pub cell_count: u64,
}

/// Labels every cell `passable` accepts into 4-connected components,
/// iterative (an explicit `Vec`-backed stack, never recursion -- a
/// generated district would blow the stack) and deterministic (raster
/// scan order: row-major from `bounds`'s own north-west corner, so which
/// component gets which label never depends on anything but `bounds` and
/// `passable` themselves). Returns a label per sub-cell (`-1` = not
/// passable) and one [`Finding`] per label, in label order.
fn label_components(bounds: Rect, passable: impl Fn(i32, i32) -> bool) -> (Vec<i32>, Vec<Finding>) {
    let total = total_subcells(bounds).unwrap_or(0) as usize;
    let mut labels = vec![-1i32; total];
    let mut findings: Vec<Finding> = Vec::new();
    let mut stack: Vec<(i32, i32)> = Vec::new();

    for y in bounds.y0..bounds.y1 {
        for x in bounds.x0..bounds.x1 {
            let Some(start_idx) = cell_index(bounds, x, y) else {
                continue;
            };
            if labels[start_idx] != -1 || !passable(x, y) {
                continue;
            }
            let label = findings.len() as i32;
            labels[start_idx] = label;
            stack.clear();
            stack.push((x, y));
            let (mut x0, mut y0, mut x1, mut y1) = (x, y, x + 1, y + 1);
            let mut count: u64 = 0;
            while let Some((cx, cy)) = stack.pop() {
                count += 1;
                x0 = x0.min(cx);
                y0 = y0.min(cy);
                x1 = x1.max(cx + 1);
                y1 = y1.max(cy + 1);
                for (nx, ny) in [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)] {
                    if !bounds.contains(nx, ny) {
                        continue;
                    }
                    let Some(nidx) = cell_index(bounds, nx, ny) else {
                        continue;
                    };
                    if labels[nidx] != -1 || !passable(nx, ny) {
                        continue;
                    }
                    labels[nidx] = label;
                    stack.push((nx, ny));
                }
            }
            findings.push(Finding {
                bounds: Rect { x0, y0, x1, y1 },
                cell_count: count,
            });
        }
    }
    (labels, findings)
}

/// AC5: every walkable region with no path back to `(seed_x, seed_y)` --
/// the caller's own start position -- reported, sorted by smallest
/// sub-cell (deterministic). A fully open grid, or one whose every
/// walkable cell reaches the seed through a door, reports nothing; a
/// region touching the grid edge is not itself a report (edge = open
/// world, `bounds` is only ever a window onto it), it simply is not a
/// distinct raw component within `bounds`.
pub fn enclosed_regions(grid: &WalkabilityGrid, seed_x: i32, seed_y: i32) -> Vec<Finding> {
    let bounds = grid.bounds;
    let passable = |x: i32, y: i32| grid.is_passable(x, y);
    let (labels, findings) = label_components(bounds, passable);
    let seed_label = cell_index(bounds, seed_x, seed_y)
        .filter(|_| grid.is_passable(seed_x, seed_y))
        .map(|idx| labels[idx]);

    let mut result: Vec<Finding> = findings
        .into_iter()
        .enumerate()
        .filter(|(i, _)| Some(*i as i32) != seed_label)
        .map(|(_, f)| f)
        .collect();
    result.sort_by_key(|f| (f.bounds.y0, f.bounds.x0));
    result
}

/// AC4: within the raw region reachable from `(seed_x, seed_y)`, every
/// pocket that a `body_width x body_height` body can no longer reach once
/// erosion is applied -- a passage too narrow for the body to fit through,
/// reported the same way [`enclosed_regions`] reports a missing door.
/// One algorithm run twice, not two (Tim's direction): [`erode`] plus this
/// same [`label_components`] primitive, restricted to the raw-reachable
/// footprint so a chokepoint deep in an already-enclosed region (already
/// reported by [`enclosed_regions`]) is not reported a second time here.
pub fn narrow_passages(
    grid: &WalkabilityGrid,
    seed_x: i32,
    seed_y: i32,
    body_width: i32,
    body_height: i32,
) -> Vec<Finding> {
    let bounds = grid.bounds;
    let raw_passable = |x: i32, y: i32| grid.is_passable(x, y);
    let (raw_labels, _) = label_components(bounds, raw_passable);
    let Some(seed_idx) = cell_index(bounds, seed_x, seed_y) else {
        return Vec::new();
    };
    if !grid.is_passable(seed_x, seed_y) {
        return Vec::new();
    }
    let raw_seed_label = raw_labels[seed_idx];

    let eroded = erode(grid, body_width, body_height);
    let restricted = |x: i32, y: i32| -> bool {
        let Some(idx) = cell_index(bounds, x, y) else {
            return false;
        };
        raw_labels[idx] == raw_seed_label && eroded.is_passable(x, y)
    };
    let (eroded_labels, findings) = label_components(bounds, restricted);
    let seed_label2 = if eroded.is_passable(seed_x, seed_y) {
        Some(eroded_labels[seed_idx])
    } else {
        None
    };

    let mut result: Vec<Finding> = findings
        .into_iter()
        .enumerate()
        .filter(|(i, _)| Some(*i as i32) != seed_label2)
        .map(|(_, f)| f)
        .collect();
    result.sort_by_key(|f| (f.bounds.y0, f.bounds.x0));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parses a small ASCII-art grid (`#` blocked, `.` passable) into a
    /// [`WalkabilityGrid`], top row first, so unit tests can be written as
    /// pictures rather than lists of rects.
    fn grid_from_art(rows: &[&str]) -> WalkabilityGrid {
        let height = rows.len() as i32;
        let width = rows[0].len() as i32;
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: width,
            y1: height,
        };
        let mut colliders = Vec::new();
        for (y, row) in rows.iter().enumerate() {
            for (x, ch) in row.chars().enumerate() {
                if ch == '#' {
                    colliders.push(Rect {
                        x0: x as i32,
                        y0: y as i32,
                        x1: x as i32 + 1,
                        y1: y as i32 + 1,
                    });
                }
            }
        }
        WalkabilityGrid::build(bounds, &colliders).unwrap()
    }

    // --- WalkabilityGrid ----------------------------------------------

    #[test]
    fn out_of_bounds_is_never_blocked() {
        let grid = grid_from_art(&["..", ".."]);
        assert!(!grid.is_blocked(100, 100));
        assert!(!grid.is_blocked(-1, -1));
    }

    #[test]
    fn a_stamped_collider_blocks_exactly_its_own_cells() {
        let grid = grid_from_art(&["#.", ".."]);
        assert!(grid.is_blocked(0, 0));
        assert!(!grid.is_blocked(1, 0));
        assert!(!grid.is_blocked(0, 1));
    }

    // --- footprint_origin ------------------------------------------------

    #[test]
    fn footprint_origin_matches_the_clients_own_footprintorigin() {
        // A 1-cell-tall object: origin equals the anchor exactly.
        assert_eq!(footprint_origin(5, 5, 3, 1), (5, 5));
        // A 3-cell-tall object anchored at (5, 5): origin moves north by
        // height - 1 = 2 cells, x unchanged.
        assert_eq!(footprint_origin(5, 5, 1, 3), (5, 3));
    }

    // --- rasterise ---------------------------------------------------

    #[test]
    fn rasterise_stamps_a_colliders_footprint_relative_rect() {
        let objects = &[defs::ObjectDef {
            id: 1,
            key: "wall_segment",
            name: "Wall Segment",
            layer: 0,
            sprite: defs::SpriteRect {
                sheet: "x",
                x: 0,
                y: 0,
                w: 16,
                h: 16,
            },
            width: 1,
            height: 1,
            collider: Some(defs::ColliderRect {
                x0: 0,
                y0: 0,
                x1: 16,
                y1: 16,
            }),
            interact_at: None,
            window: false,
            tags: &[],
        }];
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: 32,
            y1: 32,
        };
        let placements = &[Placement {
            def_id: 1,
            anchor_x: 1,
            anchor_y: 1,
            floor: 0,
        }];
        let grid = rasterise(bounds, 0, placements, objects).unwrap();
        // Anchor cell (1, 1), one cell tall: origin sub-cell (16, 16).
        assert!(grid.is_blocked(16, 16));
        assert!(grid.is_blocked(31, 31));
        assert!(!grid.is_blocked(15, 15));
    }

    #[test]
    fn rasterise_skips_a_placement_on_a_different_floor() {
        let objects = &[defs::ObjectDef {
            id: 1,
            key: "wall_segment",
            name: "Wall Segment",
            layer: 0,
            sprite: defs::SpriteRect {
                sheet: "x",
                x: 0,
                y: 0,
                w: 16,
                h: 16,
            },
            width: 1,
            height: 1,
            collider: Some(defs::ColliderRect {
                x0: 0,
                y0: 0,
                x1: 16,
                y1: 16,
            }),
            interact_at: None,
            window: false,
            tags: &[],
        }];
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: 32,
            y1: 32,
        };
        let placements = &[Placement {
            def_id: 1,
            anchor_x: 1,
            anchor_y: 1,
            floor: 1,
        }];
        let grid = rasterise(bounds, 0, placements, objects).unwrap();
        assert!(!grid.is_blocked(16, 16));
    }

    #[test]
    fn rasterise_errors_on_an_unknown_def_id() {
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: 32,
            y1: 32,
        };
        let placements = &[Placement {
            def_id: 999,
            anchor_x: 0,
            anchor_y: 0,
            floor: 0,
        }];
        assert!(rasterise(bounds, 0, placements, &[]).is_err());
    }

    // --- erode / doorway width ------------------------------------------

    /// A horizontal gap of exactly `gap` sub-cells in an otherwise solid
    /// row 1, on a 3-row grid (rows 0 and 2 solid, row 1 the gap) --
    /// `width` total columns.
    fn grid_with_gap(width: i32, gap_start: i32, gap: i32) -> WalkabilityGrid {
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: width,
            y1: 3,
        };
        let mut colliders = vec![
            Rect {
                x0: 0,
                y0: 0,
                x1: width,
                y1: 1,
            },
            Rect {
                x0: 0,
                y0: 2,
                x1: width,
                y1: 3,
            },
        ];
        if gap_start > 0 {
            colliders.push(Rect {
                x0: 0,
                y0: 1,
                x1: gap_start,
                y1: 2,
            });
        }
        if gap_start + gap < width {
            colliders.push(Rect {
                x0: gap_start + gap,
                y0: 1,
                x1: width,
                y1: 2,
            });
        }
        WalkabilityGrid::build(bounds, &colliders).unwrap()
    }

    #[test]
    fn a_gap_of_exactly_the_body_width_erodes_to_one_passable_cell() {
        let grid = grid_with_gap(20, 8, 8);
        let eroded = erode(&grid, 8, 1);
        assert!(eroded.is_passable(8, 1));
        assert!(!eroded.is_passable(7, 1));
        assert!(!eroded.is_passable(9, 1));
    }

    #[test]
    fn a_gap_one_sub_cell_narrower_than_the_body_erodes_to_nothing() {
        let grid = grid_with_gap(20, 8, 7);
        let eroded = erode(&grid, 8, 1);
        for x in 0..20 {
            assert!(!eroded.is_passable(x, 1), "x={x} should not be passable");
        }
    }

    #[test]
    fn a_gap_offset_by_one_sub_cell_at_a_cell_boundary_is_handled() {
        // A gap starting mid-cell (sub-cell 15, one before a 16-sub-cell
        // cell boundary) of exactly the body width still erodes to a
        // single passable origin.
        let grid = grid_with_gap(40, 15, 8);
        let eroded = erode(&grid, 8, 1);
        assert!(eroded.is_passable(15, 1));
        assert!(!eroded.is_passable(14, 1));
        assert!(!eroded.is_passable(16, 1));
    }

    #[test]
    fn changing_the_balance_value_changes_the_verdict() {
        let grid = grid_with_gap(20, 8, 8);
        let narrower_balance = [defs::BalanceSeed {
            key: "movement.player_body_width_subcells",
            value: 8,
            min: 1,
            max: 16,
        }];
        let wider_balance = [defs::BalanceSeed {
            key: "movement.player_body_width_subcells",
            value: 9,
            min: 1,
            max: 16,
        }];
        // At width 8 (read from the balance fixture, never a literal) the
        // exact-width gap passes...
        let (width_8, _) = player_body_subcells(&[
            narrower_balance[0],
            defs::BalanceSeed {
                key: "movement.player_body_height_subcells",
                value: 1,
                min: 1,
                max: 16,
            },
        ]);
        let eroded_8 = erode(&grid, width_8, 1);
        assert!(eroded_8.is_passable(8, 1));
        // ...but changing only the balance fixture's own value to 9 makes
        // the same gap fail: the verdict follows the value, never a
        // literal.
        let (width_9, _) = player_body_subcells(&[
            wider_balance[0],
            defs::BalanceSeed {
                key: "movement.player_body_height_subcells",
                value: 1,
                min: 1,
                max: 16,
            },
        ]);
        let eroded_9 = erode(&grid, width_9, 1);
        for x in 0..20 {
            assert!(
                !eroded_9.is_passable(x, 1),
                "x={x} should not be passable at body width 9"
            );
        }
    }

    #[test]
    fn player_body_subcells_reads_both_keys_from_the_real_balance() {
        let (width, height) = player_body_subcells(defs::BALANCE);
        assert!(width > 0);
        assert!(height > 0);
    }

    // --- enclosed_regions --------------------------------------------

    #[test]
    fn a_fully_open_grid_reports_no_enclosed_region() {
        let grid = grid_from_art(&["....", "....", "....", "...."]);
        assert!(enclosed_regions(&grid, 0, 0).is_empty());
    }

    #[test]
    fn a_room_with_no_door_is_reported() {
        let grid = grid_from_art(&["#####", "#...#", "#...#", "#####"]);
        let findings = enclosed_regions(&grid, 0, 0);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].cell_count, 3 * 2);
    }

    #[test]
    fn the_same_room_with_a_door_is_not_reported() {
        // A gap in the north wall at x=2.
        let grid = grid_from_art(&["##.##", "#...#", "#...#", "#####"]);
        assert!(enclosed_regions(&grid, 2, 0).is_empty());
    }

    #[test]
    fn two_separate_sealed_rooms_are_both_reported() {
        let grid = grid_from_art(&["###.###", "#.#.#.#", "###.###"]);
        // The seed sits in the open corridor column (x=3); both side
        // rooms are sealed.
        let findings = enclosed_regions(&grid, 3, 0);
        assert_eq!(findings.len(), 2);
    }

    #[test]
    fn a_region_touching_the_grid_edge_is_not_reported() {
        // No wall at all along the west edge: the open area "touches"
        // bounds.x0, and is reachable from the seed like any other open
        // cell -- not a distinct component, so nothing is reported for
        // it specifically.
        let grid = grid_from_art(&["....", "....", "...."]);
        assert!(enclosed_regions(&grid, 3, 2).is_empty());
    }

    #[test]
    fn removing_a_door_never_reduces_the_number_of_reported_regions() {
        // Sealed room -> one report. Opening a door in it -> zero.
        // Removing the door again (closing it) can only add reports back,
        // never remove one relative to the open state.
        let sealed = grid_from_art(&["#####", "#...#", "#####"]);
        let open = grid_from_art(&["##.##", "#...#", "#####"]);
        assert!(enclosed_regions(&sealed, 0, 0).len() >= enclosed_regions(&open, 2, 0).len());
    }

    // --- narrow_passages -----------------------------------------------

    /// A walled box sitting in open exterior, with a one-sub-cell-wide
    /// door -- wide enough for a single-subcell raw walker, but (the point
    /// of these tests) not necessarily for a wider body.
    fn grid_with_narrow_door() -> WalkabilityGrid {
        grid_from_art(&["......", ".#.##.", ".#..#.", ".####.", "......"])
    }

    #[test]
    fn a_passage_too_narrow_for_the_body_is_reported_even_though_raw_reachable() {
        let grid = grid_with_narrow_door();
        // Raw-reachable: the 1-wide door connects exterior and interior.
        assert!(enclosed_regions(&grid, 0, 0).is_empty());
        // A 2-wide body cannot fit through a 1-wide door: the interior is
        // reported as cut off by a narrow passage.
        let findings = narrow_passages(&grid, 0, 0, 2, 1);
        assert!(!findings.is_empty());
    }

    #[test]
    fn a_passage_at_least_the_body_width_reports_nothing() {
        let grid = grid_with_narrow_door();
        // A 1-wide body fits through the 1-wide door.
        let findings = narrow_passages(&grid, 0, 0, 1, 1);
        assert!(findings.is_empty());
    }
}
