//! Pass 3 (FR110, story 3.3): plot subdivision. Receives a street-network
//! block (pass 2's own output, blocks and their [`super::block_sides`]
//! frontage) plus the land-use field (pass 1, for density and use) and
//! cuts each block's own street-abutting faces into individual plots.
//! Reads density and land-use mix.
//!
//! **Frontage is never re-derived.** A plot fronts a street iff it shares
//! at least `generation.plots.frontage_min_cells` of *edge length* with a
//! street-abutting side of its own block (corner-point contact is
//! landlocked) -- [`PlotMap::landlocked_plots`] is the one checker for
//! this, reading [`super::block_sides`] rather than scanning
//! `StreetNetwork::edges` per block.
//!
//! **Cutting, not packing.** Each block's own street-abutting faces (in
//! [`FACE_PRIORITY`] order) are cut into a row each, depth chosen per
//! [`axis_rows`]: the North/South pair first, spanning the block's full
//! width; the band left between them is the East/West pair's own row
//! length. Two opposing rows meet at the block's own mid-line up to
//! `plot_row_depth_cells`; a core left between rows (or behind a single
//! row) at or under the density-interpolated ceiling
//! ([`super::GenerationConfig::max_core_depth_cells`]) is absorbed back
//! into those rows as rear yard, split at the mid-line -- so is a band no
//! East/West row can use while an East/West street abuts it (a band too
//! short for one module must never sit as an open hole between two corner
//! buildings). A face is only ever cut when its own row clears its land
//! use's minimum usable depth plus the block's own setback, and is long
//! enough for one module with both corner extras -- so a non-`open` plot
//! is never statically unbuildable. A strip's own row length is filled
//! with a small rhythm of 2-3 module widths (drawn once per block face,
//! cycled end to end -- a terrace, never a fresh random width per plot),
//! the two end plots cut wider by exactly the corner inset pass 4 takes
//! from them, the final module absorbing the remainder so the row is
//! covered exactly. Processing a face claims the *full* extent of what
//! remains, including any corner a later face's own row would otherwise
//! have reached, so the earlier face in [`FACE_PRIORITY`] gets the wider,
//! corner-inclusive row. No rejection-sampling or retry loop anywhere, so
//! generation stays total and bounded.
//!
//! **No silent orphan land, no sliver `open` plot.** Every cell of every
//! block belongs to a plot. A block with no street frontage at all, or
//! too small on some axis for one module, gets one whole-block `open`
//! plot; a core past the ceiling becomes one explicit `open` plot
//! (`front: None` -- it fronts no single street), recorded and drawn
//! distinctly in the evidence, never left as unaccounted remainder. By
//! construction such a core is wider than the ceiling on the axis that
//! left it and at least one module on the other, so its short side always
//! clears `plot_open_min_side_cells` -- a residue narrower than that is
//! never a plot of its own.
//!
//! The build line and any front-garden setback are an *envelope* (pass 4)
//! concern, applied when a footprint is placed inside its own plot -- a
//! plot's own bounds already include that margin as part of its own land.
//!
//! Each block seeds its own RNG stream from its own bounds
//! ([`super::rect_seed_key`]), never from its position in `streets::
//! blocks()` -- adding or moving an unrelated block never reshuffles this
//! one's own draws (`inv_generation_block_plots_independent_of_other_
//! blocks` in `server/sim/tests/invariants.rs`).

use super::land_use::LandUseMap;
use super::streets::{Block, Side, StreetNetwork, block_sides};
use super::{GenerationConfig, LandUse, SiteBounds, block_land_use, rect_seed_key};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

pub const PASS_ID: u64 = super::PASS_PLOT_SUBDIVISION;

/// One plot: a sub-rect of its own block, always inside it. `front` is
/// the street-abutting side this plot's own row was cut from -- `None`
/// for an `open` plot that fronts no single street (a sliver block, or an
/// explicit leftover core), `Some` otherwise, always. `open` is the
/// explicit fallback for land this pass could not usefully cut into a
/// real building lot, never a landlocked or silently missing plot.
///
/// The two fields carry the state twice, and exactly one of the four
/// combinations is illegal: `open == false && front == None` (a building
/// lot fronting nothing). This pass never produces it, and
/// `inv_generation_plot_state_is_consistent` asserts so over arbitrary
/// seeds -- pass 4's own `expect` rests on that.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Plot {
    pub bounds: Rect,
    pub block: u32,
    pub front: Option<Side>,
    pub land_use: LandUse,
    pub density: i32,
    pub open: bool,
}

