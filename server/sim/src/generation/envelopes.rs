//! Pass 4 (FR110, story 3.3): the building envelope. Receives pass 3's own
//! plots; hands down each non-`open` plot's own footprint (an abstract rect --
//! no wall cells, no entrance cell, no `ObjectDef` yet: the sealed shell
//! lands with the story that first rasterises, `front` is what it will
//! need). Reads density (the party-wall/side-gap and build-line step)
//! and each plot's own land use (the per-class minimum usable interior).
//!
//! **Rejection, never shrinking.** A plot too small for its own class's
//! minimum usable interior yields [`EnvelopeOutcome::Rejected`] -- a typed
//! outcome, counted (see [`EnvelopeMap::rejected_percent`]), never an
//! `Option::None` that disappears and never a footprint clamped below the
//! minimum. The minimum is checked against the *interior net* (the
//! footprint minus the wall ring on both axes), computed once in
//! [`super::GenerationConfig::envelope_limits`]. `plots::run`'s own row
//! depths already keep any real (non-`open`) plot at or above this
//! minimum, so this is now a defensive guard against a hand-built
//! fixture, not a path real generator output reaches.
//!
//! **Fill, then trim -- never a uniform draw down to the minimum.** A
//! footprint's own along-face size always fills its plot's full
//! available width exactly (variety there comes only from the plot
//! rhythm's own module widths, never from shaving the frontage); its
//! depth fills the plot's own available depth minus a small, keyed random
//! trim (`generation.envelopes.size_trim_max_cells`), never below the
//! class minimum.
//!
//! **The build line.** Every envelope on the same plot side of the same
//! block sits the same `setback` cells behind that side's own true
//! street-facing edge -- one shared value per block (density-derived, a
//! step function of `generation.plots.high_density_threshold`). A corner
//! plot -- one whose own row-axis edge coincides with its own *row*'s
//! edge (the union of every plot sharing its block and front; see
//! [`row_axis_is_corner`]), not necessarily its block's raw bounding
//! rect -- insets that edge by the same `setback` instead of the row
//! gap, so its footprint sits flush to both streets' own build lines,
//! not just its own front's.
//!
//! **Side gaps are 0 or `side_gap_periphery_cells`, never 1.** Below the
//! density threshold, every footprint insets by half that gap from its
//! own plot's row-axis edges (unless that edge is a corner, above); at or
//! above it, the inset is 0 (party walls, footprint flush with its own
//! plot's edges).
//!
//! **Building count fails generation.** [`run`] returns
//! [`super::GenerationError::BuildingCountOutOfTolerance`] when the
//! realised placed-envelope count, over the whole district, sits outside
//! [`super::GenerationConfig::building_count_band`] -- a seed that trips
//! this is a world that fails to create, never a silently thin or
//! overcrowded city.

use super::plots::{Plot, PlotMap};
use super::streets::Side;
use super::{GenerationConfig, GenerationError, LandUse, rect_seed_key};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

pub const PASS_ID: u64 = super::PASS_BUILDING_ENVELOPE;

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

/// Why a plot could not hold its own class's minimum envelope, checked in
/// this order (narrow before shallow).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RejectReason {
    PlotTooNarrow,
    PlotTooShallow,
}

