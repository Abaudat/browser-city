//! Pass 4 (FR110, story 3.3): the building envelope. Receives pass 3's own
//! plots; hands down each non-`open` plot's own footprint (an abstract
//! rect -- no wall cells, no entrance cell, no `ObjectDef` yet: the sealed
//! shell lands with the story that first rasterises, `front` is what it
//! will need, Tim's own stated assumption). Reads density (the party-
//! wall/side-gap and build-line step) and each plot's own land use (the
//! per-class minimum usable interior).
//!
//! **Rejection, never shrinking.** A plot too small for its own class's
//! minimum usable interior yields [`EnvelopeOutcome::Rejected`] -- a typed
//! outcome, counted (see [`EnvelopeMap::rejected_percent`]), never an
//! `Option::None` that disappears and never a footprint clamped below the
//! minimum. The minimum is checked against the *interior net* (the
//! footprint minus the wall ring on both axes), computed once in
//! [`super::GenerationConfig::envelope_limits`].
//!
//! **The build line.** Every envelope on the same plot side of the same
//! block sits the same `setback` cells behind that side's own true
//! street-facing edge -- one shared value per block (density-derived, a
//! step function of `generation.plots.high_density_threshold`), so every
//! block face reads as one continuous street wall, never a building
//! standing proud of or behind its neighbours (Artie's direction).
//!
//! **Side gaps are 0 or `side_gap_periphery_cells`, never 1.** Below the
//! density threshold, every footprint insets by half that gap from its
//! own plot's row-axis edges, so two neighbouring buildings end up the
//! full gap apart; at or above it, the inset is 0 (party walls, footprint
//! flush with its own plot's edges).
//!
//! **Building count fails generation.** [`run`] returns
//! [`super::GenerationError::BuildingCountOutOfTolerance`] when the
//! realised placed-envelope count, over the whole district, sits outside
//! `[min, max]` derived from `generation.envelopes.target_count_per_
//! million_cells` scaled by the real site area -- a seed that trips this
//! is a world that fails to create, never a silently thin or overcrowded
//! city.

use super::plots::PlotMap;
use super::streets::Side;
use super::{GenerationConfig, GenerationError, LandUse};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

pub const PASS_ID: u64 = super::PASS_BUILDING_ENVELOPE;

/// The intended building class an envelope is sized for -- at this pass,
/// exactly its own plot's land use: pass 5 (building type) has not run
/// yet, so "intended type" is the plot's land use (Tim's own stated
/// assumption).
pub type EnvelopeClass = LandUse;

/// One placed envelope: an abstract outer-rectangle footprint, always
/// inside its own plot, `front` copied from that plot (never re-derived)
/// so the entrance a later story rasterises always opens onto the same
/// edge the plot itself fronts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Envelope {
    /// Index into the [`PlotMap`] this envelope was built from.
    pub plot: u32,
    pub footprint: Rect,
    pub front: Side,
}

impl Envelope {
    /// The footprint's own size along its plot's row axis (parallel to
    /// `front`'s own block face) -- what a per-land-use `width` bound
    /// means, whichever compass direction `front` happens to be.
    pub fn along_face_cells(&self) -> i64 {
        along_face_extent(self.footprint, self.front)
    }

    /// The footprint's own size along the perpendicular (setback) axis --
    /// what a per-land-use `depth` bound means.
    pub fn depth_cells(&self) -> i64 {
        depth_extent(self.footprint, self.front)
    }
}

/// Why a plot could not hold its own class's minimum envelope -- Quentin's
/// direction: "hands the envelope pass a plot one cell too small on each
/// axis in turn", checked in this order (narrow before shallow).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RejectReason {
    PlotTooNarrow,
    PlotTooShallow,
}

/// Every non-`open` plot's own outcome -- a typed result, never an
/// `Option::None` that disappears (Quentin's direction).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EnvelopeOutcome {
    Placed(Envelope),
    Rejected {
        plot: u32,
        class: EnvelopeClass,
        reason: RejectReason,
    },
}

/// Pass 4's own output: one [`EnvelopeOutcome`] per non-`open` plot pass 3
/// handed down, in plot order.
#[derive(Debug, Clone)]
pub struct EnvelopeMap {
    outcomes: Vec<EnvelopeOutcome>,
}

