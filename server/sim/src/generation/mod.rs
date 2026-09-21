//! Stories 3.2-3.3 (FR110): the first four of the generator's seven
//! coarse-to-fine passes -- land use, the street network, plot
//! subdivision, then the building envelope. Pure functions and data only
//! (NFR28): every input is passed in by the caller, nothing here reads a
//! table, a clock or the filesystem.
//!
//! A pass's own signature carries FR110's ordering, not convention: a pass
//! takes the city seed, `&` the outputs of *earlier* passes it actually
//! reads (never a later pass, never by mutation) and [`GenerationConfig`]
//! -- nothing else. `streets::run` takes [`land_use::LandUseMap`] by
//! reference and cannot mutate it; `land_use.rs` never imports `streets`,
//! and no pass ever imports a pass later than itself. Persisting the
//! generated city or walking it is later stories' job (this module hands
//! down an abstract plan, never a `PlacedObject`); there is no table and
//! no reducer here.
//!
//! Each pass seeds its own [`crate::rng::Rng`] stream from
//! [`crate::rng::seed_from_ids`]`(city_seed, PASS_ID)`, so adding a draw to
//! one pass never reshuffles another. Pass ids are append-only, in FR110's
//! own order -- a pass not yet implemented still reserves its id. Within a
//! pass, each block (pass 2 on) and each plot (pass 4) further seeds its
//! own stream from stable geometry (its own bounds, never a list index or
//! position), so adding or moving one block or plot never reshuffles
//! another's draws.
//!
//! [`plan`] chains every implemented pass in order with no verdict;
//! [`generate`] is `plan` plus [`District::check_building_count`], what
//! production calls. Every cross-pass harness calls one of the two rather
//! than hand-chaining the four `run` functions; each pass's own `run`
//! stays public for its own unit tests and for the two properties that
//! deliberately feed one pass a perturbed predecessor.

pub mod building_types;
pub mod envelopes;
pub mod land_use;
pub mod plots;
pub mod site;
pub mod streets;

pub use building_types::{BuildingTypeMap, TypeAssignment};
pub use envelopes::{Envelope, EnvelopeMap, EnvelopeOutcome, RejectReason};
pub use land_use::{LandUse, LandUseCell, LandUseMap, Region};
pub use plots::{Plot, PlotMap};
pub use site::DistrictSite;
pub use streets::{Block, Side, Sides, StreetClass, StreetEdge, StreetNetwork, block_sides};

use crate::generated::defs;
use crate::rng::seed_from_ids;
use crate::rules::{RuleSet, Violation};

/// A stable RNG seed key derived purely from a rect's own geometry, never
/// from its position in a list -- what a block or a plot seeds its own
/// stream from, so adding or moving an unrelated one never reshuffles
/// this one's draws.
pub fn rect_seed_key(r: SiteBounds) -> u64 {
    let lo = seed_from_ids(r.x0 as u32 as u64, r.y0 as u32 as u64);
    let hi = seed_from_ids(r.x1 as u32 as u64, r.y1 as u32 as u64);
    seed_from_ids(lo, hi)
}

/// Bumped whenever any implemented pass's algorithm or seeding changes in
/// a way that could move its output for a fixed seed -- `tests/goldens/
/// generation_v6.golden` is keyed to this, exactly like `sim::rng::
/// RNG_VERSION`/`sim::appearance::APPEARANCE_VERSION`.
pub const GENERATION_VERSION: u32 = 6;

/// Every way generation itself can fail, across every implemented pass --
/// one type, never a `Result<_, String>` per pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GenerationError {
    /// A balance-key configuration is internally inconsistent
    /// (`GenerationConfig::from_balance`'s own cross-key checks).
    InvalidConfig(String),
    /// Pass 1: `site`'s own extent is not a whole multiple of `coarse_
    /// cell_size_cells` -- refused, never silently truncated.
    InvalidSite {
        site: SiteBounds,
        coarse_cell_size_cells: i32,
    },
    /// Pass 4: the realised building count for this seed/config sits
    /// outside `[min, max]` -- a seed that trips this is a world that
    /// fails to create, never a silently thin or overcrowded city.
    BuildingCountOutOfTolerance { got: i64, min: i64, max: i64 },
    /// Pass 5 (FR112): `sim::rules::evaluate` found at least one
    /// violation over the finished district's own [`DistrictSite`] --
    /// `count` is the total, `first` the first (sorted) violation, never
    /// a fallback placement that skips the rules.
    RuleViolations { count: usize, first: Violation },
    /// Pass 5 (AC4): the realised workplace count (every placed envelope
    /// whose assigned type has at least one post) sits outside `[min,
    /// max]` -- the same shape as [`GenerationError::
    /// BuildingCountOutOfTolerance`].
    WorkplaceCountOutOfTolerance { got: i64, min: i64, max: i64 },
}

impl std::fmt::Display for GenerationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GenerationError::InvalidConfig(msg) => write!(f, "{msg}"),
            GenerationError::InvalidSite {
                site,
                coarse_cell_size_cells,
            } => write!(
                f,
                "land_use::run: site {site:?} is not a whole multiple of coarse_cell_size_cells ({coarse_cell_size_cells})"
            ),
            GenerationError::BuildingCountOutOfTolerance { got, min, max } => write!(
                f,
                "generation::envelopes: building count {got} is outside tolerance [{min}, {max}]"
            ),
            GenerationError::RuleViolations { count, first } => write!(
                f,
                "generation::building_types: {count} rule violation(s), first: rule {} at ({}, {}, {})",
                first.rule_id, first.subject.x, first.subject.y, first.subject.floor
            ),
            GenerationError::WorkplaceCountOutOfTolerance { got, min, max } => write!(
                f,
                "generation::building_types: workplace count {got} is outside tolerance [{min}, {max}]"
            ),
        }
    }
}

impl std::error::Error for GenerationError {}

/// Every content table [`plan`]/[`generate`] read, loaded once and
/// passed down as a struct -- Tim's direction: content is an input, one
/// signature, no `plan_with` twin, and the golden (which freezes a small,
/// deliberately-unrelated content table alongside its frozen config)
/// proves the generator never branches on a key.
#[derive(Debug, Clone, Copy)]
pub struct GenerationContent<'a> {
    pub rules: RuleSet<'a>,
    pub building_types: &'a [defs::BuildingTypeDef],
}

impl GenerationContent<'static> {
    /// The one non-test constructor: the committed rule table
    /// ([`RuleSet::committed`]) and `defs::BUILDING_TYPES` -- production
    /// reaches content only ever through this call.
    pub fn committed() -> Self {
        GenerationContent {
            rules: RuleSet::committed(),
            building_types: defs::BUILDING_TYPES,
        }
    }
}

/// One finished city plan: every implemented pass's own output, in order.
/// Never a `PlacedObject` -- still the abstract plan this module has
/// always handed down (FR110).
#[derive(Debug, Clone)]
pub struct District {
    pub land_use: LandUseMap,
    pub streets: StreetNetwork,
    pub plots: PlotMap,
    pub envelopes: EnvelopeMap,
    pub building_types: BuildingTypeMap,
}

impl District {
    /// AC4's own verdict on this finished district: `Err(GenerationError::
    /// BuildingCountOutOfTolerance)` when the realised placed-envelope
    /// count sits outside [`GenerationConfig::building_count_band`] for
    /// its own site -- a property of the whole plan, never folded into
    /// pass 4's own placement.
    pub fn check_building_count(&self, cfg: &GenerationConfig) -> Result<(), GenerationError> {
        envelopes::check_building_count(&self.envelopes, self.plots.site(), cfg)
    }

    /// Builds this district's own [`DistrictSite`] -- the one adapter
    /// both this check and pass 5's own placement build from the same
    /// fields (FR112).
    pub fn site(&self, content: &GenerationContent) -> DistrictSite {
        let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        DistrictSite::build(
            &self.envelopes,
            &self.plots,
            &self.streets,
            self.building_types.assignments(),
            &by_id,
        )
    }

    /// FR112's other half over a *finished* district: `sim::rules::
    /// evaluate` against this district's own [`DistrictSite`] must be
    /// empty, or generation fails with `Err(GenerationError::
    /// RuleViolations)` naming the total count and the first violation --
    /// never a fallback placement that quietly skips a rule.
    pub fn check_rules(&self, content: &GenerationContent) -> Result<(), GenerationError> {
        let site = self.site(content);
        let violations = crate::rules::evaluate(content.rules, &site);
        match violations.first().copied() {
            Some(first) => Err(GenerationError::RuleViolations {
                count: violations.len(),
                first,
            }),
            None => Ok(()),
        }
    }

