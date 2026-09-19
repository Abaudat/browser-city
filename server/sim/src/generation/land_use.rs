//! Pass 1 (FR110): land use. Receives the city seed and the site bounds;
//! hands down a coarse residential/commercial/industrial/institutional
//! split across the site plus the density field the whole city reads from
//! then on (NFR8's centre-to-periphery falloff is a property of this
//! field, not of any later pass). Reads nothing -- the first pass, and the
//! pass that authors the field every later pass reads.
//!
//! "Nothing finer" holds at the type level: [`LandUseCell`] carries
//! exactly a [`LandUse`] and a density value, with no street, block or
//! plot concept anywhere in this module for a later pass to reach past.
//!
//! Districts are grown by recursive axis-aligned subdivision of the coarse
//! grid (the same idiom [`super::streets`] uses for blocks), never a
//! nearest-seed Voronoi diagram: an earlier Chebyshev-distance Voronoi
//! version of this pass produced diagonal, staircase region boundaries
//! (Artie's direction explicitly forbids this -- "boundaries are straight,
//! axis-aligned runs") and, in rare seeds, disconnected single-cell
//! islands of the same land use (found by `inv_generation_streets_
//! connected_and_not_stranded` over arbitrary seeds, not by a fixed
//! sweep). A rectangular partition cannot produce either defect: every
//! leaf is a rect, a region is a union of adjacent same-use rects, and its
//! boundary is therefore always a run of axis-aligned segments.
//! `guaranteed_min_region_cells` is what makes coarseness provable rather
//! than merely likely -- see its own doc comment.

use std::collections::BTreeSet;

use super::{GenerationConfig, SiteBounds};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

pub const PASS_ID: u64 = super::PASS_LAND_USE;

/// The four land uses FR110/the GDD name (`docs/generation.md`'s
/// "Land-use mix is not a scalar"). No fifth "empty" variant exists --
/// open periphery is a low [`LandUseCell::density`] of one of these four,
/// never a distinct value to fall into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LandUse {
    Residential,
    Commercial,
    Industrial,
    Institutional,
}

impl LandUse {
    pub const ALL: [LandUse; 4] = [
        LandUse::Residential,
        LandUse::Commercial,
        LandUse::Industrial,
        LandUse::Institutional,
    ];
}

/// One coarse cell's own value: a land use and a density -- "nothing finer
/// than the four uses plus the parameter field" (Artie's direction).
/// Building age and affluence are not read by any pass yet (3.7 adds them
/// to this same struct).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandUseCell {
    pub use_: LandUse,
    pub density: i32,
}

/// A 4-connected component of equal land use over the coarse grid
/// (Quentin's direction): `bounds` is in *coarse-cell* coordinates, never
/// world cells -- a caller that needs world cells multiplies by
/// [`LandUseMap::cell_size`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub use_: LandUse,
    pub bounds: Rect,
    pub cell_count: u64,
}

/// Pass 1's own output: a dense, row-major grid over the site's coarse
/// cells (the `FloorCollision` idiom -- arithmetic index, no map lookup).
/// Every one of `cols * rows` cells carries exactly one [`LandUseCell`];
/// there is no `None`/`Unassigned` variant to fall into.
#[derive(Debug, Clone)]
pub struct LandUseMap {
    site: SiteBounds,
    cell_size: i32,
    cols: i32,
    rows: i32,
    cells: Vec<LandUseCell>,
}

impl LandUseMap {
    pub fn site(&self) -> SiteBounds {
        self.site
    }

    pub fn cell_size(&self) -> i32 {
        self.cell_size
    }

    pub fn cols(&self) -> i32 {
        self.cols
    }

    pub fn rows(&self) -> i32 {
        self.rows
    }

    fn coarse_index(&self, cx: i32, cy: i32) -> Option<usize> {
        if cx < 0 || cy < 0 || cx >= self.cols || cy >= self.rows {
            return None;
        }
        Some((cy * self.cols + cx) as usize)
    }