impl EnvelopeMap {
    /// The same raw-parts-constructor precedent every other generation
    /// map already sets, for a checker's own hand-built negative
    /// fixtures.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn test_fixture(outcomes: Vec<EnvelopeOutcome>) -> Self {
        EnvelopeMap { outcomes }
    }

    pub fn outcomes(&self) -> &[EnvelopeOutcome] {
        &self.outcomes
    }

    /// Every envelope this pass actually placed.
    pub fn envelopes(&self) -> impl Iterator<Item = &Envelope> {
        self.outcomes.iter().filter_map(|o| match o {
            EnvelopeOutcome::Placed(e) => Some(e),
            EnvelopeOutcome::Rejected { .. } => None,
        })
    }

    pub fn placed_count(&self) -> i64 {
        self.envelopes().count() as i64
    }

    pub fn rejected_count(&self) -> i64 {
        self.outcomes
            .iter()
            .filter(|o| matches!(o, EnvelopeOutcome::Rejected { .. }))
            .count() as i64
    }

    /// Quentin's own guard: rejection rate gets its own key, asserted per
    /// city -- without it a generator that rejects half the district
    /// still passes every other property until AC4 catches it for the
    /// wrong reason. `0` when no plot attempted an envelope at all
    /// (nothing to reject).
    pub fn rejected_percent(&self) -> i64 {
        if self.outcomes.is_empty() {
            return 0;
        }
        (self.rejected_count() * 100) / self.outcomes.len() as i64
    }
}

fn along_face_extent(bounds: Rect, front: Side) -> i64 {
    match front {
        Side::North | Side::South => bounds.width(),
        Side::East | Side::West => bounds.height(),
    }
}

fn depth_extent(bounds: Rect, front: Side) -> i64 {
    match front {
        Side::North | Side::South => bounds.height(),
        Side::East | Side::West => bounds.width(),
    }
}

/// The total side gap between two neighbouring envelopes on a block below
/// `plot_high_density_threshold` -- 0 at or above it (party walls),
/// Artie's direction: "0 or at least 2 cells, never 1".
fn side_gap_for(density: i32, cfg: &GenerationConfig) -> i32 {
    if density >= cfg.plot_high_density_threshold {
        0
    } else {
        cfg.envelope_side_gap_periphery_cells
    }
}

/// The one shared build-line setback every envelope on a below-threshold
/// block sits behind its own plot's true street-facing edge -- Artie's
/// direction: "at high density the setback is 0... toward the periphery
/// ... one shared setback of 2-4 cells".
fn setback_for(density: i32, cfg: &GenerationConfig) -> i32 {
    if density >= cfg.plot_high_density_threshold {
        0
    } else {
        cfg.plot_setback_periphery_cells
    }
}

/// Clamps `[a0, a0+len)` to fit inside `[lo, hi]` without changing `len`
/// -- the footprint's own row-axis placement is centred first, then
/// nudged back inside its own inset range by this if rounding pushed it
/// out by a cell.
fn clamp_span(a0: i32, len: i32, lo: i32, hi: i32) -> i32 {
    if a0 < lo {
        lo
    } else if a0 + len > hi {
        hi - len
    } else {
        a0
    }
}

/// Builds the outer-rectangle footprint inside `plot_bounds`: `along_face`
/// centred on the row axis (inset by `half_gap` from each of `plot_
/// bounds`' own row-axis edges), `depth` measured inward from `front`'s
/// own true street-facing edge, offset by `setback`.
fn build_footprint(
    plot_bounds: Rect,
    front: Side,
    along_face: i32,
    depth: i32,
    half_gap: i32,
    setback: i32,
) -> Rect {
    match front {
        Side::North => {
            let cx = ((plot_bounds.x0 + plot_bounds.x1) / 2) - along_face / 2;
            let x0 = clamp_span(
                cx,
                along_face,
                plot_bounds.x0 + half_gap,
                plot_bounds.x1 - half_gap,
            );
            let y0 = plot_bounds.y0 + setback;
            Rect {
                x0,
                y0,
                x1: x0 + along_face,
                y1: y0 + depth,
            }
        }
        Side::South => {
            let cx = ((plot_bounds.x0 + plot_bounds.x1) / 2) - along_face / 2;
            let x0 = clamp_span(
                cx,
                along_face,
                plot_bounds.x0 + half_gap,
                plot_bounds.x1 - half_gap,
            );
            let y1 = plot_bounds.y1 - setback;
            Rect {
                x0,
                y0: y1 - depth,
                x1: x0 + along_face,
                y1,
            }
        }
        Side::West => {
            let cy = ((plot_bounds.y0 + plot_bounds.y1) / 2) - along_face / 2;
            let y0 = clamp_span(
                cy,
                along_face,
                plot_bounds.y0 + half_gap,
                plot_bounds.y1 - half_gap,
            );
            let x0 = plot_bounds.x0 + setback;
            Rect {
                x0,
                y0,
                x1: x0 + depth,
                y1: y0 + along_face,
            }
        }
        Side::East => {
            let cy = ((plot_bounds.y0 + plot_bounds.y1) / 2) - along_face / 2;
            let y0 = clamp_span(
                cy,
                along_face,
                plot_bounds.y0 + half_gap,
                plot_bounds.y1 - half_gap,
            );
            let x1 = plot_bounds.x1 - setback;
            Rect {
                x0: x1 - depth,
                y0,
                x1,
                y1: y0 + along_face,
            }
        }
    }
}