/// Every non-`open` plot's own outcome -- a typed result, never an
/// `Option::None` that disappears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EnvelopeOutcome {
    Placed(Envelope),
    Rejected {
        plot: u32,
        class: LandUse,
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

    /// Rejection rate gets its own key, asserted per city -- without it a
    /// generator that rejects half the district still passes every other
    /// property until AC4 catches it for the wrong reason. `0` when no
    /// plot attempted an envelope at all (nothing to reject).
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

/// Whether each of a plot's own two row-edges is the outer edge of its
/// own *row* -- `row_bounds`, the row-axis span this plot's own row of
/// same-front plots tiles together (plots.rs's [`FACE_PRIORITY`] cut
/// order: a North or South row always spans its own block's own full
/// width, since neither face's own cut ever shrinks the other's row
/// axis, but an East or West row spans only the strip left after South
/// and North have each already taken theirs -- so a plot flush with its
/// own *block*'s raw bounding rect on that axis is not always the same
/// plot as one flush with its own *row*'s). An edge flush with its own
/// row's own bound is a corner, flush to that street's own build line
/// too; any other edge is shared with another same-front plot and must
/// stay tight. A plain inset *value* cannot carry this distinction on
/// its own: at or above the density threshold both `setback` and
/// `half_gap` are 0, so a corner and a neighbour edge become numerically
/// identical -- [`anchored_span`] needs the boolean, not the (possibly
/// zero) inset.
fn row_axis_is_corner(plot_bounds: Rect, row_bounds: Rect, front: Side) -> (bool, bool) {
    match front {
        Side::North | Side::South => (
            plot_bounds.x0 == row_bounds.x0,
            plot_bounds.x1 == row_bounds.x1,
        ),
        Side::East | Side::West => (
            plot_bounds.y0 == row_bounds.y0,
            plot_bounds.y1 == row_bounds.y1,
        ),
    }
}

/// The row-axis inset on each of a plot's own two row-edges: `setback`
/// on a corner edge (see [`row_axis_is_corner`]), `half_gap` otherwise
/// (an ordinary neighbour-facing edge).
fn row_axis_insets(
    plot_bounds: Rect,
    row_bounds: Rect,
    front: Side,
    half_gap: i32,
    setback: i32,
) -> (i32, i32) {
    let (corner_lo, corner_hi) = row_axis_is_corner(plot_bounds, row_bounds, front);
    (
        if corner_lo { setback } else { half_gap },
        if corner_hi { setback } else { half_gap },
    )
}

/// The row-axis span every plot sharing a `(block, front)` tiles
/// together (see [`row_axis_is_corner`]) -- the union of their own row-
/// axis extents, keyed by every `(block, front)` pair `plots` actually
/// has. A `BTreeMap`, not a `HashMap`: this is folded once per whole
/// `PlotMap` and looked up per plot, never iterated, but NFR28 rules out
/// an unordered collection on principle everywhere in this module.
pub fn row_bounds_by_block_front(plots: &[Plot]) -> std::collections::BTreeMap<(u32, Side), Rect> {
    let mut row_bounds: std::collections::BTreeMap<(u32, Side), Rect> =
        std::collections::BTreeMap::new();
    for p in plots {
        let Some(front) = p.front else { continue };
        row_bounds
            .entry((p.block, front))
            .and_modify(|acc| {
                *acc = match front {
                    Side::North | Side::South => Rect {
                        x0: acc.x0.min(p.bounds.x0),
                        x1: acc.x1.max(p.bounds.x1),
                        ..*acc
                    },
                    Side::East | Side::West => Rect {
                        y0: acc.y0.min(p.bounds.y0),
                        y1: acc.y1.max(p.bounds.y1),
                        ..*acc
                    },
                }
            })
            .or_insert(p.bounds);
    }
    row_bounds
}

/// Positions a `len`-long span inside `[lo, hi]`, anchored flush to
/// whichever side is *not* a corner (`corner_lo`/`corner_hi`, from
/// [`row_axis_is_corner`]) -- a real neighbour-facing edge never carries
/// the slack a capped, oversized plot (a corner or a rhythm-remainder
/// plot wider than `max_width_cells`) leaves once its footprint is
/// smaller than the plot's own available span; that slack goes to the
/// corner/street edge instead, where it reads as extra frontage margin,
/// never a 1-cell slit toward a real neighbour. A plain inset-value
/// comparison cannot make this call: at or above the density threshold
/// both `setback` and `half_gap` are 0, so a corner and a neighbour edge
/// are numerically identical even though only one of them may ever carry
/// slack. Centred only when both edges are corners or both are
/// neighbours (an ordinary interior plot is never capped in practice,
/// since `from_balance` refuses a class's own `max_width_cells` over
/// `envelopes.max_width_cells`).
fn anchored_span(len: i32, lo: i32, hi: i32, corner_lo: bool, corner_hi: bool) -> i32 {
    let avail = hi - lo;
    if len >= avail {
        return lo;
    }
    match (corner_lo, corner_hi) {
        (false, true) => lo,
        (true, false) => hi - len,
        _ => (lo + hi) / 2 - len / 2,
    }
}

/// Builds the outer-rectangle footprint inside `plot_bounds`: `along_face`
/// anchored on the row axis by [`anchored_span`] (inset by [`row_axis_
/// insets`] from each of `plot_bounds`' own row-axis edges), `depth`
/// measured inward from `front`'s own true street-facing edge, offset by
/// `setback`.
#[allow(clippy::too_many_arguments)]
fn build_footprint(
    plot_bounds: Rect,
    row_bounds: Rect,
    front: Side,
    along_face: i32,
    depth: i32,
    half_gap: i32,
    setback: i32,
) -> Rect {
    let (inset_lo, inset_hi) = row_axis_insets(plot_bounds, row_bounds, front, half_gap, setback);
    let (corner_lo, corner_hi) = row_axis_is_corner(plot_bounds, row_bounds, front);
    match front {
        Side::North => {
            let (lo, hi) = (plot_bounds.x0 + inset_lo, plot_bounds.x1 - inset_hi);
            let x0 = anchored_span(along_face, lo, hi, corner_lo, corner_hi);
            let y0 = plot_bounds.y0 + setback;
            Rect {
                x0,
                y0,
                x1: x0 + along_face,
                y1: y0 + depth,
            }
        }
        Side::South => {
            let (lo, hi) = (plot_bounds.x0 + inset_lo, plot_bounds.x1 - inset_hi);
            let x0 = anchored_span(along_face, lo, hi, corner_lo, corner_hi);
            let y1 = plot_bounds.y1 - setback;
            Rect {
                x0,
                y0: y1 - depth,
                x1: x0 + along_face,
                y1,
            }
        }
        Side::West => {
            let (lo, hi) = (plot_bounds.y0 + inset_lo, plot_bounds.y1 - inset_hi);
            let y0 = anchored_span(along_face, lo, hi, corner_lo, corner_hi);
            let x0 = plot_bounds.x0 + setback;
            Rect {
                x0,
                y0,
                x1: x0 + depth,
                y1: y0 + along_face,
            }
        }
        Side::East => {
            let (lo, hi) = (plot_bounds.y0 + inset_lo, plot_bounds.y1 - inset_hi);
            let y0 = anchored_span(along_face, lo, hi, corner_lo, corner_hi);
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
/// satisfy AC4's whole-district count tolerance. `row_bounds` is this
/// plot's own row's row-axis span (see [`row_axis_is_corner`]), for the
/// corner build-line check.
pub fn place_one(
    plot: &Plot,
    plot_index: u32,
    row_bounds: Rect,
    rng: &mut Rng,
    cfg: &GenerationConfig,
) -> EnvelopeOutcome {
    let front = plot
        .front
        .expect("a non-open plot always has a front, by plots::run's own construction");
    let limits = cfg.envelope_limits(plot.land_use);
    let half_gap = cfg.side_gap_cells(plot.density) / 2;
    let setback = cfg.setback_cells(plot.density);
    let (inset_lo, inset_hi) = row_axis_insets(plot.bounds, row_bounds, front, half_gap, setback);

    let along_total = along_face_extent(plot.bounds, front);
    let depth_total = depth_extent(plot.bounds, front);
    let avail_along = along_total - inset_lo as i64 - inset_hi as i64;
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

    // The along-face size always fills what the plot makes available --
    // never trimmed, never jittered smaller: side gaps and the build
    // line are exact, by construction, never "exact plus jitter".
    let footprint_along = avail_along.min(limits.max_width_cells as i64);

    // Depth fills the same way, minus a small keyed trim for variety --
    // never below the class minimum.
    let depth_filled = avail_depth.min(limits.max_depth_cells as i64);
    let trim_max = cfg.envelope_size_trim_max_cells as i64;
    let trim = if trim_max > 0 {
        (rng.next_u64() % (trim_max + 1) as u64) as i64
    } else {
        0
    };
    let footprint_depth = (depth_filled - trim).max(limits.min_depth_cells as i64);

    let footprint = build_footprint(
        plot.bounds,
        row_bounds,
        front,
        footprint_along as i32,
        footprint_depth as i32,
        half_gap,
        setback,
    );
    EnvelopeOutcome::Placed(Envelope {
        plot: plot_index,
        footprint,
        front,
    })
}

/// [`run`]'s own outcome-building half, exposed so a checker can inspect
/// every outcome independently of AC4's own whole-district count verdict
/// below (an outlier city is still worth inspecting, not just the ones
/// that clear tolerance). Every non-`open` plot gets exactly one
/// [`EnvelopeOutcome`], via [`place_one`]; each plot seeds its own RNG
/// stream from its own bounds ([`rect_seed_key`]), never from its
/// position in `plots.plots()`. Each plot's own row bounds (see
/// [`row_axis_is_corner`]) come from `plots` alone -- the union of every
/// plot sharing its `(block, front)` -- never from a block's raw
/// bounding rect, which an `East`/`West` row's own row axis need not
/// match (plots.rs's own [`super::plots::FACE_PRIORITY`] cut order can
/// shrink it).
pub fn place_all(city_seed: u64, plots: &PlotMap, cfg: &GenerationConfig) -> EnvelopeMap {
    let pass_seed = seed_from_ids(city_seed, PASS_ID);
    let row_bounds = row_bounds_by_block_front(plots.plots());
    let mut outcomes = Vec::new();
    for (i, p) in plots.plots().iter().enumerate() {
        if p.open {
            continue;
        }
        let plot_index = i as u32;
        let front = p
            .front
            .expect("a non-open plot always has a front, by plots::run's own construction");
        let bounds = row_bounds
            .get(&(p.block, front))
            .copied()
            .unwrap_or(p.bounds);
        let mut rng = Rng::new(seed_from_ids(pass_seed, rect_seed_key(p.bounds)));
        outcomes.push(place_one(p, plot_index, bounds, &mut rng, cfg));
    }
    EnvelopeMap { outcomes }
}

/// Runs pass 4: [`place_all`], then checks the realised placed-envelope
/// count for this seed against [`super::GenerationConfig::
/// building_count_band`] -- `Err` outside it.
pub fn run(
    city_seed: u64,
    plots: &PlotMap,
    cfg: &GenerationConfig,
) -> Result<EnvelopeMap, GenerationError> {
    let map = place_all(city_seed, plots, cfg);

    let placed = map.placed_count();
    let site = plots.site();
    let site_cells = site.width() * site.height();
    let (min, max) = cfg.building_count_band(site_cells);
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
            front: Some(front),
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

    /// A row bounds generous enough that `row_axis_insets` never treats
    /// the fixture plot's own edges as a corner (its edges sit strictly
    /// inside it, not flush with it).
    fn loose_row_bounds() -> Rect {
        Rect {
            x0: -1000,
            y0: -1000,
            x1: 1000,
            y1: 1000,
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
    fn an_envelope_placed_from_a_plot_alone_equals_the_one_placed_in_the_full_run() {
        let c = cfg();
        let lu = land_use::run(23, c.site(), &c).unwrap();
        let net = streets::run(23, &lu, &c);
        let pm = plots_mod::run(23, &lu, &net, &c);
        let full = place_all(23, &pm, &c);

        for (i, p) in pm.plots().iter().enumerate() {
            if p.open {
                continue;
            }
            let front = p.front.unwrap();
            let bounds = row_bounds_by_block_front(pm.plots())[&(p.block, front)];
            let pass_seed = seed_from_ids(23, PASS_ID);
            let mut rng = Rng::new(seed_from_ids(pass_seed, rect_seed_key(p.bounds)));
            let alone = place_one(p, i as u32, bounds, &mut rng, &c);
            let in_full = full
                .outcomes()
                .iter()
                .find(|o| match o {
                    EnvelopeOutcome::Placed(e) => e.plot == i as u32,
                    EnvelopeOutcome::Rejected { plot, .. } => *plot == i as u32,
                })
                .unwrap();
            assert_eq!(alone, *in_full, "plot index {i}");
        }
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
        let outcome = place_one(&plot, 0, loose_row_bounds(), &mut rng, &c);
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
        let outcome = place_one(&plot, 0, loose_row_bounds(), &mut rng, &c);
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
        match place_one(&plot, 0, loose_row_bounds(), &mut rng, &c) {
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
        match place_one(&plot, 0, loose_row_bounds(), &mut rng, &c) {
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
    fn a_high_density_plot_fills_its_full_along_face_width_exactly() {
        // At or above the density threshold, the footprint's own
        // along-face size is never smaller than the plot's own full
        // width -- variety comes from the plot rhythm and depth alone,
        // never from shaving the frontage.
        let c = cfg();
        let limits = c.envelope_limits(LandUse::Residential);
        let width = limits.min_width_cells + 3;
        let bounds = Rect {
            x0: 0,
            y0: 0,
            x1: width,
            y1: limits.max_depth_cells + 30,
        };
        let plot = fixture_plot(
            bounds,
            Side::South,
            LandUse::Residential,
            c.plot_high_density_threshold,
            false,
        );
        for seed in 0u64..20 {
            let mut rng = Rng::new(seed);
            match place_one(&plot, 0, loose_row_bounds(), &mut rng, &c) {
                EnvelopeOutcome::Placed(e) => {
                    assert_eq!(e.along_face_cells(), width as i64, "seed {seed}");
                }
                EnvelopeOutcome::Rejected { .. } => panic!("seed {seed}: must fit"),
            }
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
            assert_eq!(Some(e.front), p.front);
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
        let map = place_all(1, &pm, &cfg());
        assert!(map.outcomes().is_empty());
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

    /// The tolerance guard's own boundary, `target * (100 +- tol) / 100`,
    /// exercised exactly at `min-1`/`min`/`max`/`max+1` via a fixture
    /// with an exact, known placed count -- never only against a
    /// generated city whose count happens to land somewhere in the band.
    #[test]
    fn the_tolerance_boundary_is_exact_at_min_and_max() {
        let mut c = cfg();
        let site = SiteBounds {
            x0: 0,
            y0: 0,
            x1: 1000,
            y1: 1000,
        };
        let site_cells = site.width() * site.height();
        // Pick a target/tolerance that gives round, easy-to-hit numbers:
        // target = 100, tolerance = 10% -> band [90, 110].
        c.envelope_target_count_per_million_cells = 100 * 1_000_000 / site_cells;
        c.envelope_count_tolerance_percent = 10;
        let (min, max) = c.building_count_band(site_cells);

        let limits = c.envelope_limits(LandUse::Residential);
        let plot_bounds = |i: i32| Rect {
            x0: i * 200,
            y0: 0,
            x1: i * 200 + limits.min_width_cells + 4,
            y1: limits.min_depth_cells + 4,
        };
        let make_plots = |n: i64| -> plots_mod::PlotMap {
            let plots = (0..n)
                .map(|i| {
                    fixture_plot(
                        plot_bounds(i as i32),
                        Side::South,
                        LandUse::Residential,
                        c.plot_high_density_threshold,
                        false,
                    )
                })
                .collect();
            plots_mod::PlotMap::test_fixture(site, plots)
        };

        assert!(run(1, &make_plots(min - 1), &c).is_err(), "min-1 must fail");
        assert!(run(1, &make_plots(min), &c).is_ok(), "min must pass");
        assert!(run(1, &make_plots(max), &c).is_ok(), "max must pass");
        assert!(run(1, &make_plots(max + 1), &c).is_err(), "max+1 must fail");
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