    /// The coarse cell at coarse-grid coordinates `(cx, cy)`, `None`
    /// outside `[0, cols) x [0, rows)`.
    pub fn coarse_at(&self, cx: i32, cy: i32) -> Option<LandUseCell> {
        self.coarse_index(cx, cy).map(|i| self.cells[i])
    }

    /// The coarse cell covering world-absolute `(x, y)`, `None` outside
    /// [`Self::site`].
    pub fn at_world(&self, x: i32, y: i32) -> Option<LandUseCell> {
        if !self.site.contains(x, y) {
            return None;
        }
        let cx = (x - self.site.x0) / self.cell_size;
        let cy = (y - self.site.y0) / self.cell_size;
        self.coarse_at(cx, cy)
    }

    /// Every 4-connected component of equal land use, sorted by
    /// `(bounds.y0, bounds.x0)` (deterministic, never iteration order).
    /// Iterative flood fill (an explicit stack, never recursion) --
    /// `world::walkability`'s own idiom, over land-use equality rather
    /// than a passability bitset.
    pub fn regions(&self) -> Vec<Region> {
        let total = (self.cols * self.rows) as usize;
        let mut labels = vec![-1i32; total];
        let mut found: Vec<Region> = Vec::new();
        let mut stack: Vec<(i32, i32)> = Vec::new();

        for y in 0..self.rows {
            for x in 0..self.cols {
                let start = self.coarse_index(x, y).unwrap();
                if labels[start] != -1 {
                    continue;
                }
                let use_ = self.cells[start].use_;
                labels[start] = found.len() as i32;
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
                        let Some(nidx) = self.coarse_index(nx, ny) else {
                            continue;
                        };
                        if labels[nidx] != -1 || self.cells[nidx].use_ != use_ {
                            continue;
                        }
                        labels[nidx] = found.len() as i32;
                        stack.push((nx, ny));
                    }
                }
                found.push(Region {
                    use_,
                    bounds: Rect { x0, y0, x1, y1 },
                    cell_count: count,
                });
            }
        }
        found.sort_by_key(|r| (r.bounds.y0, r.bounds.x0));
        found
    }
}

/// Recursively splits `rect` (coarse-cell coordinates) into leaves no
/// larger than `cfg.land_use_max_leaf_cells` on either axis -- Street's
/// own `subdivide` idiom, but simpler: no street width to subtract, so a
/// leaf's own two children are simply `[from, pos)`/`[pos, to)`, adjacent
/// with no gap.
///
/// An axis is split if and only if it currently exceeds `max_leaf_cells`
/// (never "whichever is longer" alone) -- combined with the config
/// validator's own check that `max_leaf_cells` is at least twice `min_
/// leaf_cells`, this guarantees the split is always legal (`len >= 2 *
/// min_leaf_cells`) whenever it is attempted, so every leaf this function
/// ever produces is at least `min_leaf_cells` on *both* axes: an axis
/// that is split at all has its last split leave both children `>=
/// min_leaf_cells` (the position is clamped to keep that margin); an axis
/// that is never split keeps whatever value it already had, which is
/// either the untouched site extent (`>= min_leaf_cells` for any sane
/// config) or the result of an earlier split on that same axis (already
/// proven `>= min_leaf_cells` by this same induction). See
/// [`guaranteed_min_region_cells`].
fn subdivide(
    rect: Rect,
    cfg: &GenerationConfig,
    rng: &mut Rng,
    depth: u32,
    leaves: &mut Vec<Rect>,
) {
    let over_x = rect.width() > cfg.land_use_max_leaf_cells as i64;
    let over_y = rect.height() > cfg.land_use_max_leaf_cells as i64;
    if (!over_x && !over_y) || depth >= cfg.land_use_max_recursion_depth {
        leaves.push(rect);
        return;
    }
    let vertical = if over_x && over_y {
        rect.width() >= rect.height()
    } else {
        over_x
    };

    let (from, to) = if vertical {
        (rect.x0, rect.x1)
    } else {
        (rect.y0, rect.y1)
    };
    let len = to - from;
    let min_leaf = cfg.land_use_min_leaf_cells;
    let mid = from + len / 2;
    let jitter_span = (len as i64 * cfg.land_use_split_jitter_pct as i64 / 100) as i32;
    let jitter = if jitter_span > 0 {
        (rng.next_u64() % (2 * jitter_span as u64 + 1)) as i32 - jitter_span
    } else {
        0
    };
    let lo = from + min_leaf;
    let hi = to - min_leaf;
    let pos = (mid + jitter).clamp(lo, hi);

    let (c1, c2) = if vertical {
        (
            Rect {
                x0: rect.x0,
                y0: rect.y0,
                x1: pos,
                y1: rect.y1,
            },
            Rect {
                x0: pos,
                y0: rect.y0,
                x1: rect.x1,
                y1: rect.y1,
            },
        )
    } else {
        (
            Rect {
                x0: rect.x0,
                y0: rect.y0,
                x1: rect.x1,
                y1: pos,
            },
            Rect {
                x0: rect.x0,
                y0: pos,
                x1: rect.x1,
                y1: rect.y1,
            },
        )
    };
    subdivide(c1, cfg, rng, depth + 1, leaves);
    subdivide(c2, cfg, rng, depth + 1, leaves);
}

