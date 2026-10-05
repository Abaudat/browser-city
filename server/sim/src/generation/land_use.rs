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
//!
//! Use assignment reads the field rather than drawing blind: the
//! commercial core grows from the district nearest the density peak (so
//! it is never placed by chance on a starved cell), industrial grows as
//! one contiguous group anchored at a seeded site edge and refuses to
//! touch commercial, institutional is several small, mutually non-
//! adjacent pockets at the busiest internal boundaries -- never one
//! slab, "a school, a clinic and a town hall do not share a campus"
//! (Artie's direction, cycle 2) -- and residential takes the rest
//! (Artie's direction, cycle 1 -- "a factory district at the city's core
//! ... is not physically sensible").

use std::collections::BTreeSet;

use super::{GenerationConfig, SiteBounds, neighbourhoods, streets};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

pub const PASS_ID: u64 = super::PASS_LAND_USE;

/// The one dial value a hand-built [`LandUseMap::test_fixture`] carries --
/// a fixture has no config to take a mid-range from.
const FIXTURE_DIAL: i32 = 50;

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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LandUseCell {
    pub use_: LandUse,
    pub density: i32,
}

/// The four dials at one world point (FR113): the sim's own readable
/// quantities, never generator-private knobs. The gentrification loop
/// reads and later mutates these same fields. Land use and density come
/// from the coarse field; building age and affluence are constant across
/// the neighbourhood the point sits in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NeighbourhoodParams {
    pub use_: LandUse,
    pub density: i32,
    pub building_age: i32,
    pub affluence: i32,
}

/// A neighbourhood: the ground between arterials, with its two authored
/// dials. `bounds` is half-open, world-absolute.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Neighbourhood {
    pub bounds: Rect,
    pub building_age: i32,
    pub affluence: i32,
    /// Neighbourhoods narrower than the minimum patch span share a patch
    /// (and so their dials) with a neighbour: the lowest member's index.
    pub patch: usize,
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
    peak_cx: i32,
    peak_cy: i32,
    cells: Vec<LandUseCell>,
    neighbourhoods: Vec<Neighbourhood>,
}

impl LandUseMap {
    /// A hand-built map for a test fixture that needs known densities at
    /// known coarse cells -- `land_use::run`'s own seeded field cannot be
    /// steered to put a density in a specific band deterministically
    /// (the `RuleSet`-precedent test-only-constructor idiom `streets::
    /// StreetNetwork::test_fixture` already uses; `cells.len()` must be
    /// exactly `cols * rows`, row-major, same indexing `coarse_at` reads
    /// -- a caller's own contract, not checked here).
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn test_fixture(
        site: SiteBounds,
        cell_size: i32,
        cols: i32,
        rows: i32,
        peak_cx: i32,
        peak_cy: i32,
        cells: Vec<LandUseCell>,
    ) -> Self {
        Self {
            site,
            cell_size,
            cols,
            rows,
            peak_cx,
            peak_cy,
            cells,
            neighbourhoods: vec![Neighbourhood {
                bounds: site,
                building_age: FIXTURE_DIAL,
                affluence: FIXTURE_DIAL,
                patch: 0,
            }],
        }
    }

    /// Every neighbourhood, in `(y, x)` row order -- a partition of the
    /// site.
    pub fn neighbourhoods(&self) -> &[Neighbourhood] {
        &self.neighbourhoods
    }

    /// The neighbourhood containing world-absolute `(x, y)`, `None`
    /// outside [`Self::site`].
    pub fn neighbourhood_at(&self, x: i32, y: i32) -> Option<&Neighbourhood> {
        self.neighbourhoods
            .iter()
            .find(|n| x >= n.bounds.x0 && x < n.bounds.x1 && y >= n.bounds.y0 && y < n.bounds.y1)
    }

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

    /// How many coarse cells carry `use_`.
    pub fn area_cells(&self, use_: LandUse) -> i64 {
        self.cells.iter().filter(|c| c.use_ == use_).count() as i64
    }

    /// The first non-residential use whose realised area share (permille
    /// of the site) sits more than `share_tolerance_pct` points from its
    /// own `share_*_pct` key, with that share; `None` when every use is
    /// inside its band. The pass-1 guard for what the share keys mean.
    pub fn share_band_violation(&self, cfg: &GenerationConfig) -> Option<(LandUse, i64)> {
        let total = self.cols as i64 * self.rows as i64;
        [
            (LandUse::Commercial, cfg.share_commercial_pct),
            (LandUse::Industrial, cfg.share_industrial_pct),
            (LandUse::Institutional, cfg.share_institutional_pct),
        ]
        .into_iter()
        .find_map(|(u, key)| {
            let permille = self.area_cells(u) * 1000 / total.max(1);
            let off = (permille - key as i64 * 10).abs();
            (off > cfg.share_tolerance_pct as i64 * 10).then_some((u, permille))
        })
    }

