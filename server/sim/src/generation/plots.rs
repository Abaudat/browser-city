//! Pass 3 (FR110, story 3.3): plot subdivision. Receives a street-network
//! block (pass 2's own output, blocks and their [`super::block_sides`]
//! frontage) plus the land-use field (pass 1, for density and use) and
//! cuts each block's own street-abutting faces into individual plots.
//! Reads density and land-use mix, per Tim's signature amendment
//! (`super`'s own module doc comment): a pass now takes every earlier
//! pass's output it actually needs, not only its immediate predecessor's.
//!
//! **Frontage is never re-derived.** A plot fronts a street iff it shares
//! at least `generation.plots.frontage_min_cells` of *edge length* with a
//! street-abutting side of its own block (corner-point contact is
//! landlocked) -- [`PlotMap::landlocked_plots`] is the one checker for
//! this, reading [`super::block_sides`] rather than scanning
//! `StreetNetwork::edges` per block.
//!
//! **Cutting, not packing.** Each block's own street-abutting faces (in
//! [`FACE_PRIORITY`] order) are cut into a depth-`plot_row_depth_cells`
//! strip each; a strip's own row length is filled with a small rhythm of
//! 2-3 module widths (drawn once per block face, cycled end to end -- a
//! terrace, never a fresh random width per plot, Artie's direction), the
//! final module absorbing the remainder so the row is covered exactly.
//! Processing a face claims the *full* extent of what remains, including
//! any corner a later face's own row would otherwise have reached, so the
//! earlier face in [`FACE_PRIORITY`] gets the wider, corner-inclusive row
//! (Artie's own "corner plots are cut first... are the largest"). No
//! rejection-sampling or retry loop anywhere: every abutting face always
//! yields at least one plot (an `open` one when its own strip cannot hold
//! a real rhythm module), so generation stays total and bounded.
//!
//! **Plots need not tile their block** (Tim's own simpler contract): they
//! are always disjoint and always inside their own block, but a deep
//! block's own core, left after every abutting face has cut its own row,
//! is simply unplotted remainder -- [`PlotMap::remainder_cells`] returns
//! it, never modelled as a `Plot`/yard type of its own. A block with no
//! street frontage at all (a sliver block, Artie's own named case) gets
//! one whole-block `open` plot instead of a landlocked building.
//!
//! The build line and any front-garden setback are an *envelope* (pass 4)
//! concern, applied when a footprint is placed inside its own plot -- a
//! plot's own bounds already include that margin as part of its own land
//! (Artie's direction: "a front-garden strip", part of the property, not
//! public land).

use super::land_use::LandUseMap;
use super::streets::{Block, Side, StreetNetwork, block_sides};
use super::{GenerationConfig, LandUse, SiteBounds, block_land_use};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

pub const PASS_ID: u64 = super::PASS_PLOT_SUBDIVISION;

/// One plot: a sub-rect of its own block, always inside it, front-facing
/// [`Side`] recorded so pass 4's entrance always opens onto it. `open` is
/// Artie's own explicit fallback -- a plot this pass could not usefully
/// cut into a real building lot (a sliver block, or a face too narrow for
/// even one rhythm module) rather than a landlocked or missing one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Plot {
    pub bounds: Rect,
    pub block: u32,
    pub front: Side,
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

    /// AC1: every plot (an `open` one exempted -- it owns no single
    /// street-abutting *frontage strip* of its own, its whole block's own
    /// [`super::Sides`] already stands for it) whose own `front` edge
    /// either does not sit on a street-abutting side of its own block at
    /// all, or shares under `frontage_min_cells` of edge length with it
    /// (corner-point contact included) -- empty over any real generator
    /// output, since this pass only ever cuts a plot from a street-
    /// abutting strip.
    pub fn landlocked_plots(&self, blocks: &[Block], frontage_min_cells: i32) -> Vec<usize> {
        let mut out = Vec::new();
        for (i, p) in self.plots.iter().enumerate() {
            if p.open {
                continue;
            }
            let Some(b) = blocks.get(p.block as usize) else {
                out.push(i);
                continue;
            };
            let sides = block_sides(b.bounds, self.site);
            if !sides.get(p.front) {
                out.push(i);
                continue;
            }
            let shared = shared_edge_length(p.bounds, b.bounds, p.front);
            if shared < frontage_min_cells as i64 {
                out.push(i);
            }
        }
        out
    }

    /// AC1's own tiling half, Tim's simpler contract (this module's own
    /// doc comment): `block`'s own area minus the summed area of its own
    /// plots -- always `>= 0` when every plot is inside its own block and
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
/// in -- south first (Artie's own tileset note: a south-facing front
/// shows its facade to the camera), then north, then east, then west.
/// Processing a face claims the full extent of `remaining` on its own
/// axis at that moment, including any corner a later face's own row
/// would otherwise have reached, so the earlier face here gets the
/// wider, corner-inclusive row (Artie's own "corner plots are cut
/// first... are the largest plots on the block").
pub const FACE_PRIORITY: [Side; 4] = [Side::South, Side::North, Side::East, Side::West];