    /// AC4's workplace-count verdict: every placed envelope whose
    /// assigned type has at least one post (Tim's direction: a workplace
    /// is derived, never a stored category), against
    /// [`GenerationConfig::workplace_count_band`].
    pub fn check_workplace_count(
        &self,
        cfg: &GenerationConfig,
        content: &GenerationContent,
    ) -> Result<(), GenerationError> {
        let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let got = self
            .building_types
            .assignments()
            .iter()
            .filter(|a| building_types::is_workplace(by_id[&a.building_type]))
            .count() as i64;
        let site_cells = self.plots.site().width() * self.plots.site().height();
        let (min, max) = cfg.workplace_count_band(site_cells);
        if got < min || got > max {
            return Err(GenerationError::WorkplaceCountOutOfTolerance { got, min, max });
        }
        Ok(())
    }
}

/// Chains every implemented pass, in FR110's own order, with no verdict
/// on the result -- only pass 1's own site check can fail. What a
/// harness that must inspect every pass of an outlier city calls.
pub fn plan(
    city_seed: u64,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> Result<District, GenerationError> {
    let land_use = land_use::run(city_seed, cfg.site(), cfg)?;
    let streets = streets::run(city_seed, &land_use, cfg);
    let plots = plots::run(city_seed, &land_use, &streets, cfg);
    let envelopes = envelopes::run(city_seed, &plots, cfg);
    let building_types = building_types::run(city_seed, &envelopes, &plots, &streets, cfg, content);
    Ok(District {
        land_use,
        streets,
        plots,
        envelopes,
        building_types,
    })
}

/// The one entry point production calls: [`plan`], then
/// [`District::check_building_count`], [`District::check_rules`] and
/// [`District::check_workplace_count`] -- a seed whose district fails any
/// of the three is a world that fails to create.
pub fn generate(
    city_seed: u64,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> Result<District, GenerationError> {
    let district = plan(city_seed, cfg, content)?;
    district.check_building_count(cfg)?;
    district.check_rules(content)?;
    district.check_workplace_count(cfg, content)?;
    Ok(district)
}

/// FR110's seven passes, coarse to fine -- append-only, never renumbered.
/// A pass not yet implemented still reserves its own id here.
pub const PASS_LAND_USE: u64 = 1;
pub const PASS_STREETS: u64 = 2;
pub const PASS_PLOT_SUBDIVISION: u64 = 3;
pub const PASS_BUILDING_ENVELOPE: u64 = 4;
pub const PASS_BUILDING_TYPE: u64 = 5;
pub const PASS_INTERIOR_LAYOUT: u64 = 6;
pub const PASS_PROP_PLACEMENT: u64 = 7;

/// The generated site's own world-absolute extent -- the same half-open
/// rect shape `sim::world::Rect` already is (world-absolute `i32` cells,
/// never a 0-based array index leaking out of this module), reused rather
/// than duplicated: the two are the same coordinate system.
pub type SiteBounds = crate::world::Rect;

/// Every balance-key input the two passes read, loaded once
/// (`from_balance`) and passed down as a struct -- neither pass looks up a
/// key or holds a literal.
#[derive(Debug, Clone, Copy)]
pub struct GenerationConfig {
    pub site_extent_cells: i32,

    pub coarse_cell_size_cells: i32,
    pub land_use_min_leaf_cells: i32,
    pub land_use_max_leaf_cells: i32,
    pub land_use_split_jitter_pct: i32,
    pub land_use_max_recursion_depth: u32,
    pub density_min: i32,
    pub density_max: i32,
    /// The density peak's own minimum/maximum offset from the coarse
    /// grid's geometric centre, each a percent of the grid's own half-
    /// extent, applied independently (and with an independently seeded
    /// sign) to x and y -- what makes the falloff asymmetric (NFR8; Artie's
    /// direction: never "a perfect concentric square centred on (256,
    /// 256)").
    pub density_peak_offset_min_pct: i32,
    pub density_peak_offset_max_pct: i32,
    /// District-count shares (not area shares -- `docs/generation.md`
    /// says so): the target number of districts (recursive-subdivision
    /// leaves) each use gets is `round(total_leaves * share_pct / 100)`,
    /// residential taking the remainder. Realised counts are asserted
    /// against these targets exactly (`land_use::tests`).
    pub share_residential_pct: i32,
    pub share_commercial_pct: i32,
    pub share_industrial_pct: i32,
    pub share_institutional_pct: i32,

    /// A city's own north-south (respectively east-west) arterial count
    /// is seeded uniformly in `[..._min, ..._max]` -- Artie's direction,
    /// cycle 2: a fixed count draws the same skeleton every time.
    pub arterial_count_ns_min: u32,
    pub arterial_count_ns_max: u32,
    pub arterial_count_ew_min: u32,
    pub arterial_count_ew_max: u32,
    pub arterial_width_cells: i32,
    pub street_width_cells: i32,
    pub lane_width_cells: i32,
    pub arterial_jitter_pct: i32,
    pub block_size_min_cells: i32,
    pub block_size_max_cells: i32,
    pub min_block_depth_cells: i32,
    /// The lane-tier short-side ceiling is interpolated between
    /// `..._max_cells` (at `density_min`, the periphery) and `..._
    /// min_cells` (at `density_max`, the core) -- the same shape as
    /// `block_size_min/max_cells` (Tim's direction, cycle 2: a flat
    /// ceiling cancelled the periphery's own visible size difference).
    pub max_block_depth_min_cells: i32,
    pub max_block_depth_max_cells: i32,
    pub split_jitter_pct: i32,
    pub max_recursion_depth: u32,
    pub max_lane_splits: u32,
    /// A superblock's own first this-many splits are street tier;
    /// further splits (even though still over the density target) drop
    /// to lane tier -- Artie's direction: mostly one street-tier split
    /// per long block, lanes doing the rest, so the core does not read
    /// as "half asphalt".
    pub max_street_splits_per_superblock: u32,
    /// Two junctions on the same street must either coincide (a true
    /// 4-way) or sit at least this many world cells apart -- never a
    /// near-miss crossroad a cell or two off (Tim's direction).
    pub junction_min_separation_cells: i32,
    /// The ratio ceiling `max_detour_percent` applies to (BFS network
    /// distance vs Manhattan distance) only over pairs at least this far
    /// apart (Manhattan) -- a single jitter-driven jog dominates the
    /// ratio at short range even in a real city. Short-range pairs are
    /// instead bounded by [`Self::max_detour_excess_cells`] (Quentin's
    /// direction, cycle 2: an additive bound is what the estimator
    /// actually pays for at short range, a ratio is not).
    pub detour_long_pair_cells: i32,
    pub max_detour_percent: i32,
    /// The absolute ceiling on `network - manhattan` (world cells),
    /// applied to every sampled pair regardless of distance -- the
    /// additive half of the detour contract (Quentin's direction, cycle
    /// 2).
    pub max_detour_excess_cells: i32,
    /// The 99th-percentile detour ratio, over one city's own sampled
    /// pairs, must not exceed this -- `max_detour_percent` alone only
    /// bounds the single worst pair, which stays green even if the
    /// *typical* case regressed (Tim's direction, cycle 2).
    pub p99_detour_percent: i32,
    /// The minimum number of distinct block widths (and, separately,
    /// heights) a single generated network must show -- Quentin's
    /// direction, cycle 1: "not a perfect grid" as a number, asserted
    /// over arbitrary seeds, not a literal repeated in test files.
    pub min_distinct_block_sizes: i64,
    /// Per-city anti-inversion floor for `StreetNetwork::mean_area_by_
    /// density_band`: the low-density (periphery) mean block area must
    /// be at least this percent of the high-density (core) mean --
    /// deliberately weak (real split-jitter noise puts a handful of
    /// seeds, out of 5,000 measured, within a hair of parity), never the
    /// guard that a density-blind generator fails (that is `peripheral_
    /// pooled_min_ratio_percent`, below) (Quentin's direction, cycle 4: a
    /// threshold literal in a test is a reject).
    pub peripheral_low_band_floor_percent: i32,
    /// The guard that actually fails on a density-blind generator: pooled
    /// over a fixed seed range (`0..256`), summed low-band mean area over
    /// summed high-band mean area must be at least this percent -- a
    /// density-blind network pools to ~100 (parity), this generator to
    /// ~241 (Quentin's direction, cycle 4).
    pub peripheral_pooled_min_ratio_percent: i32,
    /// The hard floor on institutional pocket count `land_use::assign_
    /// institutional`'s own relaxed fallback pass guarantees whenever any
    /// eligible leaf remains (Artie's direction, cycle 3; moved off a
    /// bare constant onto a balance key, Quentin's direction, cycle 4: a
    /// threshold literal in a test is a reject).
    pub institutional_min_pockets: i64,
    /// The AC's own area ceiling on any single institutional component,
    /// as a percent of the site's own coarse-cell count (Artie's
    /// direction, cycle 3; moved off a bare literal, Quentin's direction,
    /// cycle 4).
    pub institutional_max_pocket_share_percent: i64,

    // --- plots (pass 3) ---------------------------------------------
    /// AC1: a plot fronts a street iff it shares at least this many world
    /// cells of *edge length* with a street-abutting side of its own
    /// block (corner-point contact is landlocked) -- the one frontage
    /// definition [`plots::PlotMap::landlocked_plots`] checks.
    pub plot_frontage_min_cells: i32,
    /// The density (`land_use::LandUseCell::density`) at or above which a
    /// block's own build line sits flush on the pavement (setback 0,
    /// party-wall packing) -- below it, a block gets the single shared
    /// `plot_setback_periphery_cells` setback instead. Shared with
    /// `envelopes.rs`'s own side-gap step (same density line decides
    /// both).
    pub plot_high_density_threshold: i32,
    /// The one shared build-line setback every plot on a below-threshold
    /// block sits behind -- one line for the whole face.
    pub plot_setback_periphery_cells: i32,
    /// Per land use ([`LandUse::ALL`] order), the row of plot widths (the
    /// row axis, along the block face) a block of that use draws its
    /// rhythm module widths from, minimum end.
    pub plot_width_min_cells: [i32; 4],
    /// Per land use, the same band's maximum end.
    pub plot_width_max_cells: [i32; 4],
    /// Per land use, the ceiling on a plot's own depth from its block
    /// face inward (before the build-line setback is subtracted) -- two
    /// opposing rows meet at the block's own mid-line whenever it is
    /// shallower than twice this; past that, each row stops here and the
    /// leftover between them is the block's own core.
    pub plot_row_depth_cells: [i32; 4],
    /// The most a block's own leftover core (after every abutting face
    /// has cut its own row) may reach, on either axis, before it becomes
    /// an explicit, recorded `open` plot rather than being absorbed into
    /// the rows as rear yard -- at `density_max` (the peak); see
    /// [`Self::max_core_depth_cells`].
    pub plot_max_core_depth_cells: i32,
    /// The same ceiling at `density_min` (the periphery) -- deep rear
    /// gardens there, a small yard at the core.
    pub plot_max_core_depth_periphery_cells: i32,
    /// The minimum short side of any `open` plot this pass creates of its
    /// own accord (a core) -- a residue narrower than this is never a plot
    /// of its own.
    pub plot_open_min_side_cells: i32,
    /// The maximum percent of a district's own plots that may be `open`,
    /// by count.
    pub plot_max_open_percent_by_count: i64,
    /// The same ceiling's own area half: `open` plots can be
    /// individually rare but each cover a large share of the district's
    /// own plotted land.
    pub plot_max_open_percent_by_area: i64,
    /// The maximum percent of every block's own summed area that may
    /// belong to no plot at all, citywide.
    pub plot_max_unplotted_percent: i64,

    // --- building envelopes (pass 4) ---------------------------------
    /// The wall ring's own thickness, both axes -- interior usable floor
    /// is the plot-derived footprint minus two of these per axis.
    pub envelope_wall_thickness_cells: i32,
    /// Per land use, the minimum *usable interior* width a footprint must
    /// clear -- checked against the interior net (footprint minus the
    /// wall ring), never the outer rectangle.
    pub envelope_min_interior_width_cells: [i32; 4],
    /// Per land use, the same minimum's depth.
    pub envelope_min_interior_depth_cells: [i32; 4],
    /// The outer envelope ceiling, both axes shared across every land
    /// use.
    pub envelope_max_width_cells: i32,
    pub envelope_max_depth_cells: i32,
    /// The total gap between two neighbouring envelopes on a below-
    /// `plot_high_density_threshold` block -- half inset from each side,
    /// so it must be even (`from_balance` refuses an odd value). 0 at or
    /// above the threshold (party walls).
    pub envelope_side_gap_periphery_cells: i32,
    /// The most a footprint's own size draw may trim back from filling
    /// its plot's own available extent, on each axis independently --
    /// AC3's variety comes from this small trim and from the plot
    /// rhythm's own widths, never from a uniform draw down to the class
    /// minimum.
    pub envelope_size_trim_max_cells: i32,
    /// AC3's mean band, measured over the fixed seed range `0..256` at
    /// this generator's own committed config.
    pub envelope_mean_width_cells: i32,
    pub envelope_mean_width_tolerance_cells: i32,
    pub envelope_mean_depth_cells: i32,
    pub envelope_mean_depth_tolerance_cells: i32,
    /// NFR8/AC3's anti-cheat floor: the minimum number of distinct `(w,
    /// d)` footprint pairs a single generated district must show -- a
    /// city of identical boxes satisfies a mean band too.
    pub envelope_min_distinct_sizes: i64,
    /// AC4's own target, stated at the 512 reference extent per one
    /// million site cells and scaled by real site area inside `envelopes
    /// ::run` -- never a bare count, so NFR14's 1024 growth target (four
    /// times the cells) does not fail this for no reason.
    pub envelope_target_count_per_million_cells: i64,
    /// AC4's per-seed tolerance band around the scaled target, as a
    /// percent -- the wild-deviation guard.
    pub envelope_count_tolerance_percent: i64,
    /// AC4's pooled band: the mean placed count over a fixed seed range
    /// must sit within this percent of the scaled target.
    pub envelope_mean_count_tolerance_percent: i64,
    /// The maximum percent of attempted (non-`open`) plots the envelope
    /// pass may reject, asserted per city -- without it a generator that
    /// rejects half the district still passes every other property until
    /// AC4 catches it for the wrong reason.
    pub envelope_max_rejected_plot_percent: i64,

    // --- building types (pass 5) --------------------------------------
    /// AC4's own workplace-count target, stated at the 512 reference
    /// extent per one million site cells and scaled by real site area
    /// inside `District::check_workplace_count` -- the Scale Baseline's
    /// ~344 at 512x512 (`docs/gdd.md`), never a measurement.
    pub workplace_target_count_per_million_cells: i64,
    /// The per-seed tolerance band around the scaled workplace target, as
    /// a percent -- the wild-deviation guard, same shape as
    /// `envelope_count_tolerance_percent`.
    pub workplace_count_tolerance_percent: i64,
    /// The pooled band: the mean workplace count over a fixed seed range
    /// must sit within this percent of the scaled target.
    pub workplace_mean_count_tolerance_percent: i64,
    /// AC3: the fixed-extent square (world cells) a `[[distribution]]`
    /// row's own target is allocated over -- 256 at launch, so at the
    /// committed 512x512 site this *is* AC3's own quadrants; never a
    /// hardcoded 2x2 of the site (Derek's direction).
    pub building_type_catchment_extent_cells: i32,
}

fn get(balance: &[defs::BalanceSeed], key: &str) -> i64 {
    crate::balance::value(balance, key)
}

/// `LandUse`'s own balance-key naming segment, [`LandUse::ALL`] order --
/// the one place a per-land-use key's own name is built, shared by
/// `from_balance` and `docs/generation.md`'s own key list. Private
/// (PR #317 cycle 1, Tim's direction): `building_types.rs`'s own
/// eligibility check indexes `BuildingTypeDef::land_uses`'s `[bool; 4]`
/// mask by `LandUse as usize` directly, never a `&str` -- a generator
/// comparing strings is a content key reaching it in substance even when
/// a textual guard cannot see it.
fn land_use_key(u: LandUse) -> &'static str {
    match u {
        LandUse::Residential => "residential",
        LandUse::Commercial => "commercial",
        LandUse::Industrial => "industrial",
        LandUse::Institutional => "institutional",
    }
}

/// Reads one balance key per [`LandUse::ALL`] entry, substituting `{}` in
/// `template` for [`land_use_key`] -- the one place a per-land-use key
/// quartet is read, shared by every `plot_*`/`envelope_*` array field.
fn per_use_i32(balance: &[defs::BalanceSeed], template: &str) -> [i32; 4] {
    LandUse::ALL.map(|u| get(balance, &template.replace("{}", land_use_key(u))) as i32)
}

/// [`GenerationConfig::envelope_limits`]'s own return: the footprint
/// (outer-rectangle) size band one land use's envelopes must stay inside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnvelopeLimits {
    pub min_width_cells: i32,
    pub min_depth_cells: i32,
    pub max_width_cells: i32,
    pub max_depth_cells: i32,
}