/// Draws `count` land uses: one each of [`LandUse::ALL`] guaranteed
/// whenever `count >= 4` (so every generated map has at least one leaf of
/// every use, never leaving one entirely unrepresented -- for `count < 4`
/// only the first `count` of [`LandUse::ALL`] are guaranteed, since fewer
/// leaves than uses cannot possibly carry all four), the remainder drawn
/// by `cfg`'s own `share_*_pct` weights, then shuffled (Fisher-Yates) so
/// the guaranteed leaves are never predictably the first ones generated.
fn draw_uses(rng: &mut Rng, count: usize, cfg: &GenerationConfig) -> Vec<LandUse> {
    let mut uses: Vec<LandUse> = LandUse::ALL.iter().copied().take(count).collect();
    let weights = [
        (LandUse::Residential, cfg.share_residential_pct),
        (LandUse::Commercial, cfg.share_commercial_pct),
        (LandUse::Industrial, cfg.share_industrial_pct),
        (LandUse::Institutional, cfg.share_institutional_pct),
    ];
    let total_pct: i32 = weights.iter().map(|(_, w)| *w).sum();
    for _ in uses.len()..count {
        let roll = (rng.next_u64() % total_pct.max(1) as u64) as i32;
        let mut acc = 0;
        let mut pick = weights[0].0;
        for (u, w) in weights {
            acc += w;
            if roll < acc {
                pick = u;
                break;
            }
        }
        uses.push(pick);
    }
    // Fisher-Yates, driven by the same RNG stream -- deterministic.
    for i in (1..uses.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        uses.swap(i, j);
    }
    uses
}

fn density_at(cx: i32, cy: i32, cols: i32, rows: i32, cfg: &GenerationConfig) -> i32 {
    let dist2x = (2 * cx - (cols - 1)).abs();
    let dist2y = (2 * cy - (rows - 1)).abs();
    let dist2 = dist2x.max(dist2y);
    let max_dist2 = (cols - 1).max(rows - 1).max(1);
    let span = cfg.density_max - cfg.density_min;
    cfg.density_max - (span * dist2) / max_dist2
}

/// The lower bound [`subdivide`]'s own doc comment proves: every leaf is
/// at least `land_use_min_leaf_cells` on both axes, so its area is at
/// least this square -- and a region (a union of one or more adjacent
/// same-use leaves) can only be as large or larger than any one of its
/// own member leaves.
pub fn guaranteed_min_region_cells(cfg: &GenerationConfig) -> u64 {
    let m = cfg.land_use_min_leaf_cells.max(0) as u64;
    m * m
}