/// Pass 3's own output: every block's own plots, sorted by `(block, y0,
/// x0)` -- deterministic, never iteration order.
#[derive(Debug, Clone)]
pub struct PlotMap {
    site: SiteBounds,
    plots: Vec<Plot>,
}

impl PlotMap {
    /// The same raw-parts-constructor precedent `StreetNetwork::
    /// test_fixture`/`LandUseMap::test_fixture` already set: a hand-built
    /// map so a checker's own negative fixtures (an interior plot with no
    /// boundary edge, a corner-touch-only plot, a frontage one cell under
    /// the minimum) never have to be coaxed out of the real generator.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn test_fixture(site: SiteBounds, mut plots: Vec<Plot>) -> Self {
        plots.sort_by_key(|p| (p.block, p.bounds.y0, p.bounds.x0));
        PlotMap { site, plots }
    }

    pub fn site(&self) -> SiteBounds {
        self.site
    }

    pub fn plots(&self) -> &[Plot] {
        &self.plots
    }

    /// AC1: every non-`open` plot (`open` ones are exempt -- they own no
    /// single street-abutting *frontage strip* of their own) whose own
    /// `front` is `None`, does not sit on a street-abutting side of its
    /// own block, or shares under `frontage_min_cells` of edge length
    /// with it (corner-point contact included) -- empty over any real
    /// generator output, since this pass only ever cuts a non-`open` plot
    /// from a street-abutting strip that clears the minimum.
    pub fn landlocked_plots(&self, blocks: &[Block], frontage_min_cells: i32) -> Vec<usize> {
        let mut out = Vec::new();
        for (i, p) in self.plots.iter().enumerate() {
            if p.open {
                continue;
            }
            let Some(front) = p.front else {
                out.push(i);
                continue;
            };
            let Some(b) = blocks.get(p.block as usize) else {
                out.push(i);
                continue;
            };
            let sides = block_sides(b.bounds, self.site);
            if !sides.get(front) {
                out.push(i);
                continue;
            }
            let shared = shared_edge_length(p.bounds, b.bounds, front);
            if shared < frontage_min_cells as i64 {
                out.push(i);
            }
        }
        out
    }

    /// `block`'s own area minus the summed area of its own plots --
    /// always `>= 0` when every plot is inside its own block and
    /// mutually disjoint, the explicit account for land this pass leaves
    /// unplotted rather than a silent gap. `None` if `block_index` names
    /// no real block.
    pub fn remainder_cells(&self, block_index: u32, blocks: &[Block]) -> Option<i64> {
        let b = blocks.get(block_index as usize)?;
        let block_area = b.bounds.width() * b.bounds.height();
        let plot_area: i64 = self
            .plots
            .iter()
            .filter(|p| p.block == block_index)
            .map(|p| p.bounds.width() * p.bounds.height())
            .sum();
        Some(block_area - plot_area)
    }

    /// The percent of all plots in this district that are `open` -- an
    /// unbounded escape hatch otherwise (a generator could mark every
    /// awkward plot `open` and still pass every other AC1 property).
    /// `0` for an empty map.
    pub fn open_count_percent(&self) -> i64 {
        if self.plots.is_empty() {
            return 0;
        }
        let open = self.plots.iter().filter(|p| p.open).count() as i64;
        open * 100 / self.plots.len() as i64
    }

    /// The same ceiling's own area half: `open` plots can be individually
    /// rare but each cover a large share of the district's own plotted
    /// land. `0` if no plot has any area at all.
    pub fn open_area_percent(&self) -> i64 {
        let total: i64 = self
            .plots
            .iter()
            .map(|p| p.bounds.width() * p.bounds.height())
            .sum();
        if total == 0 {
            return 0;
        }
        let open: i64 = self
            .plots
            .iter()
            .filter(|p| p.open)
            .map(|p| p.bounds.width() * p.bounds.height())
            .sum();
        open * 100 / total
    }

    /// The percent of every block's own summed area that belongs to no
    /// plot at all (the citywide sum of [`Self::remainder_cells`]) -- the
    /// bound that keeps a deep block's own small, silent leftover from
    /// growing into a district-wide void nothing ever checks.
    pub fn unplotted_percent(&self, blocks: &[Block]) -> i64 {
        let total_block_area: i64 = blocks
            .iter()
            .map(|b| b.bounds.width() * b.bounds.height())
            .sum();
        if total_block_area == 0 {
            return 0;
        }
        let total_plot_area: i64 = self
            .plots
            .iter()
            .map(|p| p.bounds.width() * p.bounds.height())
            .sum();
        (total_block_area - total_plot_area).max(0) * 100 / total_block_area
    }
}