impl GenerationConfig {
    /// Reads every key this module needs from `balance` (a caller always
    /// passes [`defs::BALANCE`] in production; a test may pass a smaller
    /// fixture slice, the same injectable shape `walkability::
    /// player_body_subcells` already uses). `balance` itself is trusted
    /// to carry every key this function reads -- `crate::balance::value`
    /// panics, naming the key, if one is missing; that is a defs-
    /// authoring bug, not a runtime config error, so it is never folded
    /// into this function's own `Result`. What *does* come back `Err`,
    /// never a panic, is a cross-key inconsistency a single key's own
    /// `min`/`max` range cannot express: the site extent not a whole
    /// multiple of the coarse cell size, a street width that is odd (a
    /// split cannot give both sides an exact, symmetric half-width), the
    /// four land-use shares not summing to 100, `land_use.max_leaf_cells`
    /// under twice `land_use.min_leaf_cells` (see `land_use::subdivide`'s
    /// own doc comment for why that ratio is what makes its minimum-
    /// leaf-size guarantee hold), `density_peak_offset_min_pct` over
    /// `density_peak_offset_max_pct`, or an arterial count's own `_min`
    /// over its `_max`.
    pub fn from_balance(balance: &[defs::BalanceSeed]) -> Result<Self, GenerationError> {
        let cfg = GenerationConfig {
            site_extent_cells: get(balance, "generation.site_extent_cells") as i32,
            coarse_cell_size_cells: get(balance, "generation.land_use.coarse_cell_size_cells")
                as i32,
            land_use_min_leaf_cells: get(balance, "generation.land_use.min_leaf_cells") as i32,
            land_use_max_leaf_cells: get(balance, "generation.land_use.max_leaf_cells") as i32,
            land_use_split_jitter_pct: get(balance, "generation.land_use.split_jitter_pct") as i32,
            land_use_max_recursion_depth: get(balance, "generation.land_use.max_recursion_depth")
                as u32,
            density_min: get(balance, "generation.land_use.density_min") as i32,
            density_max: get(balance, "generation.land_use.density_max") as i32,
            density_peak_offset_min_pct: get(
                balance,
                "generation.land_use.density_peak_offset_min_pct",
            ) as i32,
            density_peak_offset_max_pct: get(
                balance,
                "generation.land_use.density_peak_offset_max_pct",
            ) as i32,
            share_residential_pct: get(balance, "generation.land_use.share_residential_pct") as i32,
            share_commercial_pct: get(balance, "generation.land_use.share_commercial_pct") as i32,
            share_industrial_pct: get(balance, "generation.land_use.share_industrial_pct") as i32,
            share_institutional_pct: get(balance, "generation.land_use.share_institutional_pct")
                as i32,

            arterial_count_ns_min: get(balance, "generation.streets.arterial_count_ns_min") as u32,
            arterial_count_ns_max: get(balance, "generation.streets.arterial_count_ns_max") as u32,
            arterial_count_ew_min: get(balance, "generation.streets.arterial_count_ew_min") as u32,
            arterial_count_ew_max: get(balance, "generation.streets.arterial_count_ew_max") as u32,
            arterial_width_cells: get(balance, "generation.streets.arterial_width_cells") as i32,
            street_width_cells: get(balance, "generation.streets.street_width_cells") as i32,
            lane_width_cells: get(balance, "generation.streets.lane_width_cells") as i32,
            arterial_jitter_pct: get(balance, "generation.streets.arterial_jitter_pct") as i32,
            block_size_min_cells: get(balance, "generation.streets.block_size_min_cells") as i32,
            block_size_max_cells: get(balance, "generation.streets.block_size_max_cells") as i32,
            min_block_depth_cells: get(balance, "generation.streets.min_block_depth_cells") as i32,
            max_block_depth_min_cells: get(balance, "generation.streets.max_block_depth_min_cells")
                as i32,
            max_block_depth_max_cells: get(balance, "generation.streets.max_block_depth_max_cells")
                as i32,
            split_jitter_pct: get(balance, "generation.streets.split_jitter_pct") as i32,
            max_recursion_depth: get(balance, "generation.streets.max_recursion_depth") as u32,
            max_lane_splits: get(balance, "generation.streets.max_lane_splits") as u32,
            max_street_splits_per_superblock: get(
                balance,
                "generation.streets.max_street_splits_per_superblock",
            ) as u32,
            junction_min_separation_cells: get(
                balance,
                "generation.streets.junction_min_separation_cells",
            ) as i32,
            detour_long_pair_cells: get(balance, "generation.streets.detour_long_pair_cells")
                as i32,
            max_detour_percent: get(balance, "generation.streets.max_detour_percent") as i32,
            max_detour_excess_cells: get(balance, "generation.streets.max_detour_excess_cells")
                as i32,
            p99_detour_percent: get(balance, "generation.streets.p99_detour_percent") as i32,
            min_distinct_block_sizes: get(balance, "generation.streets.min_distinct_block_sizes"),
            peripheral_low_band_floor_percent: get(
                balance,
                "generation.streets.peripheral_low_band_floor_percent",
            ) as i32,
            peripheral_pooled_min_ratio_percent: get(
                balance,
                "generation.streets.peripheral_pooled_min_ratio_percent",
            ) as i32,
            institutional_min_pockets: get(
                balance,
                "generation.land_use.institutional_min_pockets",
            ),
            institutional_max_pocket_share_percent: get(
                balance,
                "generation.land_use.institutional_max_pocket_share_percent",
            ),

            plot_frontage_min_cells: get(balance, "generation.plots.frontage_min_cells") as i32,
            plot_high_density_threshold: get(balance, "generation.plots.high_density_threshold")
                as i32,
            plot_setback_periphery_cells: get(balance, "generation.plots.setback_periphery_cells")
                as i32,
            plot_width_min_cells: per_use_i32(balance, "generation.plots.{}_width_min_cells"),
            plot_width_max_cells: per_use_i32(balance, "generation.plots.{}_width_max_cells"),
            plot_row_depth_cells: per_use_i32(balance, "generation.plots.{}_row_depth_cells"),
            plot_max_core_depth_cells: get(balance, "generation.plots.max_core_depth_cells") as i32,
            plot_max_core_depth_periphery_cells: get(
                balance,
                "generation.plots.max_core_depth_periphery_cells",
            ) as i32,
            plot_open_min_side_cells: get(balance, "generation.plots.open_min_side_cells") as i32,
            plot_max_open_percent_by_count: get(
                balance,
                "generation.plots.max_open_percent_by_count",
            ),
            plot_max_open_percent_by_area: get(
                balance,
                "generation.plots.max_open_percent_by_area",
            ),
            plot_max_unplotted_percent: get(balance, "generation.plots.max_unplotted_percent"),

            envelope_wall_thickness_cells: get(balance, "generation.envelopes.wall_thickness_cells")
                as i32,
            envelope_min_interior_width_cells: per_use_i32(
                balance,
                "generation.envelopes.{}_min_interior_width_cells",
            ),
            envelope_min_interior_depth_cells: per_use_i32(
                balance,
                "generation.envelopes.{}_min_interior_depth_cells",
            ),
            envelope_max_width_cells: get(balance, "generation.envelopes.max_width_cells") as i32,
            envelope_max_depth_cells: get(balance, "generation.envelopes.max_depth_cells") as i32,
            envelope_side_gap_periphery_cells: get(
                balance,
                "generation.envelopes.side_gap_periphery_cells",
            ) as i32,
            envelope_size_trim_max_cells: get(balance, "generation.envelopes.size_trim_max_cells")
                as i32,
            envelope_mean_width_cells: get(balance, "generation.envelopes.mean_width_cells") as i32,
            envelope_mean_width_tolerance_cells: get(
                balance,
                "generation.envelopes.mean_width_tolerance_cells",
            ) as i32,
            envelope_mean_depth_cells: get(balance, "generation.envelopes.mean_depth_cells") as i32,
            envelope_mean_depth_tolerance_cells: get(
                balance,
                "generation.envelopes.mean_depth_tolerance_cells",
            ) as i32,
            envelope_min_distinct_sizes: get(balance, "generation.envelopes.min_distinct_sizes"),
            envelope_target_count_per_million_cells: get(
                balance,
                "generation.envelopes.target_count_per_million_cells",
            ),
            envelope_count_tolerance_percent: get(
                balance,
                "generation.envelopes.count_tolerance_percent",
            ),
            envelope_mean_count_tolerance_percent: get(
                balance,
                "generation.envelopes.mean_count_tolerance_percent",
            ),
            envelope_max_rejected_plot_percent: get(
                balance,
                "generation.envelopes.max_rejected_plot_percent",
            ),

            workplace_target_count_per_million_cells: get(
                balance,
                "generation.building_types.target_workplaces_per_million_cells",
            ),
            workplace_count_tolerance_percent: get(
                balance,
                "generation.building_types.workplace_count_tolerance_percent",
            ),
            workplace_mean_count_tolerance_percent: get(
                balance,
                "generation.building_types.workplace_mean_count_tolerance_percent",
            ),
            building_type_catchment_extent_cells: get(
                balance,
                "generation.building_types.catchment_extent_cells",
            ) as i32,
        };

        if cfg.coarse_cell_size_cells <= 0
            || cfg.site_extent_cells % cfg.coarse_cell_size_cells != 0
        {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: site extent {} is not a whole multiple of coarse cell size {}",
                cfg.site_extent_cells, cfg.coarse_cell_size_cells
            )));
        }
        for (name, w) in [
            ("arterial_width_cells", cfg.arterial_width_cells),
            ("street_width_cells", cfg.street_width_cells),
            ("lane_width_cells", cfg.lane_width_cells),
        ] {
            if w % 2 != 0 {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: generation.streets.{name} ({w}) must be even"
                )));
            }
        }
        let share_sum = cfg.share_residential_pct
            + cfg.share_commercial_pct
            + cfg.share_industrial_pct
            + cfg.share_institutional_pct;
        if share_sum != 100 {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: land-use shares sum to {share_sum}, not 100"
            )));
        }
        if cfg.land_use_max_leaf_cells < 2 * cfg.land_use_min_leaf_cells {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: land_use.max_leaf_cells ({}) must be at least twice land_use.min_leaf_cells ({}) -- otherwise an over-sized axis could be too small to legally split",
                cfg.land_use_max_leaf_cells, cfg.land_use_min_leaf_cells
            )));
        }
        if cfg.density_min > cfg.density_max {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: density_min ({}) is greater than density_max ({})",
                cfg.density_min, cfg.density_max
            )));
        }
        if cfg.density_peak_offset_min_pct > cfg.density_peak_offset_max_pct {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: density_peak_offset_min_pct ({}) is greater than density_peak_offset_max_pct ({})",
                cfg.density_peak_offset_min_pct, cfg.density_peak_offset_max_pct
            )));
        }
        if cfg.block_size_min_cells > cfg.block_size_max_cells {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: block_size_min_cells ({}) is greater than block_size_max_cells ({})",
                cfg.block_size_min_cells, cfg.block_size_max_cells
            )));
        }
        if cfg.max_block_depth_min_cells > cfg.max_block_depth_max_cells {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: max_block_depth_min_cells ({}) is greater than max_block_depth_max_cells ({})",
                cfg.max_block_depth_min_cells, cfg.max_block_depth_max_cells
            )));
        }
        // Not a worst-case claim (story 3.18, Tim's direction): this
        // generator has no tight structural bound on detour excess to
        // derive one from. A guillotine partition can lay running bond
        // (full-width cuts, independently jittered cross cuts), so a
        // straight crossing is blocked at every course and excess grows
        // with distance, not with block size; leaf size is not capped at
        // `block_size_max_cells` either (`try_split` refusal, `max_lane_
        // splits`, `max_recursion_depth` can all leave an over-target
        // leaf). Both the 2x and the later 3x formula here were a story
        // fitted to the last failing seed, not a derivation -- "T-
        // terminated dead-end spur" was even the wrong mechanism: the
        // degree-1 nodes a worst pair ends on are the ordinary boundary
        // exits every street has (there is no perimeter street), reached
        // one way, not a special spur case.
        //
        // So this is a loosening guard, not a worst-case claim: the
        // loosest additive ceiling this codebase accepts, stated as a
        // formula in largest-block units so it scales when the block
        // keys are retuned, coefficient the smallest integer that still
        // admits the committed `max_detour_excess_cells` (re-derive by
        // hand whenever either value changes).
        let detour_excess_loosening_guard =
            4 * cfg.block_size_max_cells as i64 + 2 * cfg.arterial_width_cells as i64;
        if cfg.max_detour_excess_cells as i64 > detour_excess_loosening_guard {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: max_detour_excess_cells ({}) is greater than the loosening guard 4*block_size_max_cells + 2*arterial_width_cells ({detour_excess_loosening_guard}) -- not a worst-case claim, just the loosest additive ceiling this codebase accepts",
                cfg.max_detour_excess_cells
            )));
        }
        if cfg.p99_detour_percent > cfg.max_detour_percent {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: p99_detour_percent ({}) is greater than max_detour_percent ({}) -- the typical case cannot be worse than the tail ceiling",
                cfg.p99_detour_percent, cfg.max_detour_percent
            )));
        }
        if cfg.peripheral_low_band_floor_percent as i64
            > cfg.peripheral_pooled_min_ratio_percent as i64
        {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: peripheral_low_band_floor_percent ({}) is greater than peripheral_pooled_min_ratio_percent ({}) -- the per-city anti-inversion floor cannot ask for more than the pooled, density-blind-failing guard does",
                cfg.peripheral_low_band_floor_percent, cfg.peripheral_pooled_min_ratio_percent
            )));
        }
        if cfg.arterial_count_ns_min > cfg.arterial_count_ns_max {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: arterial_count_ns_min ({}) is greater than arterial_count_ns_max ({})",
                cfg.arterial_count_ns_min, cfg.arterial_count_ns_max
            )));
        }
        if cfg.arterial_count_ew_min > cfg.arterial_count_ew_max {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: arterial_count_ew_min ({}) is greater than arterial_count_ew_max ({})",
                cfg.arterial_count_ew_min, cfg.arterial_count_ew_max
            )));
        }
        if cfg.envelope_side_gap_periphery_cells % 2 != 0 {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: generation.envelopes.side_gap_periphery_cells ({}) must be even -- half is inset from each of two neighbouring envelopes",
                cfg.envelope_side_gap_periphery_cells
            )));
        }
        for u in LandUse::ALL {
            let i = u as usize;
            if cfg.plot_width_min_cells[i] > cfg.plot_width_max_cells[i] {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: generation.plots.{}_width_min_cells ({}) is greater than {}_width_max_cells ({})",
                    land_use_key(u),
                    cfg.plot_width_min_cells[i],
                    land_use_key(u),
                    cfg.plot_width_max_cells[i]
                )));
            }
            let min_footprint_w =
                cfg.envelope_min_interior_width_cells[i] + 2 * cfg.envelope_wall_thickness_cells;
            let min_footprint_d =
                cfg.envelope_min_interior_depth_cells[i] + 2 * cfg.envelope_wall_thickness_cells;
            if min_footprint_w > cfg.plot_width_min_cells[i] {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: {} envelope minimum footprint width ({min_footprint_w}) is larger than the {} plot minimum ({}) can ever hold",
                    land_use_key(u),
                    land_use_key(u),
                    cfg.plot_width_min_cells[i]
                )));
            }
            if min_footprint_d > cfg.plot_row_depth_cells[i] {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: {} envelope minimum footprint depth ({min_footprint_d}) is larger than the {} plot row depth ({}) can ever hold",
                    land_use_key(u),
                    land_use_key(u),
                    cfg.plot_row_depth_cells[i]
                )));
            }
            if min_footprint_w > cfg.envelope_max_width_cells {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: {} envelope minimum footprint width ({min_footprint_w}) is greater than envelopes.max_width_cells ({})",
                    land_use_key(u),
                    cfg.envelope_max_width_cells
                )));
            }
            if min_footprint_d > cfg.envelope_max_depth_cells {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: {} envelope minimum footprint depth ({min_footprint_d}) is greater than envelopes.max_depth_cells ({})",
                    land_use_key(u),
                    cfg.envelope_max_depth_cells
                )));
            }
            // A plot at exactly its own class's minimum width/row depth
            // must still clear the *periphery* side gap/setback -- the
            // worst case `envelopes::place_one` ever subtracts from an
            // ordinary plot (a corner plot is cut wider by exactly the
            // extra inset its corner edge carries, so this is its case
            // too) -- or every below-`plot_high_density_threshold` block
            // of this use rejects its own minimum-width plot by
            // construction, not by bad luck.
            if min_footprint_w + cfg.envelope_side_gap_periphery_cells > cfg.plot_width_min_cells[i]
            {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: {} envelope minimum footprint width ({min_footprint_w}) plus envelopes.side_gap_periphery_cells ({}) is greater than plots.{}_width_min_cells ({}) -- every periphery plot at the class minimum would be rejected",
                    land_use_key(u),
                    cfg.envelope_side_gap_periphery_cells,
                    land_use_key(u),
                    cfg.plot_width_min_cells[i]
                )));
            }
            if min_footprint_d + cfg.plot_setback_periphery_cells > cfg.plot_row_depth_cells[i] {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: {} envelope minimum footprint depth ({min_footprint_d}) plus plots.setback_periphery_cells ({}) is greater than plots.{}_row_depth_cells ({}) -- every periphery plot at the class minimum would be rejected",
                    land_use_key(u),
                    cfg.plot_setback_periphery_cells,
                    land_use_key(u),
                    cfg.plot_row_depth_cells[i]
                )));
            }
            // An ordinary (non-corner, non-rhythm-remainder) plot's own
            // width never exceeds `plot_width_max_cells`, so keeping that
            // at or under `envelope_max_width_cells` is what keeps a
            // two-real-neighbour plot from ever needing its own footprint
            // capped -- `envelopes::anchored_span`'s own asymmetric-slack
            // rule exists for the rarer, single-neighbour corner/
            // remainder case, not for this one.
            if cfg.plot_width_max_cells[i] > cfg.envelope_max_width_cells {
                return Err(GenerationError::InvalidConfig(format!(
                    "GenerationConfig: plots.{}_width_max_cells ({}) is greater than envelopes.max_width_cells ({})",
                    land_use_key(u),
                    cfg.plot_width_max_cells[i],
                    cfg.envelope_max_width_cells
                )));
            }
        }
        let overall_min_footprint_w = (0..4)
            .map(|i| {
                cfg.envelope_min_interior_width_cells[i] + 2 * cfg.envelope_wall_thickness_cells
            })
            .min()
            .unwrap_or(0);
        if cfg.envelope_mean_width_cells < overall_min_footprint_w
            || cfg.envelope_mean_width_cells > cfg.envelope_max_width_cells
        {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: envelopes.mean_width_cells ({}) is outside [{overall_min_footprint_w}, {}]",
                cfg.envelope_mean_width_cells, cfg.envelope_max_width_cells
            )));
        }
        let overall_min_footprint_d = (0..4)
            .map(|i| {
                cfg.envelope_min_interior_depth_cells[i] + 2 * cfg.envelope_wall_thickness_cells
            })
            .min()
            .unwrap_or(0);
        if cfg.envelope_mean_depth_cells < overall_min_footprint_d
            || cfg.envelope_mean_depth_cells > cfg.envelope_max_depth_cells
        {
            return Err(GenerationError::InvalidConfig(format!(
                "GenerationConfig: envelopes.mean_depth_cells ({}) is outside [{overall_min_footprint_d}, {}]",
                cfg.envelope_mean_depth_cells, cfg.envelope_max_depth_cells
            )));
        }

        Ok(cfg)
    }

    /// Per-land-use envelope size limits, computed once here rather than
    /// re-derived by `envelopes::run` per plot: the minimum footprint is
    /// the class's own minimum usable interior plus two wall rings, the
    /// maximum is the shared outer ceiling.
    pub fn envelope_limits(&self, use_: LandUse) -> EnvelopeLimits {
        let i = use_ as usize;
        EnvelopeLimits {
            min_width_cells: self.envelope_min_interior_width_cells[i]
                + 2 * self.envelope_wall_thickness_cells,
            min_depth_cells: self.envelope_min_interior_depth_cells[i]
                + 2 * self.envelope_wall_thickness_cells,
            max_width_cells: self.envelope_max_width_cells,
            max_depth_cells: self.envelope_max_depth_cells,
        }
    }

    /// AC4's own `[min, max]` placed-building-count band for a site of
    /// `site_cells` world cells -- the one derivation `envelopes::run`,
    /// `generation_perf.rs` and the invariants all share, rather than each
    /// repeating `target * (100 +- tolerance) / 100`.
    pub fn building_count_band(&self, site_cells: i64) -> (i64, i64) {
        let target = self.building_count_target(site_cells);
        let tolerance = self.envelope_count_tolerance_percent;
        let min = target * (100 - tolerance) / 100;
        let max = target * (100 + tolerance) / 100;
        (min, max)
    }

    /// AC4's own scaled target for a site of `site_cells` world cells --
    /// the Scale Baseline figure, never a measurement.
    pub fn building_count_target(&self, site_cells: i64) -> i64 {
        (self.envelope_target_count_per_million_cells * site_cells) / 1_000_000
    }

    /// AC4's own `[min, max]` workplace-count band for a site of
    /// `site_cells` world cells -- the same shape as
    /// [`Self::building_count_band`].
    pub fn workplace_count_band(&self, site_cells: i64) -> (i64, i64) {
        let target = self.workplace_count_target(site_cells);
        let tolerance = self.workplace_count_tolerance_percent;
        let min = target * (100 - tolerance) / 100;
        let max = target * (100 + tolerance) / 100;
        (min, max)
    }

    /// AC4's own scaled workplace target for a site of `site_cells` world
    /// cells -- the Scale Baseline figure, never a measurement.
    pub fn workplace_count_target(&self, site_cells: i64) -> i64 {
        (self.workplace_target_count_per_million_cells * site_cells) / 1_000_000
    }

    /// The most a block at `density` may leave as a core before it becomes
    /// an explicit `open` plot: interpolated between `plot_max_core_depth_
    /// periphery_cells` (at `density_min`) and `plot_max_core_depth_cells`
    /// (at `density_max`), integer only.
    pub fn max_core_depth_cells(&self, density: i32) -> i32 {
        let span_density = (self.density_max - self.density_min).max(1);
        let span = self.plot_max_core_depth_periphery_cells - self.plot_max_core_depth_cells;
        let clamped = density.clamp(self.density_min, self.density_max);
        let d = clamped - self.density_min;
        self.plot_max_core_depth_periphery_cells - (span * d) / span_density
    }

    /// The one shared build-line setback a block at `density` sits behind
    /// -- 0 at or above `plot_high_density_threshold` (flush on the
    /// pavement), `plot_setback_periphery_cells` below it.
    pub fn setback_cells(&self, density: i32) -> i32 {
        if density >= self.plot_high_density_threshold {
            0
        } else {
            self.plot_setback_periphery_cells
        }
    }

    /// The total gap between two neighbouring envelopes at `density` --
    /// 0 at or above `plot_high_density_threshold` (party walls),
    /// `envelope_side_gap_periphery_cells` below it.
    pub fn side_gap_cells(&self, density: i32) -> i32 {
        if density >= self.plot_high_density_threshold {
            0
        } else {
            self.envelope_side_gap_periphery_cells
        }
    }

    /// The site bounds this config describes: `[0, site_extent_cells)`
    /// square, world-absolute origin at `(0, 0)` -- the one place that
    /// origin is decided (Epic 14 may relocate it later; nothing else in
    /// this module assumes it).
    pub fn site(&self) -> SiteBounds {
        SiteBounds {
            x0: 0,
            y0: 0,
            x1: self.site_extent_cells,
            y1: self.site_extent_cells,
        }
    }
}