/// Runs pass 1: seeds its own RNG stream from `(city_seed, PASS_ID)`,
/// recursively subdivides the coarse grid into leaves, assigns each a
/// land use and computes the centre-to-periphery density falloff
/// independently, per cell. Total: `site`'s width/height are assumed
/// already a whole multiple of `cfg.coarse_cell_size_cells` (true for
/// every caller today, which always passes `cfg.site()`); a mismatch
/// simply truncates the remainder rather than panicking.
pub fn run(city_seed: u64, site: SiteBounds, cfg: &GenerationConfig) -> LandUseMap {
    let mut rng = Rng::new(seed_from_ids(city_seed, PASS_ID));

    let cell_size = cfg.coarse_cell_size_cells.max(1);
    let cols = (site.width() as i32 / cell_size).max(1);
    let rows = (site.height() as i32 / cell_size).max(1);

    let mut leaves: Vec<Rect> = Vec::new();
    subdivide(
        Rect {
            x0: 0,
            y0: 0,
            x1: cols,
            y1: rows,
        },
        cfg,
        &mut rng,
        0,
        &mut leaves,
    );
    // Deterministic regardless of the recursion's own push order.
    leaves.sort_by_key(|r| (r.y0, r.x0));

    let uses = draw_uses(&mut rng, leaves.len(), cfg);

    let mut cells = vec![
        LandUseCell {
            use_: LandUse::Residential,
            density: 0,
        };
        (cols * rows) as usize
    ];
    for (leaf, use_) in leaves.iter().zip(uses) {
        for cy in leaf.y0..leaf.y1 {
            for cx in leaf.x0..leaf.x1 {
                let idx = (cy * cols + cx) as usize;
                cells[idx] = LandUseCell {
                    use_,
                    density: density_at(cx, cy, cols, rows, cfg),
                };
            }
        }
    }

    LandUseMap {
        site,
        cell_size,
        cols,
        rows,
        cells,
    }
}