/// The overlap, in world cells, `plot`'s own `side` edge shares with
/// `block`'s corresponding edge -- `0` unless the two coordinates are
/// exactly equal (a plot whose front is not flush with its own block's
/// true edge on that axis shares nothing, whatever the two rects'
/// bounding boxes might suggest).
fn shared_edge_length(plot: Rect, block: Rect, side: Side) -> i64 {
    fn overlap_1d(a0: i32, a1: i32, b0: i32, b1: i32) -> i64 {
        (a1.min(b1) as i64 - a0.max(b0) as i64).max(0)
    }
    match side {
        Side::North if plot.y0 == block.y0 => overlap_1d(plot.x0, plot.x1, block.x0, block.x1),
        Side::South if plot.y1 == block.y1 => overlap_1d(plot.x0, plot.x1, block.x0, block.x1),
        Side::West if plot.x0 == block.x0 => overlap_1d(plot.y0, plot.y1, block.y0, block.y1),
        Side::East if plot.x1 == block.x1 => overlap_1d(plot.y0, plot.y1, block.y0, block.y1),
        _ => 0,
    }
}

/// The fixed priority order a block's own street-abutting faces are cut
/// in -- south first (a south-facing front shows its facade to the
/// camera), then north, then east, then west, the same order regardless
/// of street tier. Processing a face claims the full extent of
/// `remaining` on its own axis at that moment, including any corner a
/// later face's own row would otherwise have reached, so the earlier
/// face here gets the wider, corner-inclusive row.
pub const FACE_PRIORITY: [Side; 4] = [Side::South, Side::North, Side::East, Side::West];

/// An algorithm shape, not tunable content (the same precedent
/// `streets::DETOUR_SAMPLE_MAX_NODES` sets): a rhythm of 2-3 module
/// widths, never a fresh random width per plot -- a terrace is a
/// repeated module.
const RHYTHM_MODULE_MIN: u32 = 2;
const RHYTHM_MODULE_MAX: u32 = 3;

/// Cuts the depth-`depth` strip of `remaining` along `side` (clamped to
/// whatever extent `remaining` actually has left on that axis), returning
/// the strip and the rest of `remaining` with that strip removed -- `None`
/// if `remaining` already has no extent left to give on that axis, or
/// `depth` is non-positive.
fn cut_strip(remaining: Rect, side: Side, depth: i32) -> Option<(Rect, Rect)> {
    if depth <= 0 || !remaining.is_valid() {
        return None;
    }
    match side {
        Side::North => {
            let cut = (remaining.y0 + depth).min(remaining.y1);
            (cut > remaining.y0).then_some((
                Rect {
                    y1: cut,
                    ..remaining
                },
                Rect {
                    y0: cut,
                    ..remaining
                },
            ))
        }
        Side::South => {
            let cut = (remaining.y1 - depth).max(remaining.y0);
            (cut < remaining.y1).then_some((
                Rect {
                    y0: cut,
                    ..remaining
                },
                Rect {
                    y1: cut,
                    ..remaining
                },
            ))
        }
        Side::West => {
            let cut = (remaining.x0 + depth).min(remaining.x1);
            (cut > remaining.x0).then_some((
                Rect {
                    x1: cut,
                    ..remaining
                },
                Rect {
                    x0: cut,
                    ..remaining
                },
            ))
        }
        Side::East => {
            let cut = (remaining.x1 - depth).max(remaining.x0);
            (cut < remaining.x1).then_some((
                Rect {
                    x0: cut,
                    ..remaining
                },
                Rect {
                    x1: cut,
                    ..remaining
                },
            ))
        }
    }
}

/// The sub-rect of `strip` spanning `[from, to)` along its own row axis
/// (perpendicular to `side`'s own depth direction), keeping `strip`'s own
/// depth extent unchanged.
fn row_span_rect(strip: Rect, side: Side, from: i64, to: i64) -> Rect {
    match side {
        Side::North | Side::South => Rect {
            x0: strip.x0 + from as i32,
            x1: strip.x0 + to as i32,
            y0: strip.y0,
            y1: strip.y1,
        },
        Side::East | Side::West => Rect {
            y0: strip.y0 + from as i32,
            y1: strip.y0 + to as i32,
            x0: strip.x0,
            x1: strip.x1,
        },
    }
}