    /// The density field's own peak, in coarse-grid coordinates --
    /// seeded and offset from the grid's geometric centre (NFR8, Artie's
    /// direction). Exposed so evidence rendering and ring-based tests
    /// never have to assume it sits at `(cols/2, rows/2)`.
    pub fn density_peak(&self) -> (i32, i32) {
        (self.peak_cx, self.peak_cy)
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

    /// The four dials at world-absolute `(x, y)`, `None` outside
    /// [`Self::site`].
    pub fn at_world(&self, x: i32, y: i32) -> Option<NeighbourhoodParams> {
        if !self.site.contains(x, y) {
            return None;
        }
        let cx = (x - self.site.x0) / self.cell_size;
        let cy = (y - self.site.y0) / self.cell_size;
        let cell = self.coarse_at(cx, cy)?;
        let hood = self.neighbourhood_at(x, y)?;
        Some(NeighbourhoodParams {
            use_: cell.use_,
            density: cell.density,
            building_age: hood.building_age,
            affluence: hood.affluence,
        })
    }

    /// Every 4-connected component of equal land use, sorted by
    /// `(bounds.y0, bounds.x0)` (deterministic, never iteration order).
    /// A thin wrapper over [`Self::labeled_regions`], which does the real
    /// work (an explicit-stack, never-recursive flood fill -- `world::
    /// walkability`'s own idiom, over land-use equality rather than a
    /// passability bitset).
    pub fn regions(&self) -> Vec<Region> {
        self.labeled_regions().0
    }

    /// [`Self::regions`], plus a `cols * rows` label array (same indexing
    /// as [`Self::coarse_at`]'s own arithmetic, `-1` never occurs) so a
    /// caller can walk a specific region's own real cells -- not merely
    /// its bounding rect, which can cover ground an L-shaped region does
    /// not own (Tim/Quentin's direction, cycle 1: `stranded_regions`
    /// needs this to judge a region by its own cells).
    pub fn labeled_regions(&self) -> (Vec<Region>, Vec<i32>) {
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
                let label = found.len() as i32;
                labels[start] = label;
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
                        labels[nidx] = label;
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

        // `found` is currently in raster-scan order; `regions()`'s own
        // contract sorts by (y0, x0) -- remap every label so the two stay
        // in agreement (index i of the returned Vec is exactly label i).
        let mut order: Vec<usize> = (0..found.len()).collect();
        order.sort_by_key(|&i| (found[i].bounds.y0, found[i].bounds.x0));
        let mut new_label_of = vec![0i32; found.len()];
        for (new_label, &old_label) in order.iter().enumerate() {
            new_label_of[old_label] = new_label as i32;
        }
        let sorted: Vec<Region> = order.iter().map(|&i| found[i]).collect();
        for l in &mut labels {
            *l = new_label_of[*l as usize];
        }
        (sorted, labels)
    }

    /// Buckets every coarse cell by Chebyshev distance from
    /// [`Self::density_peak`] into `num_rings` equal-width concentric
    /// bands (ring 0 innermost) and returns each ring's own mean density
    /// -- what `NFR8`'s falloff actually claims (non-increasing ring by
    /// ring, strictly lower at the outermost), not a two-point sample at
    /// an arbitrary "centre"/"corner". `num_rings` must be at least 1;
    /// with 0 this returns an empty vec rather than dividing by zero.
    pub fn ring_averages(&self, num_rings: usize) -> Vec<i64> {
        if num_rings == 0 {
            return Vec::new();
        }
        let max_dist = farthest_corner_distance(self.peak_cx, self.peak_cy, self.cols, self.rows)
            .max(1) as i64;
        let mut sums = vec![0i64; num_rings];
        let mut counts = vec![0i64; num_rings];
        for cy in 0..self.rows {
            for cx in 0..self.cols {
                let d = chebyshev(cx, cy, self.peak_cx, self.peak_cy) as i64;
                let ring = ((d * num_rings as i64) / (max_dist + 1)).clamp(0, num_rings as i64 - 1);
                let cell = self
                    .coarse_at(cx, cy)
                    .expect("cx/cy are in-bounds by loop range");
                sums[ring as usize] += cell.density as i64;
                counts[ring as usize] += 1;
            }
        }
        sums.iter()
            .zip(counts.iter())
            .map(|(&s, &c)| if c > 0 { s / c } else { 0 })
            .collect()
    }
}

fn chebyshev(ax: i32, ay: i32, bx: i32, by: i32) -> i32 {
    (ax - bx).abs().max((ay - by).abs())
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
        rng.below(2 * jitter_span as u64 + 1) as i32 - jitter_span
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

/// The lower bound [`subdivide`]'s own doc comment proves: every leaf is
/// at least `land_use_min_leaf_cells` on both axes, so its area is at
/// least this square -- and a region (a union of one or more adjacent
/// same-use leaves) can only be as large or larger than any one of its
/// own member leaves.
pub fn guaranteed_min_region_cells(cfg: &GenerationConfig) -> u64 {
    let m = cfg.land_use_min_leaf_cells.max(0) as u64;
    m * m
}

// --- the density field --------------------------------------------------

fn farthest_corner_distance(peak_cx: i32, peak_cy: i32, cols: i32, rows: i32) -> i32 {
    [(0, 0), (cols - 1, 0), (0, rows - 1), (cols - 1, rows - 1)]
        .into_iter()
        .map(|(x, y)| chebyshev(x, y, peak_cx, peak_cy))
        .max()
        .unwrap_or(1)
}

/// One signed offset magnitude, drawn independently per axis: a percent
/// in `[density_peak_offset_min_pct, density_peak_offset_max_pct]` of
/// `half`, with an independently seeded sign -- guarantees a real,
/// non-zero displacement on both axes (never a peak that happens to
/// land back on the geometric centre), so the falloff reads as
/// asymmetric on every seed, not just most of them.
fn peak_offset(rng: &mut Rng, half: i32, cfg: &GenerationConfig) -> i32 {
    let span = (cfg.density_peak_offset_max_pct - cfg.density_peak_offset_min_pct).max(0);
    let pct = cfg.density_peak_offset_min_pct + rng.below(span as u64 + 1) as i32;
    let magnitude = (half * pct) / 100;
    let sign = if rng.below(2) == 0 { 1 } else { -1 };
    sign * magnitude
}

fn density_peak(rng: &mut Rng, cols: i32, rows: i32, cfg: &GenerationConfig) -> (i32, i32) {
    let centre_x = (cols - 1) / 2;
    let centre_y = (rows - 1) / 2;
    let peak_x = (centre_x + peak_offset(rng, cols / 2, cfg)).clamp(0, cols - 1);
    let peak_y = (centre_y + peak_offset(rng, rows / 2, cfg)).clamp(0, rows - 1);
    (peak_x, peak_y)
}

fn density_at(
    cx: i32,
    cy: i32,
    peak_cx: i32,
    peak_cy: i32,
    cols: i32,
    rows: i32,
    cfg: &GenerationConfig,
) -> i32 {
    let dist = chebyshev(cx, cy, peak_cx, peak_cy);
    let max_dist = farthest_corner_distance(peak_cx, peak_cy, cols, rows).max(1);
    let span = cfg.density_max - cfg.density_min;
    cfg.density_max - (span * dist) / max_dist
}

// --- use assignment, field-driven ---------------------------------------

fn leaf_center(r: Rect) -> (i32, i32) {
    ((r.x0 + r.x1 - 1) / 2, (r.y0 + r.y1 - 1) / 2)
}

fn chebyshev_to_leaf(r: Rect, tx: i32, ty: i32) -> i32 {
    let (cx, cy) = leaf_center(r);
    chebyshev(cx, cy, tx, ty)
}

/// Two leaves are adjacent iff they share a real edge segment (not just a
/// corner point) -- the graph [`grow_contiguous`]/[`grow_contiguous_
/// avoiding`] walk.
fn leaves_touch(a: Rect, b: Rect) -> bool {
    let touch_vertical = (a.x1 == b.x0 || b.x1 == a.x0) && a.y0.max(b.y0) < a.y1.min(b.y1);
    let touch_horizontal = (a.y1 == b.y0 || b.y1 == a.y0) && a.x0.max(b.x0) < a.x1.min(b.x1);
    touch_vertical || touch_horizontal
}

/// [`leaves_touch`]'s own stronger relation: also true for two leaves
/// that share only a corner. Institutional pockets must stay clear of
/// each other by this relation ("no two components touching, including
/// diagonally", Artie's direction, cycle 3); every other land use's own
/// adjacency rule stays the weaker, edge-only [`leaves_touch`].
fn leaves_touch_including_diagonal(a: Rect, b: Rect) -> bool {
    a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
}

/// Whether leaf `idx` touches (edge or corner) any leaf already assigned
/// [`LandUse::Institutional`] other than `exclude` (its own pocket's own
/// seed, when checking a pocket's second leaf; `idx` itself otherwise).
/// `O(leaves.len())` -- institutional leaves are a small minority of a
/// small total, and this only ever runs while assigning them.
fn touches_institutional_other_than(
    idx: usize,
    exclude: usize,
    leaves: &[Rect],
    assigned: &[Option<LandUse>],
) -> bool {
    (0..leaves.len()).any(|j| {
        j != idx
            && j != exclude
            && assigned[j] == Some(LandUse::Institutional)
            && leaves_touch_including_diagonal(leaves[idx], leaves[j])
    })
}

fn leaf_adjacency(leaves: &[Rect]) -> Vec<Vec<usize>> {
    let n = leaves.len();
    let mut adjacency = vec![Vec::new(); n];
    for i in 0..n {
        for j in (i + 1)..n {
            if leaves_touch(leaves[i], leaves[j]) {
                adjacency[i].push(j);
                adjacency[j].push(i);
            }
        }
    }
    adjacency
}

fn nearest_leaf_to(leaves: &[Rect], tx: i32, ty: i32) -> usize {
    (0..leaves.len())
        .min_by_key(|&i| (chebyshev_to_leaf(leaves[i], tx, ty), i))
        .expect("leaves is never empty: at least one leaf always exists")
}

/// Institutional's own area share, taken from the smallest leaves, can
/// still fall short of enough leaves for [`assign_institutional`]'s own
/// "at least three pockets" bar (Artie's direction, cycle 3). A leaf-count
/// floor, scaled down for a
/// small total rather than a fixed number that could starve every other
/// use on one: `min(6, total / 3)`.
fn institutional_leaf_floor(total: usize) -> usize {
    6.min(total / 3)
}

/// One use's growth rule, stated once and shared by [`grow_contiguous`],
/// [`grow_contiguous_avoiding`] and [`assign_institutional`]: a use grows
/// while its claimed area is under its target, and takes the next leaf
/// only if that leaf brings the claimed area closer to the target than
/// stopping would (`2 * claimed + leaf <= 2 * target`), so the overshoot
/// is at most half a leaf. A use's first leaf is always taken.
fn takes_leaf(claimed: i64, leaf: i64, target: i64) -> bool {
    claimed == 0 || 2 * claimed + leaf <= 2 * target
}

fn leaf_area(r: Rect) -> i64 {
    r.width() * r.height()
}

/// Per-use area targets in coarse cells, one per [`LandUse::ALL`] entry
/// in the same order: `round(total_cells * share / 100)` (minimum 1 once
/// `total_cells >= 4`, so every use is seeded); residential (`ALL[0]`)
/// is the remainder, so the four targets sum to exactly `total_cells`.
/// The `share_*_pct` keys are area shares of the site.
fn target_cells(total_cells: i64, cfg: &GenerationConfig) -> [i64; 4] {
    let shares = [
        cfg.share_residential_pct,
        cfg.share_commercial_pct,
        cfg.share_industrial_pct,
        cfg.share_institutional_pct,
    ];
    let floor = if total_cells >= 4 { 1 } else { 0 };
    let mut targets = [0i64; 4];
    let mut assigned = 0i64;
    for i in 1..4 {
        let want = (total_cells * shares[i] as i64 + 50) / 100;
        let cap = (total_cells - assigned - (4 - i as i64)).max(floor);
        targets[i] = want.clamp(floor, cap);
        assigned += targets[i];
    }
    targets[0] = total_cells - assigned;
    targets
}

/// Grows `use_` from `seed` over `adjacency`, preferring the frontier
/// candidate nearest `(target_cx, target_cy)` first (so commercial grows
/// toward the density peak, i.e. toward higher density, rather than in
/// an arbitrary direction) -- falls back to the nearest unassigned leaf
/// anywhere once the contiguous frontier is exhausted, so `target` is
/// always reached (bounded: at most `leaves.len()` iterations). `target`
/// is in coarse cells and growth follows [`takes_leaf`].
#[allow(clippy::too_many_arguments)]
fn grow_contiguous(
    seed: usize,
    target: i64,
    leaves: &[Rect],
    adjacency: &[Vec<usize>],
    assigned: &mut [Option<LandUse>],
    use_: LandUse,
    target_cx: i32,
    target_cy: i32,
) {
    if target == 0 {
        return;
    }
    assigned[seed] = Some(use_);
    let mut claimed = leaf_area(leaves[seed]);
    let mut frontier: Vec<usize> = adjacency[seed]
        .iter()
        .copied()
        .filter(|&i| assigned[i].is_none())
        .collect();
    while claimed < target {
        frontier.retain(|&i| assigned[i].is_none());
        if frontier.is_empty() {
            let Some(next) = (0..leaves.len())
                .filter(|&i| assigned[i].is_none())
                .min_by_key(|&i| (chebyshev_to_leaf(leaves[i], target_cx, target_cy), i))
            else {
                return;
            };
            if !takes_leaf(claimed, leaf_area(leaves[next]), target) {
                return;
            }
            assigned[next] = Some(use_);
            claimed += leaf_area(leaves[next]);
            frontier.extend(
                adjacency[next]
                    .iter()
                    .copied()
                    .filter(|&i| assigned[i].is_none()),
            );
            continue;
        }
        frontier.sort_by_key(|&i| (chebyshev_to_leaf(leaves[i], target_cx, target_cy), i));
        let next = frontier.remove(0);
        if assigned[next].is_some() {
            continue;
        }
        if !takes_leaf(claimed, leaf_area(leaves[next]), target) {
            return;
        }
        assigned[next] = Some(use_);
        claimed += leaf_area(leaves[next]);
        for &nb in &adjacency[next] {
            if assigned[nb].is_none() {
                frontier.push(nb);
            }
        }
    }
}

fn leaf_touches_use(
    idx: usize,
    adjacency: &[Vec<usize>],
    assigned: &[Option<LandUse>],
    other: LandUse,
) -> bool {
    adjacency[idx].iter().any(|&n| assigned[n] == Some(other))
}

/// [`grow_contiguous`]'s own industrial variant: never grows into, or
/// adjacent to, a leaf already carrying `avoid` (Artie's direction --
/// industrial is "never touching the commercial core directly"). Falls
/// back to the nearest unblocked leaf anywhere in the site once the
/// contiguous frontier is exhausted (the same fallback [`grow_
/// contiguous`] uses), but -- unlike that function -- never falls back
/// further than that: if *no* unblocked leaf exists anywhere, growth
/// simply stops short of `target` rather than reaching for the nearest
/// leaf regardless of whether it touches `avoid`. "Never touches
/// commercial" is the harder, unconditional constraint here; a target
/// target is only ever the aspiration `target_cells` computes, and
/// leaving a district unassigned by this pass falls back to residential
/// at the end of [`assign_uses`] -- fewer industrial districts than
/// asked for is an acceptable trade, industrial touching commercial is
/// not. (An earlier version of this function *did* fall back to
/// "any unassigned leaf, constraint or not" here -- found violating the
/// constraint by `inv_generation_industrial_never_touches_commercial`
/// only once proptest ran enough cases to hit a seed where commercial's
/// own growth left industrial's own target edge with no unblocked leaf
/// left near it.)
fn grow_contiguous_avoiding(
    seed: usize,
    target: i64,
    leaves: &[Rect],
    adjacency: &[Vec<usize>],
    assigned: &mut [Option<LandUse>],
    use_: LandUse,
    avoid: LandUse,
) {
    if target == 0 {
        return;
    }
    let (seed_cx, seed_cy) = leaf_center(leaves[seed]);
    assigned[seed] = Some(use_);
    let mut claimed = leaf_area(leaves[seed]);
    let unblocked_unassigned = |i: usize, assigned: &[Option<LandUse>]| {
        assigned[i].is_none() && !leaf_touches_use(i, adjacency, assigned, avoid)
    };
    let mut frontier: Vec<usize> = adjacency[seed]
        .iter()
        .copied()
        .filter(|&i| unblocked_unassigned(i, assigned))
        .collect();
    while claimed < target {
        frontier.retain(|&i| unblocked_unassigned(i, assigned));
        if frontier.is_empty() {
            let Some(next) = (0..leaves.len())
                .filter(|&i| unblocked_unassigned(i, assigned))
                .min_by_key(|&i| (chebyshev_to_leaf(leaves[i], seed_cx, seed_cy), i))
            else {
                return;
            };
            if !takes_leaf(claimed, leaf_area(leaves[next]), target) {
                return;
            }
            assigned[next] = Some(use_);
            claimed += leaf_area(leaves[next]);
            frontier.extend(
                adjacency[next]
                    .iter()
                    .copied()
                    .filter(|&i| unblocked_unassigned(i, assigned)),
            );
            continue;
        }
        frontier.sort_by_key(|&i| (chebyshev_to_leaf(leaves[i], seed_cx, seed_cy), i));
        let next = frontier.remove(0);
        if !unblocked_unassigned(next, assigned) {
            continue;
        }
        if !takes_leaf(claimed, leaf_area(leaves[next]), target) {
            return;
        }
        assigned[next] = Some(use_);
        claimed += leaf_area(leaves[next]);
        for &nb in &adjacency[next] {
            if unblocked_unassigned(nb, assigned) {
                frontier.push(nb);
            }
        }
    }
}

/// Every pocket [`assign_institutional`] grows is at most this many
/// leaves -- Artie's direction, cycle 2: "a school, a clinic and a town
/// hall do not share a campus", never one slab.
const INSTITUTIONAL_POCKET_MAX_LEAVES: usize = 2;

/// No leaf over this own area (coarse cells) is ever taken for
/// institutional -- Artie's direction, cycle 3: "no component above
/// roughly 2.5% of the site (about 6,500 cells -- two minimum leaves)".
/// A single leaf at `land_use_max_leaf_cells` alone can already exceed
/// that on its own, so "smallest available" is not enough by itself;
/// this is the structural bound that makes the 2.5% component cap hold
/// regardless of which leaves happen to still be unassigned by the time
/// institutional's own turn comes. `min * (min + 1)`, not `min * min`:
/// measured at 3,000 seeds, the exact-minimum square left too few
/// eligible leaves (19.7% of seeds under three pockets); one step
/// looser keeps 99%+ of seeds at three or more while the worst measured
/// component still lands under 2.5% (2.3%).
fn institutional_max_leaf_area(cfg: &GenerationConfig) -> i64 {
    let min = cfg.land_use_min_leaf_cells as i64;
    min * (min + 1)
}

/// What [`assign_institutional`] still has to place: an area target
/// (coarse cells, [`takes_leaf`]'s rule) and a leaf-count floor
/// ([`institutional_leaf_floor`]); a leaf is wanted until both are met.
struct InstitutionalBudget {
    target_cells: i64,
    min_leaves: usize,
    claimed_cells: i64,
    leaves: usize,
}

impl InstitutionalBudget {
    fn wants_more(&self) -> bool {
        self.claimed_cells < self.target_cells || self.leaves < self.min_leaves
    }

    fn accepts(&self, leaf: i64) -> bool {
        self.wants_more()
            && (self.leaves < self.min_leaves
                || takes_leaf(self.claimed_cells, leaf, self.target_cells))
    }

    fn claim(&mut self, leaf: i64) {
        self.claimed_cells += leaf;
        self.leaves += 1;
    }
}

/// One [`assign_institutional`] pocket-seed search, `max_area` the only
/// difference between the strict and relaxed passes.
fn institutional_seed_candidate(
    leaves: &[Rect],
    adjacency: &[Vec<usize>],
    assigned: &[Option<LandUse>],
    max_area: i64,
) -> Option<usize> {
    (0..leaves.len())
        .filter(|&i| assigned[i].is_none())
        .filter(|&i| leaves[i].width() * leaves[i].height() <= max_area)
        .filter(|&i| !touches_institutional_other_than(i, usize::MAX, leaves, assigned))
        .min_by_key(|&i| {
            let area = leaves[i].width() * leaves[i].height();
            let mut distinct = BTreeSet::new();
            for &n in &adjacency[i] {
                if let Some(u) = assigned[n] {
                    distinct.insert(u);
                }
            }
            (area, std::cmp::Reverse(distinct.len()), i)
        })
}

/// Grows one pocket from `seed`, up to [`INSTITUTIONAL_POCKET_MAX_LEAVES`]
/// total, each further leaf under `max_area` and never touching a
/// *different* pocket. Returns how many leaves it placed (at least 1).
fn institutional_grow_pocket(
    leaves: &[Rect],
    adjacency: &[Vec<usize>],
    assigned: &mut [Option<LandUse>],
    seed: usize,
    max_area: i64,
    max_pocket_leaves: usize,
    budget: &mut InstitutionalBudget,
) -> usize {
    assigned[seed] = Some(LandUse::Institutional);
    budget.claim(leaf_area(leaves[seed]));
    let mut pocket_size = 1;
    while pocket_size < max_pocket_leaves && budget.wants_more() {
        let extra = adjacency[seed]
            .iter()
            .copied()
            .filter(|&i| assigned[i].is_none())
            .filter(|&i| leaves[i].width() * leaves[i].height() <= max_area)
            .filter(|&i| !touches_institutional_other_than(i, seed, leaves, assigned))
            .min_by_key(|&i| (leaves[i].width() * leaves[i].height(), i));
        let Some(extra) = extra else { break };
        if !budget.accepts(leaf_area(leaves[extra])) {
            break;
        }
        assigned[extra] = Some(LandUse::Institutional);
        budget.claim(leaf_area(leaves[extra]));
        pocket_size += 1;
    }
    pocket_size
}

/// Assigns `target` institutional leaves as several small, mutually
/// non-adjacent pockets (never one contiguous slab, Artie's direction,
/// cycle 2), each at most [`INSTITUTIONAL_POCKET_MAX_LEAVES`] leaves and
/// each leaf under [`institutional_max_leaf_area`]: a new pocket's own
/// seed picks the smallest eligible leaf first ("small districts, not
/// 10x10 slabs" -- Artie's direction, cycle 3: ranking by "busiest
/// boundary" first and size only as a tie-break was picking the
/// *biggest* leaves wedged between two other districts, exactly the
/// campus-sized slab this pass exists to avoid), tie-broken toward the
/// leaf with the most distinct already-assigned neighbouring uses (a
/// proxy for "sits where districts meet" -- streets 2 lays arterials
/// along major land-use boundaries, so this is what puts institutional
/// beside them without pass 1 knowing a street coordinate); a pocket's
/// own second leaf, if the cap allows one, is the smallest eligible
/// neighbour of the seed. Every candidate, seed or second leaf, is
/// filtered against every *other* already-placed institutional leaf by
/// [`leaves_touch_including_diagonal`] (Artie's direction, cycle 3: "no
/// two components touching, including diagonally") -- checked for every
/// leaf a pocket takes, not only its own seed, since a pocket's own
/// second leaf sitting next to a *different* pocket would otherwise fuse
/// the two despite each seed choice individually respecting
/// non-adjacency.
///
/// If the strict (small-leaf) pass alone would leave the site under
/// [`GenerationConfig::institutional_min_pockets`] pockets, a second pass
/// with no area cap (still respecting non-adjacency) places one more
/// pocket at a time until the floor is met or no eligible leaf remains
/// at all -- a handful of seeds have too few genuinely small, mutually
/// non-adjacent leaves for the strict pass alone to reach the floor, and
/// the floor is a harder requirement than "small" when the two are ever
/// in tension.
///
/// "Each pocket touches an arterial" is Artie's own further ask, and is
/// not enforced here: pass 1 authors the land-use field before pass 2
/// lays a single street, so nothing in this module can know where an
/// arterial will fall (FR110's own ordering) -- a genuine architectural
/// boundary, not a shortcut (Artie's direction, cycle 3: withdrawn as a
/// requirement for exactly this reason).
fn assign_institutional(
    leaves: &[Rect],
    adjacency: &[Vec<usize>],
    assigned: &mut [Option<LandUse>],
    target_cells: i64,
    cfg: &GenerationConfig,
) {
    let max_area = institutional_max_leaf_area(cfg);
    let mut budget = InstitutionalBudget {
        target_cells,
        min_leaves: institutional_leaf_floor(leaves.len()),
        claimed_cells: 0,
        leaves: 0,
    };
    let mut pockets = 0usize;
    while budget.wants_more() {
        let Some(seed) = institutional_seed_candidate(leaves, adjacency, assigned, max_area) else {
            break;
        };
        if !budget.accepts(leaf_area(leaves[seed])) {
            break;
        }
        institutional_grow_pocket(
            leaves,
            adjacency,
            assigned,
            seed,
            max_area,
            INSTITUTIONAL_POCKET_MAX_LEAVES,
            &mut budget,
        );
        pockets += 1;
    }
    // The fallback pass caps each pocket at a single leaf (never the
    // usual two): a relaxed-cap seed can already be close to the area
    // ceiling on its own, and a second relaxed-cap leaf next to it can
    // push a single component well past it (measured: two near-maximum
    // leaves reached 6.7% of the site before this cap existed).
    while pockets < cfg.institutional_min_pockets as usize && budget.wants_more() {
        let Some(seed) = institutional_seed_candidate(leaves, adjacency, assigned, i64::MAX) else {
            break;
        };
        institutional_grow_pocket(leaves, adjacency, assigned, seed, i64::MAX, 1, &mut budget);
        pockets += 1;
    }
}

#[derive(Clone, Copy)]
enum Edge {
    North,
    South,
    East,
    West,
}

fn pick_edge(rng: &mut Rng) -> Edge {
    match rng.below(4) {
        0 => Edge::North,
        1 => Edge::South,
        2 => Edge::East,
        _ => Edge::West,
    }
}

fn edge_target_point(edge: Edge, cols: i32, rows: i32) -> (i32, i32) {
    match edge {
        Edge::North => (cols / 2, 0),
        Edge::South => (cols / 2, rows - 1),
        Edge::East => (cols - 1, rows / 2),
        Edge::West => (0, rows / 2),
    }
}

/// Assigns every leaf a [`LandUse`], field-driven rather than a blind
/// weighted draw (Artie's direction, cycle 1): commercial grows from the
/// leaf nearest the density peak toward higher density; industrial grows
/// as one contiguous group from a seeded site edge, never touching
/// commercial; institutional takes several small, non-adjacent pockets
/// of the smallest, most-boundary-adjacent remaining leaves; residential
/// takes the rest. Targets ([`target_cells`]) are area shares of the site
/// in coarse cells, grown by [`takes_leaf`]'s one rule, so every use is
/// present whenever `leaves.len() >= 4`.
fn assign_uses(
    rng: &mut Rng,
    leaves: &[Rect],
    peak_cx: i32,
    peak_cy: i32,
    cols: i32,
    rows: i32,
    cfg: &GenerationConfig,
) -> Vec<LandUse> {
    let n = leaves.len();
    let adjacency = leaf_adjacency(leaves);
    let mut assigned: Vec<Option<LandUse>> = vec![None; n];
    let total_cells: i64 = leaves.iter().map(|&r| leaf_area(r)).sum();
    let targets = target_cells(total_cells, cfg);

    let commercial_seed = nearest_leaf_to(leaves, peak_cx, peak_cy);
    grow_contiguous(
        commercial_seed,
        targets[1],
        leaves,
        &adjacency,
        &mut assigned,
        LandUse::Commercial,
        peak_cx,
        peak_cy,
    );

    let edge = pick_edge(rng);
    let (edge_x, edge_y) = edge_target_point(edge, cols, rows);
    let industrial_seed = (0..n)
        .filter(|&i| {
            assigned[i].is_none()
                && !leaf_touches_use(i, &adjacency, &assigned, LandUse::Commercial)
        })
        .min_by_key(|&i| (chebyshev_to_leaf(leaves[i], edge_x, edge_y), i));
    // "Never touches commercial" is unconditional (see `grow_contiguous_
    // avoiding`'s own doc comment) -- if not even a seed exists anywhere
    // that avoids it, industrial is left unseeded rather than seeded in
    // violation of it; every leaf it would otherwise have taken falls
    // back to residential at this function's own end.
    if let Some(industrial_seed) = industrial_seed {
        grow_contiguous_avoiding(
            industrial_seed,
            targets[2],
            leaves,
            &adjacency,
            &mut assigned,
            LandUse::Industrial,
            LandUse::Commercial,
        );
    }

    assign_institutional(leaves, &adjacency, &mut assigned, targets[3], cfg);

    assigned
        .into_iter()
        .map(|o| o.unwrap_or(LandUse::Residential))
        .collect()
}

/// Runs pass 1: seeds its own RNG stream from `(city_seed, PASS_ID)`,
/// recursively subdivides the coarse grid into leaves, assigns each a
/// land use (field-driven, see [`assign_uses`]) and computes the
/// off-centre density falloff independently, per cell. `Err`, never a
/// silent truncation, if `site`'s width/height is not a whole multiple of
/// `cfg.coarse_cell_size_cells` -- a generator must never quietly leave
/// cells unowned.
pub fn run(
    city_seed: u64,
    site: SiteBounds,
    cfg: &GenerationConfig,
) -> Result<LandUseMap, super::GenerationError> {
    let cell_size = cfg.coarse_cell_size_cells.max(1);
    if site.width() % cell_size as i64 != 0 || site.height() % cell_size as i64 != 0 {
        return Err(super::GenerationError::InvalidSite {
            site,
            coarse_cell_size_cells: cell_size,
        });
    }

    let mut rng = Rng::new(seed_from_ids(city_seed, PASS_ID));

    let cols = (site.width() as i32 / cell_size).max(1);
    let rows = (site.height() as i32 / cell_size).max(1);

    let (peak_cx, peak_cy) = density_peak(&mut rng, cols, rows, cfg);

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

    let uses = assign_uses(&mut rng, &leaves, peak_cx, peak_cy, cols, rows, cfg);

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
                    density: density_at(cx, cy, peak_cx, peak_cy, cols, rows, cfg),
                };
            }
        }
    }

    // The neighbourhoods and their dials: authored from their own keyed
    // streams, after (and never perturbing) the draws above.
    let hoods: Vec<neighbourhoods::HoodInput> = streets::neighbourhood_rects(city_seed, site, cfg)
        .into_iter()
        .map(|bounds| {
            let mut residential_cells = 0i64;
            for cy in 0..rows {
                for cx in 0..cols {
                    let (wx, wy) = (
                        site.x0 + cx * cell_size + cell_size / 2,
                        site.y0 + cy * cell_size + cell_size / 2,
                    );
                    let inside =
                        wx >= bounds.x0 && wx < bounds.x1 && wy >= bounds.y0 && wy < bounds.y1;
                    if inside && cells[(cy * cols + cx) as usize].use_ == LandUse::Residential {
                        residential_cells += 1;
                    }
                }
            }
            neighbourhoods::HoodInput {
                bounds,
                residential_cells,
            }
        })
        .collect();
    let authored = neighbourhoods::author(city_seed, &hoods, &cfg.neighbourhood);
    let neighbourhoods = hoods
        .iter()
        .zip(authored.dials.iter().zip(authored.patch.iter()))
        .map(|(h, (d, &patch))| Neighbourhood {
            bounds: h.bounds,
            building_age: d.building_age,
            affluence: d.affluence,
            patch,
        })
        .collect();

    Ok(LandUseMap {
        site,
        cell_size,
        cols,
        rows,
        peak_cx,
        peak_cy,
        cells,
        neighbourhoods,
    })
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

    fn run_ok(seed: u64, c: &GenerationConfig) -> LandUseMap {
        run(seed, c.site(), c).expect("a config-native site must always build")
    }

    #[test]
    fn run_is_deterministic_for_the_same_seed() {
        let c = cfg();
        let a = run_ok(42, &c);
        let b = run_ok(42, &c);
        assert_eq!(a.cols, b.cols);
        assert_eq!(a.rows, b.rows);
        assert_eq!(a.density_peak(), b.density_peak());
        for cy in 0..a.rows {
            for cx in 0..a.cols {
                assert_eq!(a.coarse_at(cx, cy), b.coarse_at(cx, cy));
            }
        }
    }

    #[test]
    fn different_seeds_usually_produce_different_maps() {
        let c = cfg();
        let a = run_ok(1, &c);
        let b = run_ok(2, &c);
        let differs =
            (0..a.rows).any(|cy| (0..a.cols).any(|cx| a.coarse_at(cx, cy) != b.coarse_at(cx, cy)));
        assert!(differs, "two different seeds produced an identical map");
    }

    #[test]
    fn run_rejects_a_site_not_a_multiple_of_the_coarse_cell_size() {
        let c = cfg();
        let bad_site = SiteBounds {
            x0: 0,
            y0: 0,
            x1: 500,
            y1: 512,
        };
        let err = run(1, bad_site, &c).unwrap_err();
        assert!(matches!(
            err,
            super::super::GenerationError::InvalidSite { site, .. } if site == bad_site
        ));
    }

    #[test]
    fn every_coarse_cell_is_assigned_no_none_variant_exists() {
        let c = cfg();
        let map = run_ok(7, &c);
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
            let map = run_ok(seed, &c);
            let present = uses_present(&map);
            for u in LandUse::ALL {
                assert!(present.contains(&u), "seed {seed} is missing {u:?}");
            }
        }
    }

    /// Every coarse cell belongs to exactly one region, and residential
    /// (the remainder) is never given a smaller share key than another use.
    #[test]
    fn regions_tile_the_grid_and_residential_holds_the_largest_share() {
        let c = cfg();
        for seed in 0u64..64 {
            let map = run_ok(seed, &c);
            let regions = map.regions();
            let total_leaf_cells: u64 = regions.iter().map(|r| r.cell_count).sum();
            assert_eq!(total_leaf_cells, (map.cols * map.rows) as u64);
            // Residential takes the remainder of `target_cells`, and every
            // share key is <= its own.
            assert!(c.share_residential_pct >= c.share_commercial_pct);
            assert!(c.share_residential_pct >= c.share_industrial_pct);
            assert!(c.share_residential_pct >= c.share_institutional_pct);
        }
    }

    /// Artie's direction: industrial is never adjacent to commercial --
    /// checked over each region's own real (4-connected) cells, the same
    /// adjacency notion `leaves_touch`/`regions()`'s own flood fill use,
    /// never a bounding-box dilation (which also catches a region's own
    /// non-owned corners for an L-shaped region, over-strict relative to
    /// what the generator actually avoids).
    #[test]
    fn industrial_never_touches_commercial_across_a_seed_sweep() {
        let c = cfg();
        for seed in 0u64..64 {
            let map = run_ok(seed, &c);
            let (regions, labels) = map.labeled_regions();
            for (label, r) in regions.iter().enumerate() {
                if r.use_ != LandUse::Industrial {
                    continue;
                }
                for cy in r.bounds.y0..r.bounds.y1 {
                    for cx in r.bounds.x0..r.bounds.x1 {
                        if labels[(cy * map.cols() + cx) as usize] != label as i32 {
                            continue;
                        }
                        for (nx, ny) in [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)] {
                            if let Some(cell) = map.coarse_at(nx, ny) {
                                assert_ne!(
                                    cell.use_,
                                    LandUse::Commercial,
                                    "seed {seed}: industrial region {r:?} touches commercial at ({nx},{ny})"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /// Artie's direction / NFR8: the falloff is never a perfect
    /// concentric square centred on the grid -- ring averages (computed
    /// from the field's own peak) must be non-increasing outward, and
    /// strictly lower at the outermost ring than the innermost, across a
    /// seed sweep, not a single lucky one.
    #[test]
    fn ring_averages_are_non_increasing_and_strictly_lower_at_the_edge() {
        let c = cfg();
        for seed in 0u64..64 {
            let map = run_ok(seed, &c);
            let rings = map.ring_averages(5);
            for w in rings.windows(2) {
                assert!(
                    w[0] >= w[1],
                    "seed {seed}: ring averages {rings:?} are not non-increasing"
                );
            }
            assert!(
                rings.last().unwrap() < rings.first().unwrap(),
                "seed {seed}: outermost ring {:?} not strictly lower than innermost {:?}",
                rings.last(),
                rings.first()
            );
        }
    }

    /// The density peak itself must not land back on the geometric
    /// centre (that would silently undo the whole point of the offset)
    /// -- checked across a sweep, since a single unlucky RNG draw could
    /// otherwise hide a broken offset draw.
    #[test]
    fn density_peak_is_never_the_geometric_centre_across_a_seed_sweep() {
        let c = cfg();
        for seed in 0u64..64 {
            let map = run_ok(seed, &c);
            let (peak_cx, peak_cy) = map.density_peak();
            let centre = ((map.cols - 1) / 2, (map.rows - 1) / 2);
            assert_ne!(
                (peak_cx, peak_cy),
                centre,
                "seed {seed}: density peak landed exactly on the geometric centre"
            );
        }
    }

    #[test]
    fn every_region_is_at_least_the_guaranteed_minimum_size() {
        let c = cfg();
        let min = guaranteed_min_region_cells(&c);
        for seed in 0u64..64 {
            let map = run_ok(seed, &c);
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
    fn regions_are_sorted_deterministically() {
        let c = cfg();
        let map = run_ok(9, &c);
        let regions = map.regions();
        let mut sorted = regions.clone();
        sorted.sort_by_key(|r| (r.bounds.y0, r.bounds.x0));
        assert_eq!(regions, sorted);
    }

    #[test]
    fn at_world_matches_the_coarse_cell_it_falls_in() {
        let c = cfg();
        let map = run_ok(5, &c);
        let cell_size = map.cell_size();
        for cx in 0..map.cols.min(4) {
            for cy in 0..map.rows.min(4) {
                let wx = c.site().x0 + cx * cell_size;
                let wy = c.site().y0 + cy * cell_size;
                let at = map.at_world(wx, wy).map(|p| (p.use_, p.density));
                assert_eq!(at, map.coarse_at(cx, cy).map(|c| (c.use_, c.density)));
            }
        }
    }

    #[test]
    fn at_world_is_none_outside_the_site() {
        let c = cfg();
        let map = run_ok(5, &c);
        assert!(map.at_world(-1, -1).is_none());
        assert!(map.at_world(c.site().x1, c.site().y0).is_none());
    }

    #[test]
    fn subdivide_never_produces_a_leaf_over_the_maximum_on_either_axis() {
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
                    leaf.width() <= c.land_use_max_leaf_cells as i64
                        && leaf.height() <= c.land_use_max_leaf_cells as i64,
                    "seed {seed}: leaf {leaf:?} over land_use_max_leaf_cells --                      max_recursion_depth is binding"
                );
            }
        }
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

    // --- target_counts / assign_uses, unit level ------------------------

    #[test]
    fn target_cells_sum_exactly_to_the_total() {
        let c = cfg();
        for total in [4i64, 5, 10, 37, 100, 1024] {
            let targets = target_cells(total, &c);
            assert_eq!(targets.iter().sum::<i64>(), total);
            for &n in &targets {
                assert!(n >= 1, "targets {targets:?} has a zero entry for {total}");
            }
        }
        // The shares are area shares: 1,024 cells at 18% commercial.
        assert_eq!(target_cells(1024, &c)[1], 184);
    }

    /// A 10x10 fixture (each cell is 10 permille of the site) with the
    /// given commercial cell count, industrial and institutional exactly
    /// on their keys (14 / 7 cells at the committed 14% / 7%).
    fn share_fixture(commercial_cells: usize, c: &GenerationConfig) -> LandUseMap {
        let mut uses = vec![LandUse::Commercial; commercial_cells];
        uses.extend(vec![LandUse::Industrial; 14]);
        uses.extend(vec![LandUse::Institutional; 7]);
        uses.resize(100, LandUse::Residential);
        let cells = uses
            .into_iter()
            .map(|use_| LandUseCell { use_, density: 50 })
            .collect();
        LandUseMap::test_fixture(c.site(), c.coarse_cell_size_cells, 10, 10, 5, 5, cells)
    }

    #[test]
    fn share_band_is_exact_at_the_tolerance_boundary() {
        let c = cfg();
        assert_eq!(c.share_commercial_pct, 18);
        assert_eq!(c.share_tolerance_pct, 6);
        // 24 cells = 240 permille = exactly 18% + 6 points: inside.
        assert_eq!(share_fixture(24, &c).share_band_violation(&c), None);
        // 25 cells = one cell (10 permille) further: outside, naming the use.
        assert_eq!(
            share_fixture(25, &c).share_band_violation(&c),
            Some((LandUse::Commercial, 250))
        );
        // 12 cells = 18% - 6 points: inside; 11 cells: outside.
        assert_eq!(share_fixture(12, &c).share_band_violation(&c), None);
        assert_eq!(
            share_fixture(11, &c).share_band_violation(&c),
            Some((LandUse::Commercial, 110))
        );
    }

    #[test]
    fn share_band_flags_a_third_of_the_site_as_commercial() {
        let c = cfg();
        let map = share_fixture(33, &c);
        assert_eq!(map.area_cells(LandUse::Commercial), 33);
        assert_eq!(
            map.share_band_violation(&c),
            Some((LandUse::Commercial, 330))
        );
    }

    #[test]
    fn share_band_accepts_a_map_on_its_keys() {
        let c = cfg();
        let map = share_fixture(18, &c);
        assert_eq!(map.share_band_violation(&c), None);
        assert_eq!(map.area_cells(LandUse::Industrial), 14);
        assert_eq!(map.area_cells(LandUse::Institutional), 7);
        assert_eq!(map.area_cells(LandUse::Residential), 61);
    }

    /// The overshoot side of the band is bounded by construction
    /// ([`takes_leaf`]: at most half a leaf), so the committed tolerance
    /// must cover half a maximum-size leaf of the committed grid.
    #[test]
    fn share_tolerance_covers_the_half_leaf_overshoot_bound() {
        let c = cfg();
        let total_cells = (c.site().width() / c.coarse_cell_size_cells as i64)
            * (c.site().height() / c.coarse_cell_size_cells as i64);
        let half_max_leaf = (c.land_use_max_leaf_cells as i64).pow(2) / 2;
        let overshoot_permille = half_max_leaf * 1000 / total_cells;
        assert!(
            c.share_tolerance_pct as i64 * 10 >= overshoot_permille,
            "share_tolerance_pct {} is under the {overshoot_permille} permille half-leaf overshoot bound",
            c.share_tolerance_pct
        );
    }

    #[test]
    fn takes_leaf_overshoots_by_at_most_half_a_leaf() {
        assert!(takes_leaf(0, 36, 1));
        assert!(takes_leaf(10, 20, 20)); // 30 vs 20: 10 over, 10 short -- tie takes
        assert!(!takes_leaf(10, 21, 20));
        assert!(takes_leaf(10, 5, 20));
    }

    /// The area share each grown use realises sits within one
    /// largest leaf of its own target (institutional excepted: it also
    /// honours its leaf-count floor).
    #[test]
    fn commercial_and_industrial_area_match_their_area_shares() {
        let c = cfg();
        let max_leaf = (c.land_use_max_leaf_cells as i64).pow(2);
        for seed in 0u64..64 {
            let map = run_ok(seed, &c);
            let total = (map.cols * map.rows) as i64;
            let targets = target_cells(total, &c);
            for (i, u) in [(1usize, LandUse::Commercial), (2, LandUse::Industrial)] {
                let got = (0..map.rows)
                    .flat_map(|cy| (0..map.cols).map(move |cx| (cx, cy)))
                    .filter(|&(cx, cy)| map.coarse_at(cx, cy).unwrap().use_ == u)
                    .count() as i64;
                assert!(
                    (got - targets[i]).abs() <= max_leaf,
                    "seed {seed}: {u:?} {got} cells vs target {}",
                    targets[i]
                );
            }
        }
    }

    #[test]
    fn grow_contiguous_reaches_its_target_and_stays_contiguous() {
        // A 4x4 grid of 1x1 leaves (16 leaves), seed at the centre-ish.
        let mut leaves = Vec::new();
        for y in 0..4 {
            for x in 0..4 {
                leaves.push(Rect {
                    x0: x,
                    y0: y,
                    x1: x + 1,
                    y1: y + 1,
                });
            }
        }
        let adjacency = leaf_adjacency(&leaves);
        let mut assigned = vec![None; leaves.len()];
        grow_contiguous(
            5,
            4,
            &leaves,
            &adjacency,
            &mut assigned,
            LandUse::Commercial,
            1,
            1,
        );
        let count = assigned
            .iter()
            .filter(|a| **a == Some(LandUse::Commercial))
            .count();
        assert_eq!(count, 4);
    }

    #[test]
    fn grow_contiguous_avoiding_never_touches_the_avoided_use() {
        let mut leaves = Vec::new();
        for y in 0..4 {
            for x in 0..4 {
                leaves.push(Rect {
                    x0: x,
                    y0: y,
                    x1: x + 1,
                    y1: y + 1,
                });
            }
        }
        let adjacency = leaf_adjacency(&leaves);
        let mut assigned = vec![None; leaves.len()];
        // Commercial occupies the whole top row.
        for slot in assigned.iter_mut().take(4) {
            *slot = Some(LandUse::Commercial);
        }
        // Industrial grows from the bottom-right corner (index 15).
        grow_contiguous_avoiding(
            15,
            6,
            &leaves,
            &adjacency,
            &mut assigned,
            LandUse::Industrial,
            LandUse::Commercial,
        );
        for (i, a) in assigned.iter().enumerate() {
            if *a == Some(LandUse::Industrial) {
                assert!(
                    !leaf_touches_use(i, &adjacency, &assigned, LandUse::Commercial),
                    "industrial leaf {i} touches commercial"
                );
            }
        }
    }
}