/// An algorithm shape, not tunable content (the same precedent
/// `streets::DETOUR_SAMPLE_MAX_NODES` sets): a rhythm of 2-3 module
/// widths, never a fresh random width per plot (Artie's direction: "a
/// terrace is a repeated module").
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

    let mut out = Vec::new();
    let mut cursor: i64 = 0;
    let mut wi = 0usize;
    while cursor < row_len {
        let mut w = widths[wi % widths.len()];
        wi += 1;
        let remaining_len = row_len - cursor;
        if w >= remaining_len || remaining_len - w < width_min as i64 {
            w = remaining_len;
        }
        out.push(row_span_rect(strip, side, cursor, cursor + w));
        cursor += w;
    }
    out
}

/// Runs pass 3: for each of pass 2's own blocks, resolves its land use
/// (via [`super::block_land_use`], never a second majority computation)
/// and density once, then cuts every street-abutting face
/// ([`super::block_sides`]) into a rhythm of plots. Each block seeds its
/// own RNG stream from `(pass_seed, block_index)`, so one block's own
/// draw count never reshuffles another's.
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

        let mut rng = Rng::new(seed_from_ids(pass_seed, block_index as u64));
        let sides = block_sides(block.bounds, site);

        if !sides.any() {
            // Artie's own named sliver-block case: no face fronts a
            // street at all -- one explicit open plot, never a
            // landlocked building.
            plots.push(Plot {
                bounds: block.bounds,
                block: block_index,
                front: Side::South,
                land_use: use_,
                density,
                open: true,
            });
            continue;
        }

        let width_min = cfg.plot_width_min_cells[use_ as usize];
        let width_max = cfg.plot_width_max_cells[use_ as usize];
        let row_depth = cfg.plot_row_depth_cells[use_ as usize];

        let mut remaining = block.bounds;
        let mut any_placed = false;
        for &side in FACE_PRIORITY.iter() {
            if !sides.get(side) {
                continue;
            }
            let Some((strip, rest)) = cut_strip(remaining, side, row_depth) else {
                continue;
            };
            let row_len = match side {
                Side::North | Side::South => strip.width(),
                Side::East | Side::West => strip.height(),
            };
            if row_len < width_min as i64 {
                // This face's own row -- often a thin leftover once an
                // earlier face in `FACE_PRIORITY` has already claimed the
                // corner -- cannot hold even one rhythm module: an
                // explicit open plot (Artie's own "whole face ... cannot
                // hold a single building" fallback) rather than a
                // landlocked sliver or land dropped silently. `open`
                // plots are exempt from `landlocked_plots`.
                if strip.is_valid() {
                    plots.push(Plot {
                        bounds: strip,
                        block: block_index,
                        front: side,
                        land_use: use_,
                        density,
                        open: true,
                    });
                    any_placed = true;
                }
            } else {
                let cut = rhythm_plots(strip, side, row_len, width_min, width_max, &mut rng);
                debug_assert!(
                    !cut.is_empty(),
                    "row_len >= width_min > 0 always yields at least one rhythm module"
                );
                for bounds in cut {
                    plots.push(Plot {
                        bounds,
                        block: block_index,
                        front: side,
                        land_use: use_,
                        density,
                        open: false,
                    });
                }
                any_placed = true;
            }
            remaining = rest;
        }
        if !any_placed {
            // Unreachable at the committed config (every abutting face's
            // own row clears `width_min`) -- kept for totality against an
            // arbitrary/degenerate config: a whole-block open plot rather
            // than a block with no plot at all.
            let fallback_side = FACE_PRIORITY
                .into_iter()
                .find(|&s| sides.get(s))
                .expect("sides.any() is true, so at least one FACE_PRIORITY entry is set");
            plots.push(Plot {
                bounds: block.bounds,
                block: block_index,
                front: fallback_side,
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
            front,
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
        // "Straddling the block edge" (Quentin's own named fixture): the
        // plot's own front coordinate does not match the block's real
        // edge at all (it sits one cell inside), so it shares nothing --
        // reported the same as an interior plot.
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
        assert!(rhythm_plots(strip, Side::South, 0, 6, 10, &mut rng).is_empty());
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
        let cut = rhythm_plots(strip, Side::South, strip.width(), 6, 10, &mut rng);
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
        let cut = rhythm_plots(strip, Side::South, strip.width(), 6, 10, &mut rng);
        assert!(cut.len() > RHYTHM_MODULE_MAX as usize);
        let widths: std::collections::BTreeSet<i64> =
            cut[..cut.len() - 1].iter().map(|r| r.width()).collect();
        assert!(
            widths.len() as u32 <= RHYTHM_MODULE_MAX,
            "more distinct widths than the rhythm module count: {widths:?}"
        );
    }
}