/// Fills `strip`'s own row length with a rhythm of `k` (2-3, seeded)
/// module widths in `[width_min, width_max]`, cycled end to end -- the
/// final module absorbs the remainder exactly, merged into the previous
/// one instead when that remainder alone would fall under `width_min`
/// (never a sliver plot under the usable floor). Empty if `row_len` or
/// `width_min` is non-positive.
fn rhythm_plots(
    strip: Rect,
    side: Side,
    row_len: i64,
    width_min: i32,
    width_max: i32,
    corner_extra: i32,
    rng: &mut Rng,
) -> Vec<Rect> {
    if row_len <= 0 || width_min <= 0 {
        return Vec::new();
    }
    let k = RHYTHM_MODULE_MIN
        + (rng.next_u64() % (RHYTHM_MODULE_MAX - RHYTHM_MODULE_MIN + 1) as u64) as u32;
    let span = (width_max - width_min).max(0) as u64;
    let widths: Vec<i64> = (0..k)
        .map(|_| {
            let jitter = if span > 0 {
                (rng.next_u64() % (span + 1)) as i64
            } else {
                0
            };
            (width_min as i64 + jitter).max(1)
        })
        .collect();

    // The row's two end plots are corners: each is cut wider by exactly
    // the extra inset its corner edge carries in pass 4 (`corner_extra`,
    // the setback less half the side gap), so a corner plot's own usable
    // width is never under an ordinary module's.
    let extra = corner_extra.max(0) as i64;
    let last_min = width_min as i64 + extra;
    let mut out = Vec::new();
    let mut cursor: i64 = 0;
    let mut wi = 0usize;
    while cursor < row_len {
        let mut w = widths[wi % widths.len()];
        if wi == 0 {
            w += extra;
        }
        wi += 1;
        let remaining_len = row_len - cursor;
        if w >= remaining_len || remaining_len - w < last_min {
            w = remaining_len;
        }
        out.push(row_span_rect(strip, side, cursor, cursor + w));
        cursor += w;
    }
    out
}

/// The least row length a face needs to hold one rhythm module once
/// both of its end plots carry their own corner extra.
fn row_min_len(width_min: i32, corner_extra: i32) -> i64 {
    width_min as i64 + 2 * corner_extra.max(0) as i64
}

/// The depth given to each of two opposing faces on one axis (`dim` world
/// cells long overall), `a` the [`FACE_PRIORITY`]-first of the pair
/// (South of the North/South pair, East of the East/West pair). `target`
/// is the land use's own row-depth ceiling; `min_needed` is the least
/// depth a row must clear to ever hold that use's own minimum envelope
/// (interior plus wall ring plus the block's own setback) -- a depth
/// under this is never handed to a real, non-`open` plot, by
/// construction, so a statically unbuildable plot can never be created.
///
/// Two abutting faces meet at the block's own mid-line as long as
/// `target` reaches it; past that, each gets `target` and the leftover in
/// between is the core. A single abutting face on this axis gets up to
/// `target`, the rest of `dim` is the core. If even the available depth
/// cannot clear `min_needed`, that side gets no row at all (`0`).
///
/// A core of `max_core` or less is then absorbed back into the rows as
/// rear yard ([`absorb`]), so two back-to-back rows always meet
/// (remainder 0) unless what lies between them is a real, `open`-plot-
/// sized core.
fn axis_rows(
    dim: i64,
    has_a: bool,
    has_b: bool,
    target: i32,
    min_needed: i32,
    max_core: i32,
) -> (i32, i32) {
    let dim = dim.max(0);
    let one_sided = |has: bool| -> i32 {
        if !has {
            return 0;
        }
        let depth = (target as i64).min(dim) as i32;
        if depth >= min_needed { depth } else { 0 }
    };
    let (a, b) = match (has_a, has_b) {
        (false, false) => (0, 0),
        (true, false) => (one_sided(true), 0),
        (false, true) => (0, one_sided(true)),
        (true, true) => {
            let each = (target as i64).min(dim / 2) as i32;
            if each >= min_needed {
                (each, each)
            } else {
                (one_sided(true), 0)
            }
        }
    };
    let core = dim - a as i64 - b as i64;
    if core > 0 && core <= max_core as i64 {
        absorb(a, b, core as i32)
    } else {
        (a, b)
    }
}

/// Hands `extra` cells of depth back to the rows on one axis: split at
/// the mid-line when both exist (the first-priority face taking the odd
/// cell), whole to the one that does, nothing when neither does.
fn absorb(a: i32, b: i32, extra: i32) -> (i32, i32) {
    match (a > 0, b > 0) {
        (true, true) => (a + (extra + 1) / 2, b + extra / 2),
        (true, false) => (a + extra, b),
        (false, true) => (a, b + extra),
        (false, false) => (a, b),
    }
}