/// A block's own land use, decided once by majority coarse-cell *area*
/// rather than tinted per cell -- Artie's direction, cycle 2: boundary-
/// snapping never reliably closed the gap between a district edge and a
/// street (a boundary can sit anywhere within the snap tolerance), so a
/// street's own frontage could still change use mid-block. Majority
/// area after the fact means a change of use only ever happens at a
/// real block edge (a street), by construction -- there is no longer
/// anything to snap. Ties (a block split exactly down a district line)
/// go to whichever [`LandUse`] sorts first, deterministic, never
/// iteration order.
pub fn block_land_use(land_use: &LandUseMap, block_bounds: SiteBounds) -> LandUse {
    let cell = land_use.cell_size().max(1);
    let site = land_use.site();
    let cx0 = ((block_bounds.x0 - site.x0).div_euclid(cell)).max(0);
    let cx1 = (((block_bounds.x1 - site.x0 - 1).div_euclid(cell)) + 1).min(land_use.cols());
    let cy0 = ((block_bounds.y0 - site.y0).div_euclid(cell)).max(0);
    let cy1 = (((block_bounds.y1 - site.y0 - 1).div_euclid(cell)) + 1).min(land_use.rows());

    let mut area: std::collections::BTreeMap<LandUse, i64> = std::collections::BTreeMap::new();
    for cy in cy0..cy1 {
        for cx in cx0..cx1 {
            let Some(c) = land_use.coarse_at(cx, cy) else {
                continue;
            };
            let cell_rect = SiteBounds {
                x0: site.x0 + cx * cell,
                y0: site.y0 + cy * cell,
                x1: site.x0 + (cx + 1) * cell,
                y1: site.y0 + (cy + 1) * cell,
            };
            let ox = (cell_rect.x1.min(block_bounds.x1) - cell_rect.x0.max(block_bounds.x0)).max(0);
            let oy = (cell_rect.y1.min(block_bounds.y1) - cell_rect.y0.max(block_bounds.y0)).max(0);
            *area.entry(c.use_).or_insert(0) += (ox as i64) * (oy as i64);
        }
    }
    let mut best: Option<(LandUse, i64)> = None;
    for (u, a) in area {
        if best.is_none_or(|(_, best_area)| a > best_area) {
            best = Some((u, a));
        }
    }
    best.map(|(u, _)| u).unwrap_or(LandUse::Residential)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(key: &'static str, value: i64, min: i64, max: i64) -> defs::BalanceSeed {
        defs::BalanceSeed {
            key,
            value,
            min,
            max,
        }
    }

    /// A complete, valid fixture balance slice -- every test below starts
    /// from a clone of this and perturbs exactly the key(s) under test, so
    /// a failure is never explained by an unrelated missing key.
    fn valid_balance() -> Vec<defs::BalanceSeed> {
        vec![
            seed("generation.site_extent_cells", 512, 64, 2048),
            seed("generation.land_use.coarse_cell_size_cells", 16, 1, 128),
            seed("generation.land_use.min_leaf_cells", 4, 1, 64),
            seed("generation.land_use.max_leaf_cells", 10, 2, 128),
            seed("generation.land_use.split_jitter_pct", 30, 0, 45),
            seed("generation.land_use.max_recursion_depth", 8, 1, 20),
            seed("generation.land_use.density_min", 10, 0, 1000),
            seed("generation.land_use.density_max", 100, 0, 1000),
            seed("generation.land_use.density_peak_offset_min_pct", 15, 0, 50),
            seed("generation.land_use.density_peak_offset_max_pct", 40, 0, 50),
            seed("generation.land_use.share_residential_pct", 58, 0, 100),
            seed("generation.land_use.share_commercial_pct", 18, 0, 100),
            seed("generation.land_use.share_industrial_pct", 14, 0, 100),
            seed("generation.land_use.share_institutional_pct", 10, 0, 100),
            seed("generation.streets.arterial_count_ns_min", 2, 0, 4),
            seed("generation.streets.arterial_count_ns_max", 3, 0, 4),
            seed("generation.streets.arterial_count_ew_min", 1, 0, 4),
            seed("generation.streets.arterial_count_ew_max", 2, 0, 4),
            seed("generation.streets.arterial_width_cells", 12, 2, 64),
            seed("generation.streets.street_width_cells", 8, 2, 64),
            seed("generation.streets.lane_width_cells", 4, 2, 64),
            seed("generation.streets.arterial_jitter_pct", 60, 0, 90),
            seed("generation.streets.block_size_min_cells", 40, 4, 512),
            seed("generation.streets.block_size_max_cells", 96, 4, 512),
            seed("generation.streets.min_block_depth_cells", 16, 2, 256),
            seed("generation.streets.max_block_depth_min_cells", 40, 2, 1024),
            seed("generation.streets.max_block_depth_max_cells", 80, 2, 1024),
            seed("generation.streets.split_jitter_pct", 25, 0, 45),
            seed("generation.streets.max_recursion_depth", 12, 1, 64),
            seed("generation.streets.max_lane_splits", 4, 0, 16),
            seed(
                "generation.streets.max_street_splits_per_superblock",
                1,
                0,
                16,
            ),
            seed(
                "generation.streets.junction_min_separation_cells",
                28,
                1,
                256,
            ),
            seed("generation.streets.detour_long_pair_cells", 128, 1, 2048),
            seed("generation.streets.max_detour_percent", 200, 100, 500),
            seed("generation.streets.max_detour_excess_cells", 80, 1, 2048),
            seed("generation.streets.p99_detour_percent", 160, 100, 500),
            seed("generation.streets.min_distinct_block_sizes", 3, 1, 16),
            seed(
                "generation.streets.peripheral_low_band_floor_percent",
                70,
                1,
                100,
            ),
            seed(
                "generation.streets.peripheral_pooled_min_ratio_percent",
                150,
                100,
                1000,
            ),
            seed("generation.land_use.institutional_min_pockets", 3, 1, 16),
            seed(
                "generation.land_use.institutional_max_pocket_share_percent",
                6,
                1,
                100,
            ),
            seed("generation.plots.frontage_min_cells", 3, 1, 16),
            seed("generation.plots.high_density_threshold", 60, 0, 1000),
            seed("generation.plots.setback_periphery_cells", 2, 0, 8),
            seed("generation.plots.residential_width_min_cells", 10, 2, 64),
            seed("generation.plots.commercial_width_min_cells", 12, 2, 64),
            seed("generation.plots.industrial_width_min_cells", 14, 2, 64),
            seed("generation.plots.institutional_width_min_cells", 14, 2, 64),
            seed("generation.plots.residential_width_max_cells", 14, 2, 64),
            seed("generation.plots.commercial_width_max_cells", 18, 2, 64),
            seed("generation.plots.industrial_width_max_cells", 22, 2, 64),
            seed("generation.plots.institutional_width_max_cells", 22, 2, 64),
            seed("generation.plots.residential_row_depth_cells", 14, 2, 64),
            seed("generation.plots.commercial_row_depth_cells", 12, 2, 64),
            seed("generation.plots.industrial_row_depth_cells", 16, 2, 64),
            seed("generation.plots.institutional_row_depth_cells", 16, 2, 64),
            seed("generation.plots.max_core_depth_cells", 8, 2, 64),
            seed(
                "generation.plots.max_core_depth_periphery_cells",
                32,
                2,
                128,
            ),
            seed("generation.plots.open_min_side_cells", 8, 1, 64),
            seed("generation.plots.max_open_percent_by_count", 15, 0, 100),
            seed("generation.plots.max_open_percent_by_area", 15, 0, 100),
            seed("generation.plots.max_unplotted_percent", 20, 0, 100),
            seed("generation.envelopes.wall_thickness_cells", 1, 1, 4),
            seed(
                "generation.envelopes.residential_min_interior_width_cells",
                4,
                1,
                64,
            ),
            seed(
                "generation.envelopes.commercial_min_interior_width_cells",
                6,
                1,
                64,
            ),
            seed(
                "generation.envelopes.industrial_min_interior_width_cells",
                8,
                1,
                64,
            ),
            seed(
                "generation.envelopes.institutional_min_interior_width_cells",
                8,
                1,
                64,
            ),
            seed(
                "generation.envelopes.residential_min_interior_depth_cells",
                4,
                1,
                64,
            ),
            seed(
                "generation.envelopes.commercial_min_interior_depth_cells",
                6,
                1,
                64,
            ),
            seed(
                "generation.envelopes.industrial_min_interior_depth_cells",
                8,
                1,
                64,
            ),
            seed(
                "generation.envelopes.institutional_min_interior_depth_cells",
                8,
                1,
                64,
            ),
            seed("generation.envelopes.max_width_cells", 22, 4, 64),
            seed("generation.envelopes.max_depth_cells", 16, 4, 64),
            seed("generation.envelopes.side_gap_periphery_cells", 4, 0, 16),
            seed("generation.envelopes.size_trim_max_cells", 2, 0, 16),
            seed("generation.envelopes.mean_width_cells", 12, 2, 64),
            seed("generation.envelopes.mean_width_tolerance_cells", 4, 0, 32),
            seed("generation.envelopes.mean_depth_cells", 11, 2, 64),
            seed("generation.envelopes.mean_depth_tolerance_cells", 4, 0, 32),
            seed("generation.envelopes.min_distinct_sizes", 3, 1, 64),
            seed(
                "generation.envelopes.target_count_per_million_cells",
                3410,
                0,
                1_000_000,
            ),
            seed("generation.envelopes.count_tolerance_percent", 15, 0, 100),
            seed(
                "generation.envelopes.mean_count_tolerance_percent",
                3,
                0,
                100,
            ),
            seed("generation.envelopes.max_rejected_plot_percent", 5, 0, 100),
            seed(
                "generation.building_types.target_workplaces_per_million_cells",
                1312,
                0,
                1_000_000,
            ),
            seed(
                "generation.building_types.workplace_count_tolerance_percent",
                30,
                0,
                100,
            ),
            seed(
                "generation.building_types.workplace_mean_count_tolerance_percent",
                5,
                0,
                100,
            ),
            seed(
                "generation.building_types.catchment_extent_cells",
                256,
                1,
                100000,
            ),
        ]
    }

    fn with_override(key: &str, value: i64) -> Vec<defs::BalanceSeed> {
        let mut balance = valid_balance();
        let entry = balance.iter_mut().find(|b| b.key == key).unwrap();
        entry.value = value;
        balance
    }

    #[test]
    fn from_balance_reads_the_real_live_defs() {
        GenerationConfig::from_balance(defs::BALANCE).expect("live defs/ must be a valid config");
    }

    #[test]
    fn from_balance_accepts_a_valid_fixture() {
        let cfg = GenerationConfig::from_balance(&valid_balance()).unwrap();
        assert_eq!(cfg.site_extent_cells, 512);
        assert_eq!(
            cfg.site(),
            SiteBounds {
                x0: 0,
                y0: 0,
                x1: 512,
                y1: 512
            }
        );
    }

    #[test]
    fn from_balance_rejects_a_site_extent_not_a_multiple_of_the_coarse_cell_size() {
        let balance = with_override("generation.site_extent_cells", 500);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("whole multiple"));
    }

    #[test]
    fn from_balance_rejects_an_odd_street_width() {
        let balance = with_override("generation.streets.street_width_cells", 7);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("must be even"));
    }

    #[test]
    fn from_balance_rejects_shares_not_summing_to_100() {
        let balance = with_override("generation.land_use.share_residential_pct", 59);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("sum to"));
    }

    #[test]
    fn from_balance_rejects_density_min_over_density_max() {
        let balance = with_override("generation.land_use.density_min", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("density_min"));
    }

    #[test]
    fn from_balance_rejects_block_size_min_over_max() {
        let balance = with_override("generation.streets.block_size_min_cells", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("block_size_min_cells"));
    }

    #[test]
    fn from_balance_rejects_max_leaf_cells_under_twice_min_leaf_cells() {
        let mut balance = valid_balance();
        balance
            .iter_mut()
            .find(|b| b.key == "generation.land_use.min_leaf_cells")
            .unwrap()
            .value = 10;
        balance
            .iter_mut()
            .find(|b| b.key == "generation.land_use.max_leaf_cells")
            .unwrap()
            .value = 15;
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("max_leaf_cells"));
    }

    #[test]
    fn from_balance_accepts_max_leaf_cells_at_exactly_twice_min_leaf_cells() {
        let mut balance = valid_balance();
        balance
            .iter_mut()
            .find(|b| b.key == "generation.land_use.min_leaf_cells")
            .unwrap()
            .value = 5;
        balance
            .iter_mut()
            .find(|b| b.key == "generation.land_use.max_leaf_cells")
            .unwrap()
            .value = 10;
        GenerationConfig::from_balance(&balance)
            .expect("exactly twice must be accepted, not just over it");
    }

    #[test]
    fn from_balance_rejects_a_non_positive_coarse_cell_size() {
        // coarse_cell_size_cells' own declared min (1) already refuses 0
        // at the defs/-authoring level; this pins the from_balance guard
        // itself, independent of that authoring-time range, the same way
        // every other cross-key check here is pinned against a
        // deliberately-broken fixture rather than trusted from defs/.
        let balance = with_override("generation.land_use.coarse_cell_size_cells", 0);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("whole multiple"));
    }

    #[test]
    fn from_balance_rejects_peak_offset_min_over_max() {
        let balance = with_override("generation.land_use.density_peak_offset_min_pct", 45);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("density_peak_offset_min_pct"));
    }

    #[test]
    fn from_balance_rejects_max_block_depth_min_over_max() {
        let balance = with_override("generation.streets.max_block_depth_min_cells", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("max_block_depth_min_cells"));
    }

    #[test]
    fn from_balance_rejects_p99_detour_percent_over_max_detour_percent() {
        let balance = with_override("generation.streets.p99_detour_percent", 500);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("p99_detour_percent"));
    }

    #[test]
    fn from_balance_rejects_max_detour_excess_cells_over_the_loosening_guard() {
        // fixture: block_size_max_cells=96, arterial_width_cells=12 ->
        // guard = 4*96 + 2*12 = 408.
        let balance = with_override("generation.streets.max_detour_excess_cells", 409);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("max_detour_excess_cells"));
        assert!(err.to_string().contains("loosening guard"));
    }

    #[test]
    fn from_balance_accepts_max_detour_excess_cells_at_the_loosening_guard() {
        // Same fixture as above, right on the boundary: the guard itself
        // (408) is admitted, only a value strictly over it is refused
        // (AC4's mechanical both-sides-of-the-boundary check).
        let balance = with_override("generation.streets.max_detour_excess_cells", 408);
        GenerationConfig::from_balance(&balance)
            .expect("the loosening guard itself must be accepted, not just values under it");
    }

    #[test]
    fn from_balance_rejects_peripheral_low_band_floor_percent_over_pooled_min_ratio_percent() {
        let balance = with_override("generation.streets.peripheral_low_band_floor_percent", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(
            err.to_string()
                .contains("peripheral_low_band_floor_percent")
        );
    }

    #[test]
    fn from_balance_rejects_arterial_count_ns_min_over_max() {
        let balance = with_override("generation.streets.arterial_count_ns_min", 4);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("arterial_count_ns_min"));
    }

    #[test]
    fn from_balance_rejects_arterial_count_ew_min_over_max() {
        let balance = with_override("generation.streets.arterial_count_ew_min", 4);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("arterial_count_ew_min"));
    }

    #[test]
    fn from_balance_rejects_an_odd_envelope_side_gap() {
        let balance = with_override("generation.envelopes.side_gap_periphery_cells", 3);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("side_gap_periphery_cells"));
    }

    #[test]
    fn from_balance_rejects_plot_width_min_over_max_for_a_land_use() {
        let balance = with_override("generation.plots.residential_width_min_cells", 20);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("residential_width_min_cells"));
    }

    #[test]
    fn from_balance_rejects_an_envelope_minimum_the_plot_minimum_can_never_hold() {
        let balance = with_override(
            "generation.envelopes.residential_min_interior_width_cells",
            20,
        );
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("plot minimum"));
    }

    #[test]
    fn from_balance_rejects_an_envelope_minimum_over_its_own_class_max() {
        let balance = with_override("generation.envelopes.max_width_cells", 4);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("max_width_cells"));
    }

    #[test]
    fn from_balance_rejects_a_mean_width_outside_its_own_band() {
        let balance = with_override("generation.envelopes.mean_width_cells", 100);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.to_string().contains("mean_width_cells"));
    }

    #[test]
    fn envelope_limits_reads_the_live_defs() {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        for u in LandUse::ALL {
            let limits = cfg.envelope_limits(u);
            assert!(limits.min_width_cells <= limits.max_width_cells);
            assert!(limits.min_depth_cells <= limits.max_depth_cells);
        }
    }

    #[test]
    fn generate_is_plan_plus_the_building_count_verdict() {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let planned = plan(11, &cfg, &content).unwrap();
        let generated = generate(11, &cfg, &content).unwrap();
        assert_eq!(planned.plots.plots(), generated.plots.plots());
        assert_eq!(planned.envelopes.outcomes(), generated.envelopes.outcomes());

        let mut starved = cfg;
        starved.envelope_target_count_per_million_cells *= 100;
        assert!(
            plan(11, &starved, &content).is_ok(),
            "plan carries no count verdict"
        );
        assert!(matches!(
            generate(11, &starved, &content),
            Err(GenerationError::BuildingCountOutOfTolerance { .. })
        ));
    }

    #[test]
    fn generate_fails_the_workplace_count_verdict_when_the_target_is_starved() {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let mut starved = cfg;
        starved.workplace_target_count_per_million_cells *= 1000;
        assert!(
            plan(11, &starved, &content).is_ok(),
            "plan carries no workplace count verdict"
        );
        assert!(matches!(
            generate(11, &starved, &content),
            Err(GenerationError::WorkplaceCountOutOfTolerance { .. })
        ));
    }
}