/// Sizes (or rejects) one plot's own envelope -- the one place per-plot
/// geometry is decided, called by [`run`] for every non-`open` plot and
/// directly by this module's own unit tests (never re-derived by them),
/// so a fixture can pin the sizing/rejection logic without also having to
/// satisfy AC4's whole-district count tolerance.
pub fn place_one(
    plot: &super::plots::Plot,
    plot_index: u32,
    rng: &mut Rng,
    cfg: &GenerationConfig,
) -> EnvelopeOutcome {
    let limits = cfg.envelope_limits(plot.land_use);
    let half_gap = side_gap_for(plot.density, cfg) / 2;
    let setback = setback_for(plot.density, cfg);

    let along_total = along_face_extent(plot.bounds, plot.front);
    let depth_total = depth_extent(plot.bounds, plot.front);
    let avail_along = along_total - 2 * half_gap as i64;
    let avail_depth = depth_total - setback as i64;

    if avail_along < limits.min_width_cells as i64 {
        return EnvelopeOutcome::Rejected {
            plot: plot_index,
            class: plot.land_use,
            reason: RejectReason::PlotTooNarrow,
        };
    }
    if avail_depth < limits.min_depth_cells as i64 {
        return EnvelopeOutcome::Rejected {
            plot: plot_index,
            class: plot.land_use,
            reason: RejectReason::PlotTooShallow,
        };
    }

    let along_hi = avail_along.min(limits.max_width_cells as i64);
    let along_lo = limits.min_width_cells as i64;
    let footprint_along = along_lo
        + if along_hi > along_lo {
            (rng.next_u64() % (along_hi - along_lo + 1) as u64) as i64
        } else {
            0
        };
    let depth_hi = avail_depth.min(limits.max_depth_cells as i64);
    let depth_lo = limits.min_depth_cells as i64;
    let footprint_depth = depth_lo
        + if depth_hi > depth_lo {
            (rng.next_u64() % (depth_hi - depth_lo + 1) as u64) as i64
        } else {
            0
        };

    let footprint = build_footprint(
        plot.bounds,
        plot.front,
        footprint_along as i32,
        footprint_depth as i32,
        half_gap,
        setback,
    );
    EnvelopeOutcome::Placed(Envelope {
        plot: plot_index,
        footprint,
        front: plot.front,
    })
}

/// [`run`]'s own outcome-building half, lifted out so a test can exercise
/// it directly (one `open` plot, a handful of plots) without also having
/// to satisfy AC4's own whole-district count tolerance below. Every non-
/// `open` plot gets exactly one [`EnvelopeOutcome`], via [`place_one`];
/// each plot seeds its own RNG stream from `(pass_seed, plot_index)`, so
/// one plot's own draw never reshuffles another's.
fn build_outcomes(city_seed: u64, plots: &PlotMap, cfg: &GenerationConfig) -> Vec<EnvelopeOutcome> {
    let pass_seed = seed_from_ids(city_seed, PASS_ID);
    let mut outcomes = Vec::new();
    for (i, p) in plots.plots().iter().enumerate() {
        if p.open {
            continue;
        }
        let plot_index = i as u32;
        let mut rng = Rng::new(seed_from_ids(pass_seed, plot_index as u64));
        outcomes.push(place_one(p, plot_index, &mut rng, cfg));
    }
    outcomes
}