/// Runs pass 3: for each of pass 2's own blocks, resolves its land use
/// (via [`super::block_land_use`], never a second majority computation)
/// and density once, then cuts every street-abutting face
/// ([`super::block_sides`]) into a rhythm of plots, per [`axis_rows`].
/// Each block seeds its own RNG stream from its own bounds
/// ([`rect_seed_key`]), never from its position in `streets.blocks()`.
pub fn run(
    city_seed: u64,
    land_use: &LandUseMap,
    streets: &StreetNetwork,
    cfg: &GenerationConfig,
) -> PlotMap {
    let pass_seed = seed_from_ids(city_seed, PASS_ID);
    let site = streets.site();
    let mut plots: Vec<Plot> = Vec::new();

    for (raw_index, block) in streets.blocks().iter().enumerate() {
        let block_index = raw_index as u32;
        let use_ = block_land_use(land_use, block.bounds);
        let sample_x = ((block.bounds.x0 + block.bounds.x1) / 2).clamp(site.x0, site.x1 - 1);
        let sample_y = ((block.bounds.y0 + block.bounds.y1) / 2).clamp(site.y0, site.y1 - 1);
        let density = land_use
            .at_world(sample_x, sample_y)
            .map_or(cfg.density_min, |c| c.density);

        let mut rng = Rng::new(seed_from_ids(pass_seed, rect_seed_key(block.bounds)));
        let sides = block_sides(block.bounds, site);

        if !sides.any() {
            // A sliver block: no face fronts a street at all -- one
            // explicit open plot, never a landlocked building.
            plots.push(Plot {
                bounds: block.bounds,
                block: block_index,
                front: None,
                land_use: use_,
                density,
                open: true,
            });
            continue;
        }

        let width_min = cfg.plot_width_min_cells[use_ as usize];
        let width_max = cfg.plot_width_max_cells[use_ as usize];
        let row_depth = cfg.plot_row_depth_cells[use_ as usize];
        let limits = cfg.envelope_limits(use_);
        let setback = cfg.setback_cells(density);
        let min_needed = limits.min_depth_cells + setback;
        let max_core = cfg.max_core_depth_cells(density);
        let corner_extra = (setback - cfg.side_gap_cells(density) / 2).max(0);
        let row_min = row_min_len(width_min, corner_extra);
        let (width, height) = (block.bounds.width(), block.bounds.height());

        // The North/South pair is cut first and spans the block's full
        // width; the band left between those two rows is the East/West
        // pair's own row length. A face is only ever cut when its row can
        // hold one full module with both corner extras.
        // No absorption on this axis yet (`max_core` 0): the band is
        // offered to the East/West faces first, below.
        let (mut south_depth, mut north_depth) = if width >= row_min {
            axis_rows(height, sides.south, sides.north, row_depth, min_needed, 0)
        } else {
            (0, 0)
        };
        let band = height - south_depth as i64 - north_depth as i64;
        let (mut east_depth, mut west_depth) = (0, 0);
        if band > 0 {
            if (sides.east || sides.west) && band >= row_min {
                let (e, w) = axis_rows(
                    width, sides.east, sides.west, row_depth, min_needed, max_core,
                );
                east_depth = e;
                west_depth = w;
            }
            if east_depth == 0 && west_depth == 0 {
                // No East/West row can use the band. It is absorbed into
                // the North/South rows as rear yard -- split at the
                // mid-line -- when it is under the core ceiling, or
                // whenever an East/West street abuts it (a band too short
                // for one module must never sit as an open hole between
                // two corner buildings on that street). Only a band past
                // the ceiling with no street of its own survives as a
                // core, below.
                let absorb_band = band <= max_core as i64 || sides.east || sides.west;
                if absorb_band {
                    let (s, n) = absorb(south_depth, north_depth, band as i32);
                    south_depth = s;
                    north_depth = n;
                }
            }
        }
        let depth_for = |side: Side| match side {
            Side::South => south_depth,
            Side::North => north_depth,
            Side::East => east_depth,
            Side::West => west_depth,
        };

        let mut remaining = block.bounds;
        for &side in FACE_PRIORITY.iter() {
            let depth = depth_for(side);
            if depth <= 0 {
                continue;
            }
            let Some((strip, rest)) = cut_strip(remaining, side, depth) else {
                continue;
            };
            let row_len = match side {
                Side::North | Side::South => strip.width(),
                Side::East | Side::West => strip.height(),
            };
            debug_assert!(
                row_len >= row_min,
                "a face is only ever cut when its own row can hold one module"
            );
            let cut = rhythm_plots(
                strip,
                side,
                row_len,
                width_min,
                width_max,
                corner_extra,
                &mut rng,
            );
            debug_assert!(
                !cut.is_empty(),
                "row_len >= row_min > 0 always yields a module"
            );
            for bounds in cut {
                plots.push(Plot {
                    bounds,
                    block: block_index,
                    front: Some(side),
                    land_use: use_,
                    density,
                    open: false,
                });
            }
            remaining = rest;
        }

        // Whatever no row claimed is the block's own core: one explicit,
        // recorded open plot (a future yard, park or car park), never a
        // silent void. By construction it is past the core ceiling on the
        // axis that left it (an ordinary block), or the whole block (a
        // block no face could cut at all).
        if remaining.width() > 0 && remaining.height() > 0 {
            plots.push(Plot {
                bounds: remaining,
                block: block_index,
                front: None,
                land_use: use_,
                density,
                open: true,
            });
        }
    }

    plots.sort_by_key(|p| (p.block, p.bounds.y0, p.bounds.x0));
    PlotMap { site, plots }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;
    use crate::generation::{land_use, streets};

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    fn district(seed: u64, c: &GenerationConfig) -> (LandUseMap, StreetNetwork, PlotMap) {
        let lu = land_use::run(seed, c.site(), c).unwrap();
        let net = streets::run(seed, &lu, c);
        let pm = run(seed, &lu, &net, c);
        (lu, net, pm)
    }

    #[test]
    fn run_is_deterministic_for_the_same_seed() {
        let c = cfg();
        let (_, _, a) = district(11, &c);
        let (_, _, b) = district(11, &c);
        assert_eq!(a.plots, b.plots);
    }

    #[test]
    fn run_produces_at_least_one_plot_per_block() {
        let c = cfg();
        let (_, net, pm) = district(7, &c);
        for i in 0..net.blocks().len() as u32 {
            assert!(
                pm.plots().iter().any(|p| p.block == i),
                "block {i} has no plot at all"
            );
        }
    }

    #[test]
    fn every_plot_is_inside_its_own_block() {
        let c = cfg();
        let (_, net, pm) = district(7, &c);
        for p in pm.plots() {
            let b = net.blocks()[p.block as usize];
            assert!(
                b.bounds.x0 <= p.bounds.x0
                    && p.bounds.x1 <= b.bounds.x1
                    && b.bounds.y0 <= p.bounds.y0
                    && p.bounds.y1 <= b.bounds.y1,
                "plot {:?} escapes block {:?}",
                p.bounds,
                b.bounds
            );
        }
    }

    #[test]
    fn no_two_plots_in_the_same_block_overlap() {
        let c = cfg();
        let (_, net, pm) = district(7, &c);
        for block_index in 0..net.blocks().len() as u32 {
            let block_plots: Vec<&Plot> = pm
                .plots()
                .iter()
                .filter(|p| p.block == block_index)
                .collect();
            for i in 0..block_plots.len() {
                for j in (i + 1)..block_plots.len() {
                    let a = block_plots[i].bounds;
                    let b = block_plots[j].bounds;
                    let overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
                    assert!(
                        !overlap,
                        "plots {a:?} and {b:?} overlap in block {block_index}"
                    );
                }
            }
        }
    }

    #[test]
    fn landlocked_plots_is_empty_over_real_generator_output() {
        let c = cfg();
        let (_, net, pm) = district(7, &c);
        let offenders = pm.landlocked_plots(net.blocks(), c.plot_frontage_min_cells);
        assert!(offenders.is_empty(), "landlocked plots: {offenders:?}");
    }

    /// A site strictly larger than [`one_block`]'s own bounds on every
    /// side, so every one of the block's own four sides abuts a real
    /// street rather than the site boundary -- `block_sides` reads this
    /// difference to decide frontage, so the two must never coincide by
    /// accident in a fixture.
    fn one_block_site() -> SiteBounds {
        SiteBounds {
            x0: -100,
            y0: -100,
            x1: 200,
            y1: 200,
        }
    }

    fn one_block() -> Block {
        Block {
            bounds: Rect {
                x0: 0,
                y0: 0,
                x1: 100,
                y1: 100,
            },
        }
    }

    fn fixture_plot(bounds: Rect, front: Side) -> Plot {
        Plot {
            bounds,
            block: 0,
            front: Some(front),
            land_use: LandUse::Residential,
            density: 50,
            open: false,
        }
    }

    #[test]
    fn landlocked_plots_flags_an_interior_plot_with_no_boundary_edge() {
        let plot = fixture_plot(
            Rect {
                x0: 20,
                y0: 20,
                x1: 40,
                y1: 40,
            },
            Side::South,
        );
        let map = PlotMap::test_fixture(one_block_site(), vec![plot]);
        let offenders = map.landlocked_plots(&[one_block()], 3);
        assert_eq!(offenders, vec![0]);
    }

    #[test]
    fn landlocked_plots_flags_a_corner_touch_only_plot() {
        // Touches the block's own south edge (y1 == 100) at exactly one
        // point (x0==x1-1==99, a single-cell-wide sliver at the corner) --
        // under any positive frontage_min_cells.
        let plot = fixture_plot(
            Rect {
                x0: 99,
                y0: 80,
                x1: 100,
                y1: 100,
            },
            Side::South,
        );
        let map = PlotMap::test_fixture(one_block_site(), vec![plot]);
        let offenders = map.landlocked_plots(&[one_block()], 3);
        assert_eq!(offenders, vec![0]);
    }

    #[test]
    fn landlocked_plots_flags_a_frontage_one_cell_under_the_minimum() {
        let plot = fixture_plot(
            Rect {
                x0: 0,
                y0: 80,
                x1: 2,
                y1: 100,
            },
            Side::South,
        );
        let map = PlotMap::test_fixture(one_block_site(), vec![plot]);
        // frontage width is 2, the minimum is 3.
        let offenders = map.landlocked_plots(&[one_block()], 3);
        assert_eq!(offenders, vec![0]);
    }

    #[test]
    fn landlocked_plots_accepts_a_plot_straddling_the_block_edge_as_landlocked_too() {
        // The plot's own front coordinate does not match the block's
        // real edge at all (it sits one cell inside), so it shares
        // nothing -- reported the same as an interior plot.
        let plot = fixture_plot(
            Rect {
                x0: 0,
                y0: 79,
                x1: 20,
                y1: 99,
            },
            Side::South,
        );
        let map = PlotMap::test_fixture(one_block_site(), vec![plot]);
        let offenders = map.landlocked_plots(&[one_block()], 3);
        assert_eq!(offenders, vec![0]);
    }

    #[test]
    fn landlocked_plots_does_not_report_a_real_fronting_plot() {
        let plot = fixture_plot(
            Rect {
                x0: 0,
                y0: 80,
                x1: 20,
                y1: 100,
            },
            Side::South,
        );
        let map = PlotMap::test_fixture(one_block_site(), vec![plot]);
        let offenders = map.landlocked_plots(&[one_block()], 3);
        assert!(offenders.is_empty());
    }

    #[test]
    fn landlocked_plots_flags_a_plot_fronting_a_side_that_does_not_abut_a_street() {
        // The block spans the whole site -- `block_sides` reports no
        // frontage at all (every side sits on the site boundary) -- so
        // even a plot flush with the block's south edge is landlocked.
        let plot = fixture_plot(
            Rect {
                x0: 0,
                y0: 80,
                x1: 20,
                y1: 100,
            },
            Side::South,
        );
        let block = Block {
            bounds: one_block_site(),
        };
        let map = PlotMap::test_fixture(one_block_site(), vec![plot]);
        let offenders = map.landlocked_plots(&[block], 3);
        assert_eq!(offenders, vec![0]);
    }

    #[test]
    fn remainder_cells_accounts_for_a_deep_blocks_own_unplotted_core() {
        let block = one_block();
        let plot = fixture_plot(
            Rect {
                x0: 0,
                y0: 80,
                x1: 20,
                y1: 100,
            },
            Side::South,
        );
        let map = PlotMap::test_fixture(one_block_site(), vec![plot]);
        let remainder = map.remainder_cells(0, &[block]).unwrap();
        assert_eq!(remainder, 100 * 100 - 20 * 20);
    }

    #[test]
    fn a_sliver_block_with_no_frontage_gets_one_whole_block_open_plot() {
        // A whole multiple of `coarse_cell_size_cells` (16), unlike
        // `one_block_site`, which `land_use::run` would otherwise refuse.
        let site = SiteBounds {
            x0: 0,
            y0: 0,
            x1: 320,
            y1: 320,
        };
        let block = Block { bounds: site };
        let net = StreetNetwork::test_fixture(site, Vec::new(), vec![block]);
        let lu = land_use::run(1, site, &cfg()).unwrap();
        let pm = run(1, &lu, &net, &cfg());
        assert_eq!(pm.plots().len(), 1);
        let p = pm.plots()[0];
        assert!(p.open);
        assert_eq!(p.bounds, site);
    }

    #[test]
    fn rhythm_plots_of_an_empty_row_is_empty() {
        let strip = Rect {
            x0: 0,
            y0: 0,
            x1: 0,
            y1: 10,
        };
        let mut rng = Rng::new(1);
        assert!(rhythm_plots(strip, Side::South, 0, 6, 10, 0, &mut rng).is_empty());
    }

    #[test]
    fn absorb_splits_a_core_at_the_mid_line_with_the_odd_cell_to_the_first_face() {
        assert_eq!(absorb(10, 10, 5), (13, 12));
        assert_eq!(absorb(10, 0, 5), (15, 0));
        assert_eq!(absorb(0, 10, 5), (0, 15));
        assert_eq!(absorb(0, 0, 5), (0, 0));
    }

    #[test]
    fn axis_rows_absorbs_a_core_at_or_under_the_ceiling_and_leaves_a_bigger_one() {
        // 40 deep, two 12-deep rows: a 16-cell core, absorbed at a
        // ceiling of 16 (rows meet, 20/20), left at a ceiling of 8.
        assert_eq!(axis_rows(40, true, true, 12, 10, 16), (20, 20));
        assert_eq!(axis_rows(40, true, true, 12, 10, 8), (12, 12));
        // One face only: the whole leftover goes to it under the ceiling.
        assert_eq!(axis_rows(20, true, false, 12, 10, 8), (20, 0));
        assert_eq!(axis_rows(40, true, false, 12, 10, 8), (12, 0));
        // A face that cannot clear the minimum gets no row at all.
        assert_eq!(axis_rows(8, true, true, 12, 10, 8), (0, 0));
    }

    #[test]
    fn rhythm_plots_cuts_both_end_plots_wider_by_the_corner_extra() {
        let strip = Rect {
            x0: 0,
            y0: 0,
            x1: 40,
            y1: 10,
        };
        let mut rng = Rng::new(5);
        let cut = rhythm_plots(strip, Side::South, strip.width(), 8, 8, 1, &mut rng);
        assert_eq!(
            cut.first().unwrap().width(),
            9,
            "first plot: module plus extra"
        );
        assert!(
            cut.last().unwrap().width() >= 9,
            "last plot: never under module plus extra"
        );
        for p in &cut[1..cut.len() - 1] {
            assert_eq!(p.width(), 8, "an interior plot is the plain module");
        }
        assert_eq!(cut.iter().map(|p| p.width()).sum::<i64>(), 40);
    }

    #[test]
    fn rhythm_plots_covers_the_row_exactly_with_no_gap_and_no_overlap() {
        let strip = Rect {
            x0: 0,
            y0: 0,
            x1: 47,
            y1: 12,
        };
        let mut rng = Rng::new(42);
        let cut = rhythm_plots(strip, Side::South, strip.width(), 6, 10, 0, &mut rng);
        assert!(!cut.is_empty());
        let mut cursor = strip.x0;
        for r in &cut {
            assert_eq!(r.x0, cursor, "gap or overlap before {r:?}");
            assert_eq!(r.y0, strip.y0);
            assert_eq!(r.y1, strip.y1);
            cursor = r.x1;
        }
        assert_eq!(cursor, strip.x1);
    }

    #[test]
    fn rhythm_plots_shows_repetition_within_one_face() {
        // A long row over many module cycles -- the rhythm must repeat
        // (a terrace), not draw a fresh width per plot: at most
        // RHYTHM_MODULE_MAX distinct widths across every plot but the
        // final (remainder-absorbing) one.
        let strip = Rect {
            x0: 0,
            y0: 0,
            x1: 400,
            y1: 12,
        };
        let mut rng = Rng::new(99);
        let cut = rhythm_plots(strip, Side::South, strip.width(), 6, 10, 0, &mut rng);
        assert!(cut.len() > RHYTHM_MODULE_MAX as usize);
        let widths: std::collections::BTreeSet<i64> =
            cut[..cut.len() - 1].iter().map(|r| r.width()).collect();
        assert!(
            widths.len() as u32 <= RHYTHM_MODULE_MAX,
            "more distinct widths than the rhythm module count: {widths:?}"
        );
    }
}