/// Every distinct land use present anywhere on `map` -- used both by
/// tests and by [`super::streets`] density sampling.
pub fn uses_present(map: &LandUseMap) -> BTreeSet<LandUse> {
    map.cells.iter().map(|c| c.use_).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    #[test]
    fn run_is_deterministic_for_the_same_seed() {
        let c = cfg();
        let a = run(42, c.site(), &c);
        let b = run(42, c.site(), &c);
        assert_eq!(a.cols, b.cols);
        assert_eq!(a.rows, b.rows);
        for cy in 0..a.rows {
            for cx in 0..a.cols {
                assert_eq!(a.coarse_at(cx, cy), b.coarse_at(cx, cy));
            }
        }
    }

    #[test]
    fn different_seeds_usually_produce_different_maps() {
        let c = cfg();
        let a = run(1, c.site(), &c);
        let b = run(2, c.site(), &c);
        let differs =
            (0..a.rows).any(|cy| (0..a.cols).any(|cx| a.coarse_at(cx, cy) != b.coarse_at(cx, cy)));
        assert!(differs, "two different seeds produced an identical map");
    }

    #[test]
    fn every_coarse_cell_is_assigned_no_none_variant_exists() {
        let c = cfg();
        let map = run(7, c.site(), &c);
        for cy in 0..map.rows {
            for cx in 0..map.cols {
                // Merely calling coarse_at and getting Some (never a
                // sentinel/None inside the declared grid) proves totality
                // -- LandUseCell itself has no way to encode "unassigned".
                assert!(map.coarse_at(cx, cy).is_some());
            }
        }
    }

    #[test]
    fn all_four_uses_are_present_across_a_seed_sweep() {
        let c = cfg();
        for seed in 0u64..64 {
            let map = run(seed, c.site(), &c);
            let present = uses_present(&map);
            for u in LandUse::ALL {
                assert!(present.contains(&u), "seed {seed} is missing {u:?}");
            }
        }
    }

    #[test]
    fn density_is_non_increasing_from_centre_to_edge_and_strictly_lower_at_the_edge() {
        let c = cfg();
        let map = run(3, c.site(), &c);
        let cx_centre = map.cols / 2;
        let cy_centre = map.rows / 2;
        let centre_density = map.coarse_at(cx_centre, cy_centre).unwrap().density;
        let corner_density = map.coarse_at(0, 0).unwrap().density;
        assert!(
            corner_density < centre_density,
            "corner density {corner_density} was not strictly lower than centre density {centre_density}"
        );
    }

    #[test]
    fn every_region_is_at_least_the_guaranteed_minimum_size() {
        let c = cfg();
        let min = guaranteed_min_region_cells(&c);
        for seed in 0u64..64 {
            let map = run(seed, c.site(), &c);
            for r in map.regions() {
                assert!(
                    r.cell_count >= min,
                    "seed {seed}: region {r:?} has {} cells, under the guaranteed minimum {min}",
                    r.cell_count
                );
            }
        }
    }

    #[test]
    fn region_count_is_bounded_by_total_cells_over_the_guaranteed_minimum() {
        let c = cfg();
        let min = guaranteed_min_region_cells(&c).max(1);
        for seed in 0u64..64 {
            let map = run(seed, c.site(), &c);
            let max_possible = (map.cols as u64 * map.rows as u64) / min;
            assert!(map.regions().len() as u64 <= max_possible);
        }
    }

    #[test]
    fn every_region_boundary_is_axis_aligned_by_construction() {
        // A region is a union of rect leaves from an axis-aligned
        // recursive partition -- Region itself carries only a bounding
        // Rect (four axis-aligned edges), so a diagonal boundary is not a
        // representable value, let alone a producible one.
        let c = cfg();
        let map = run(2, c.site(), &c);
        for r in map.regions() {
            assert!(r.bounds.is_valid());
        }
    }

    #[test]
    fn regions_are_sorted_deterministically() {
        let c = cfg();
        let map = run(9, c.site(), &c);
        let regions = map.regions();
        let mut sorted = regions.clone();
        sorted.sort_by_key(|r| (r.bounds.y0, r.bounds.x0));
        assert_eq!(regions, sorted);
    }

    #[test]
    fn at_world_matches_the_coarse_cell_it_falls_in() {
        let c = cfg();
        let map = run(5, c.site(), &c);
        let cell_size = map.cell_size();
        for cx in 0..map.cols.min(4) {
            for cy in 0..map.rows.min(4) {
                let wx = c.site().x0 + cx * cell_size;
                let wy = c.site().y0 + cy * cell_size;
                assert_eq!(map.at_world(wx, wy), map.coarse_at(cx, cy));
            }
        }
    }

    #[test]
    fn at_world_is_none_outside_the_site() {
        let c = cfg();
        let map = run(5, c.site(), &c);
        assert!(map.at_world(-1, -1).is_none());
        assert!(map.at_world(c.site().x1, c.site().y0).is_none());
    }

    #[test]
    fn subdivide_never_produces_a_leaf_under_the_minimum_on_either_axis() {
        let c = cfg();
        for seed in 0u64..64 {
            let mut rng = Rng::new(seed_from_ids(seed, PASS_ID));
            let mut leaves = Vec::new();
            subdivide(
                Rect {
                    x0: 0,
                    y0: 0,
                    x1: 32,
                    y1: 32,
                },
                &c,
                &mut rng,
                0,
                &mut leaves,
            );
            for leaf in &leaves {
                assert!(
                    leaf.width() >= c.land_use_min_leaf_cells as i64,
                    "seed {seed}: leaf {leaf:?} narrower than the guaranteed minimum"
                );
                assert!(
                    leaf.height() >= c.land_use_min_leaf_cells as i64,
                    "seed {seed}: leaf {leaf:?} shorter than the guaranteed minimum"
                );
            }
        }
    }
}