/// Runs pass 4: [`build_outcomes`] for every non-`open` plot, then checks
/// the realised placed-envelope count for this seed against AC4's own
/// tolerance band -- `Err` outside it.
pub fn run(
    city_seed: u64,
    plots: &PlotMap,
    cfg: &GenerationConfig,
) -> Result<EnvelopeMap, GenerationError> {
    let map = EnvelopeMap {
        outcomes: build_outcomes(city_seed, plots, cfg),
    };

    let placed = map.placed_count();
    let site = plots.site();
    let site_cells = site.width() * site.height();
    let target = (cfg.envelope_target_count_per_million_cells * site_cells) / 1_000_000;
    let tolerance = cfg.envelope_count_tolerance_percent;
    let min = target * (100 - tolerance) / 100;
    let max = target * (100 + tolerance) / 100;
    if placed < min || placed > max {
        return Err(GenerationError::BuildingCountOutOfTolerance {
            got: placed,
            min,
            max,
        });
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;
    use crate::generation::land_use;
    use crate::generation::plots as plots_mod;
    use crate::generation::streets;
    use crate::generation::{GenerationConfig, LandUse, SiteBounds};

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    fn fixture_plot(
        bounds: Rect,
        front: Side,
        use_: LandUse,
        density: i32,
        open: bool,
    ) -> plots_mod::Plot {
        plots_mod::Plot {
            bounds,
            block: 0,
            front,
            land_use: use_,
            density,
            open,
        }
    }

    fn site_512() -> SiteBounds {
        SiteBounds {
            x0: 0,
            y0: 0,
            x1: 512,
            y1: 512,
        }
    }

    #[test]
    fn run_is_deterministic_for_the_same_seed() {
        let c = cfg();
        let lu = land_use::run(11, c.site(), &c).unwrap();
        let net = streets::run(11, &lu, &c);
        let pm = plots_mod::run(11, &lu, &net, &c);
        let a = run(11, &pm, &c).unwrap();
        let b = run(11, &pm, &c).unwrap();
        assert_eq!(a.outcomes(), b.outcomes());
    }

    #[test]
    fn a_plot_far_below_the_class_minimum_on_width_is_rejected_too_narrow() {
        let c = cfg();
        let limits = c.envelope_limits(LandUse::Residential);
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: (limits.min_width_cells - 1).max(1),
            y1: limits.min_depth_cells + 20,
        };
        let plot = fixture_plot(bounds, Side::South, LandUse::Residential, 90, false);
        let mut rng = Rng::new(1);
        let outcome = place_one(&plot, 0, &mut rng, &c);
        assert!(matches!(
            outcome,
            EnvelopeOutcome::Rejected {
                reason: RejectReason::PlotTooNarrow,
                ..
            }
        ));
    }

    #[test]
    fn a_plot_far_below_the_class_minimum_on_depth_is_rejected_too_shallow() {
        let c = cfg();
        let limits = c.envelope_limits(LandUse::Residential);
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: limits.min_width_cells + 20,
            y1: (limits.min_depth_cells - 1).max(1),
        };
        let plot = fixture_plot(bounds, Side::South, LandUse::Residential, 90, false);
        let mut rng = Rng::new(1);
        let outcome = place_one(&plot, 0, &mut rng, &c);
        assert!(matches!(
            outcome,
            EnvelopeOutcome::Rejected {
                reason: RejectReason::PlotTooShallow,
                ..
            }
        ));
    }

    #[test]
    fn a_plot_exactly_at_the_class_minimum_produces_an_envelope_never_smaller_than_the_minimum() {
        let c = cfg();
        let limits = c.envelope_limits(LandUse::Residential);
        // High density (>= threshold): setback and side gap both 0, so
        // `avail == plot bounds` exactly.
        let density = c.plot_high_density_threshold;
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: limits.min_width_cells,
            y1: limits.min_depth_cells,
        };
        let plot = fixture_plot(bounds, Side::South, LandUse::Residential, density, false);
        let mut rng = Rng::new(1);
        match place_one(&plot, 0, &mut rng, &c) {
            EnvelopeOutcome::Placed(e) => {
                assert_eq!(e.along_face_cells(), limits.min_width_cells as i64);
                assert_eq!(e.depth_cells(), limits.min_depth_cells as i64);
            }
            EnvelopeOutcome::Rejected { .. } => panic!("a plot exactly at the minimum must fit"),
        }
    }

    #[test]
    fn a_generously_sized_plot_never_yields_an_envelope_below_its_class_minimum() {
        let c = cfg();
        let limits = c.envelope_limits(LandUse::Commercial);
        let density = c.plot_high_density_threshold;
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: limits.max_width_cells + 30,
            y1: limits.max_depth_cells + 30,
        };
        let plot = fixture_plot(bounds, Side::North, LandUse::Commercial, density, false);
        let mut rng = Rng::new(1);
        match place_one(&plot, 0, &mut rng, &c) {
            EnvelopeOutcome::Placed(e) => {
                assert!(e.along_face_cells() >= limits.min_width_cells as i64);
                assert!(e.along_face_cells() <= limits.max_width_cells as i64);
                assert!(e.depth_cells() >= limits.min_depth_cells as i64);
                assert!(e.depth_cells() <= limits.max_depth_cells as i64);
            }
            EnvelopeOutcome::Rejected { .. } => panic!("a generous plot must fit"),
        }
    }

    #[test]
    fn every_placed_envelope_is_inside_its_own_plot() {
        let c = cfg();
        let lu = land_use::run(7, c.site(), &c).unwrap();
        let net = streets::run(7, &lu, &c);
        let pm = plots_mod::run(7, &lu, &net, &c);
        let map = run(7, &pm, &c).unwrap();
        for e in map.envelopes() {
            let p = pm.plots()[e.plot as usize];
            assert!(
                p.bounds.x0 <= e.footprint.x0
                    && e.footprint.x1 <= p.bounds.x1
                    && p.bounds.y0 <= e.footprint.y0
                    && e.footprint.y1 <= p.bounds.y1,
                "envelope {:?} escapes plot {:?}",
                e.footprint,
                p.bounds
            );
            assert_eq!(e.front, p.front);
        }
    }

    #[test]
    fn open_plots_never_get_an_envelope_outcome_at_all() {
        let plot = fixture_plot(
            Rect {
                x0: 0,
                y0: 0,
                x1: 50,
                y1: 50,
            },
            Side::South,
            LandUse::Residential,
            10,
            true,
        );
        let pm = plots_mod::PlotMap::test_fixture(site_512(), vec![plot]);
        let outcomes = build_outcomes(1, &pm, &cfg());
        assert!(outcomes.is_empty());
    }

    #[test]
    fn rejected_percent_of_an_empty_map_is_zero() {
        let map = EnvelopeMap::test_fixture(Vec::new());
        assert_eq!(map.rejected_percent(), 0);
    }

    #[test]
    fn rejected_percent_counts_rejections_over_every_attempted_plot() {
        let map = EnvelopeMap::test_fixture(vec![
            EnvelopeOutcome::Rejected {
                plot: 0,
                class: LandUse::Residential,
                reason: RejectReason::PlotTooNarrow,
            },
            EnvelopeOutcome::Rejected {
                plot: 1,
                class: LandUse::Residential,
                reason: RejectReason::PlotTooShallow,
            },
            EnvelopeOutcome::Placed(Envelope {
                plot: 2,
                footprint: Rect {
                    x0: 0,
                    y0: 0,
                    x1: 10,
                    y1: 10,
                },
                front: Side::South,
            }),
            EnvelopeOutcome::Placed(Envelope {
                plot: 3,
                footprint: Rect {
                    x0: 0,
                    y0: 0,
                    x1: 10,
                    y1: 10,
                },
                front: Side::South,
            }),
        ]);
        assert_eq!(map.rejected_percent(), 50);
    }

    #[test]
    fn a_deliberately_starved_config_makes_run_fail_the_building_count_tolerance_low() {
        let mut c = cfg();
        c.envelope_target_count_per_million_cells *= 100;
        let lu = land_use::run(3, c.site(), &c).unwrap();
        let net = streets::run(3, &lu, &c);
        let pm = plots_mod::run(3, &lu, &net, &c);
        let err = run(3, &pm, &c).unwrap_err();
        assert!(matches!(
            err,
            GenerationError::BuildingCountOutOfTolerance { .. }
        ));
    }

    #[test]
    fn a_deliberately_bloated_config_makes_run_fail_the_building_count_tolerance_high() {
        let mut c = cfg();
        c.envelope_target_count_per_million_cells = 1;
        let lu = land_use::run(3, c.site(), &c).unwrap();
        let net = streets::run(3, &lu, &c);
        let pm = plots_mod::run(3, &lu, &net, &c);
        let err = run(3, &pm, &c).unwrap_err();
        assert!(matches!(
            err,
            GenerationError::BuildingCountOutOfTolerance { .. }
        ));
    }

    #[test]
    fn run_succeeds_at_the_committed_config_on_a_handful_of_seeds() {
        let c = cfg();
        for seed in [1u64, 2, 3, 42, 123_456] {
            let lu = land_use::run(seed, c.site(), &c).unwrap();
            let net = streets::run(seed, &lu, &c);
            let pm = plots_mod::run(seed, &lu, &net, &c);
            run(seed, &pm, &c)
                .unwrap_or_else(|e| panic!("seed {seed} unexpectedly failed tolerance: {e}"));
        }
    }
}
