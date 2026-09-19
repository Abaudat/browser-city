//! Stories 3.2-3.3 (FR110): the first four of the generator's seven
//! coarse-to-fine passes -- land use, the street network, plot
//! subdivision, then the building envelope. Pure functions and data only
//! (NFR28): every input is passed in by the caller, nothing here reads a
//! table, a clock or the filesystem.
//!
//! A pass's own signature carries FR110's ordering, not convention: a pass
//! takes the city seed, `&` the outputs of *earlier* passes it actually
//! reads (never a later pass, never by mutation) and [`GenerationConfig`]
//! -- nothing else. Pass 3 needs both blocks (pass 2) and land use/density
//! (pass 1), so "its own predecessor's output" (the pre-3.3 wording) no
//! longer holds; the amended rule above does (Tim's direction). `streets::
//! run` takes [`land_use::LandUseMap`] by reference and cannot mutate it;
//! `land_use.rs` never imports `streets`, and no pass ever imports a pass
//! later than itself. Persisting the generated city or walking it is later
//! stories' job (this module hands down an abstract plan, never a
//! `PlacedObject`); there is no table and no reducer here.
//!
//! Each pass seeds its own [`crate::rng::Rng`] stream from
//! [`crate::rng::seed_from_ids`]`(city_seed, PASS_ID)`, so adding a draw to
//! one pass never reshuffles another. Pass ids are append-only, in FR110's
//! own order -- a pass not yet implemented still reserves its id. Within a
//! pass, each block (and, in pass 4, each plot) further seeds its own
//! stream from `seed_from_ids(pass_seed, block_index)` (respectively
//! `plot_index`), so one block's own draw count never reshuffles
//! another's.
//!
//! [`generate`] is the one entry point that chains every implemented pass
//! in order -- `generation_golden.rs`, `generation_perf.rs`, `generation_
//! evidence.rs` and `invariants.rs` all call it rather than hand-chaining
//! the four `run` functions themselves, so the chain itself can never
//! drift between callers (Tim's direction). Each pass's own `run` stays
//! public too, for its own unit tests.

pub mod envelopes;
pub mod land_use;
pub mod plots;
pub mod streets;

pub use envelopes::{Envelope, EnvelopeClass, EnvelopeMap, EnvelopeOutcome, RejectReason};
pub use land_use::{LandUse, LandUseCell, LandUseMap, Region};
pub use plots::{Plot, PlotMap};
pub use streets::{Block, Side, Sides, StreetClass, StreetEdge, StreetNetwork, block_sides};

use crate::generated::defs;

/// Bumped whenever any implemented pass's algorithm or seeding changes in
/// a way that could move its output for a fixed seed -- `tests/goldens/
/// generation_v2.golden` is keyed to this, exactly like `sim::rng::
/// RNG_VERSION`/`sim::appearance::APPEARANCE_VERSION`. Bumped to 2 by
/// story 3.3 (passes 3-4 added); the golden was regenerated wholesale
/// rather than kept side by side with `generation_v1.golden` (Tim's
/// direction).
pub const GENERATION_VERSION: u32 = 2;

/// Every way generation itself can fail, across every implemented pass --
/// one type, never a `Result<_, String>` per pass (Tim's direction).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GenerationError {
    /// Pass 1: `site`'s own extent is not a whole multiple of the coarse
    /// cell size -- refused, never silently truncated.
    InvalidSite(String),
    /// Pass 4: the realised building count for this seed/config sits
    /// outside `[min, max]` -- a seed that trips this is a world that
    /// fails to create, never a silently thin or overcrowded city.
    BuildingCountOutOfTolerance { got: i64, min: i64, max: i64 },
}

impl std::fmt::Display for GenerationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GenerationError::InvalidSite(msg) => write!(f, "{msg}"),
            GenerationError::BuildingCountOutOfTolerance { got, min, max } => write!(
                f,
                "generation::envelopes: building count {got} is outside tolerance [{min}, {max}]"
            ),
        }
    }
}

impl std::error::Error for GenerationError {}

/// One finished city plan: every implemented pass's own output, in order.
/// Never a `PlacedObject` -- still the abstract plan this module has
/// always handed down (FR110).
#[derive(Debug, Clone)]
pub struct District {
    pub land_use: LandUseMap,
    pub streets: StreetNetwork,
    pub plots: PlotMap,
    pub envelopes: EnvelopeMap,
}

/// The one entry point that chains every implemented pass, in FR110's own
/// order -- the single place `generation_golden.rs`, `generation_perf.
/// rs`, `bounds::generation_evidence` and `invariants.rs` all call,
/// rather than each hand-chaining the four `run` functions itself (Tim's
/// direction: "four hand-chained calls repeated ... is where drift
/// starts").
pub fn generate(city_seed: u64, cfg: &GenerationConfig) -> Result<District, GenerationError> {
    let land_use = land_use::run(city_seed, cfg.site(), cfg)?;
    let streets = streets::run(city_seed, &land_use, cfg);
    let plots = plots::run(city_seed, &land_use, &streets, cfg);
    let envelopes = envelopes::run(city_seed, &plots, cfg)?;
    Ok(District {
        land_use,
        streets,
        plots,
        envelopes,
    })
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
    /// block (corner-point contact is landlocked) -- Tim's/Quentin's own
    /// naming for the one frontage definition [`plots::PlotMap::
    /// landlocked_plots`] checks.
    pub plot_frontage_min_cells: i32,
    /// The density (`land_use::LandUseCell::density`) at or above which a
    /// block's own build line sits flush on the pavement (setback 0,
    /// party-wall packing) -- below it, a block gets the single shared
    /// `plot_setback_periphery_cells` setback instead (Artie's direction:
    /// "at high density the setback is 0 ... toward the periphery ... a
    /// front-garden strip"). Shared with `envelopes.rs`'s own side-gap
    /// step (same density line decides both).
    pub plot_high_density_threshold: i32,
    /// The one shared build-line setback every plot on a below-threshold
    /// block sits behind -- Artie's direction: "one shared setback of 2-4
    /// cells... still one line for the whole face".
    pub plot_setback_periphery_cells: i32,
    /// Per land use ([`LandUse::ALL`] order), the row of plot widths (the
    /// row axis, along the block face) a block of that use draws its
    /// rhythm module widths from, minimum end -- Artie's direction:
    /// "size distribution visibly skewed by block use".
    pub plot_width_min_cells: [i32; 4],
    /// Per land use, the same band's maximum end.
    pub plot_width_max_cells: [i32; 4],
    /// Per land use, the plot's own depth from its block face inward
    /// (before the build-line setback is subtracted) -- Artie's
    /// direction: "residential narrower and deeper, commercial wider on
    /// the frontage".
    pub plot_row_depth_cells: [i32; 4],

    // --- building envelopes (pass 4) ---------------------------------
    /// The wall ring's own thickness, both axes -- interior usable floor
    /// is the plot-derived footprint minus two of these per axis.
    pub envelope_wall_thickness_cells: i32,
    /// Per land use, the minimum *usable interior* width a footprint must
    /// clear -- checked against the interior net (footprint minus the
    /// wall ring), never the outer rectangle (Quentin's direction).
    pub envelope_min_interior_width_cells: [i32; 4],
    /// Per land use, the same minimum's depth.
    pub envelope_min_interior_depth_cells: [i32; 4],
    /// The outer envelope ceiling, both axes shared across every land
    /// use (Artie's own pinned assumption: "none larger than roughly
    /// 20x16").
    pub envelope_max_width_cells: i32,
    pub envelope_max_depth_cells: i32,
    /// The total gap between two neighbouring envelopes on a below-
    /// `plot_high_density_threshold` block -- half subtracted from each
    /// side, so it is even (`from_balance` refuses an odd value, the same
    /// rule `streets.*_width_cells` already follows). 0 at or above the
    /// threshold (party walls) -- Artie's direction: "0 or at least 2
    /// cells, never 1".
    pub envelope_side_gap_periphery_cells: i32,
    /// AC3's mean band, measured over the fixed seed range `0..256` at
    /// this generator's own committed config -- see the value's own
    /// comment in `defs/balance/generation.toml` for the measured number
    /// and seed count (Quentin's direction: "a weak per-city band... and
    /// a tight pooled assertion").
    pub envelope_mean_width_cells: i32,
    pub envelope_mean_width_tolerance_cells: i32,
    pub envelope_mean_depth_cells: i32,
    pub envelope_mean_depth_tolerance_cells: i32,
    /// NFR8/AC3's anti-cheat floor: the minimum number of distinct `(w,
    /// d)` footprint pairs a single generated district must show -- a
    /// city of identical boxes satisfies a mean band too (Quentin's
    /// direction).
    pub envelope_min_distinct_sizes: i64,
    /// AC4's own target, stated at the 512 reference extent per one
    /// million site cells and scaled by real site area inside `envelopes
    /// ::run` -- never a bare count, so NFR14's 1024 growth target (four
    /// times the cells) does not fail this for no reason (Tim's
    /// direction).
    pub envelope_target_count_per_million_cells: i64,
    /// AC4's tolerance band around the scaled target, as a percent.
    pub envelope_count_tolerance_percent: i64,
    /// Quentin's own guard: rejection rate gets its own key, asserted per
    /// city -- without it a generator that rejects half the district
    /// still passes every other property until AC4 catches it for the
    /// wrong reason.
    pub envelope_max_rejected_plot_percent: i64,
}

fn get(balance: &[defs::BalanceSeed], key: &str) -> i64 {
    crate::balance::value(balance, key)
}

/// `LandUse`'s own balance-key naming segment, [`LandUse::ALL`] order --
/// the one place a per-land-use key's own name is built, shared by
/// `from_balance` and `docs/generation.md`'s own key list.
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
    pub fn from_balance(balance: &[defs::BalanceSeed]) -> Result<Self, String> {
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
            envelope_max_rejected_plot_percent: get(
                balance,
                "generation.envelopes.max_rejected_plot_percent",
            ),
        };

        if cfg.coarse_cell_size_cells <= 0
            || cfg.site_extent_cells % cfg.coarse_cell_size_cells != 0
        {
            return Err(format!(
                "GenerationConfig: site extent {} is not a whole multiple of coarse cell size {}",
                cfg.site_extent_cells, cfg.coarse_cell_size_cells
            ));
        }
        for (name, w) in [
            ("arterial_width_cells", cfg.arterial_width_cells),
            ("street_width_cells", cfg.street_width_cells),
            ("lane_width_cells", cfg.lane_width_cells),
        ] {
            if w % 2 != 0 {
                return Err(format!(
                    "GenerationConfig: generation.streets.{name} ({w}) must be even"
                ));
            }
        }
        let share_sum = cfg.share_residential_pct
            + cfg.share_commercial_pct
            + cfg.share_industrial_pct
            + cfg.share_institutional_pct;
        if share_sum != 100 {
            return Err(format!(
                "GenerationConfig: land-use shares sum to {share_sum}, not 100"
            ));
        }
        if cfg.land_use_max_leaf_cells < 2 * cfg.land_use_min_leaf_cells {
            return Err(format!(
                "GenerationConfig: land_use.max_leaf_cells ({}) must be at least twice land_use.min_leaf_cells ({}) -- otherwise an over-sized axis could be too small to legally split",
                cfg.land_use_max_leaf_cells, cfg.land_use_min_leaf_cells
            ));
        }
        if cfg.density_min > cfg.density_max {
            return Err(format!(
                "GenerationConfig: density_min ({}) is greater than density_max ({})",
                cfg.density_min, cfg.density_max
            ));
        }
        if cfg.density_peak_offset_min_pct > cfg.density_peak_offset_max_pct {
            return Err(format!(
                "GenerationConfig: density_peak_offset_min_pct ({}) is greater than density_peak_offset_max_pct ({})",
                cfg.density_peak_offset_min_pct, cfg.density_peak_offset_max_pct
            ));
        }
        if cfg.block_size_min_cells > cfg.block_size_max_cells {
            return Err(format!(
                "GenerationConfig: block_size_min_cells ({}) is greater than block_size_max_cells ({})",
                cfg.block_size_min_cells, cfg.block_size_max_cells
            ));
        }
        if cfg.max_block_depth_min_cells > cfg.max_block_depth_max_cells {
            return Err(format!(
                "GenerationConfig: max_block_depth_min_cells ({}) is greater than max_block_depth_max_cells ({})",
                cfg.max_block_depth_min_cells, cfg.max_block_depth_max_cells
            ));
        }
        let detour_excess_ceiling =
            2 * cfg.block_size_max_cells as i64 + 2 * cfg.arterial_width_cells as i64;
        if cfg.max_detour_excess_cells as i64 > detour_excess_ceiling {
            return Err(format!(
                "GenerationConfig: max_detour_excess_cells ({}) is greater than the structural ceiling 2*block_size_max_cells + 2*arterial_width_cells ({detour_excess_ceiling}) -- the worst a rectilinear network should cost a route is going around one largest block",
                cfg.max_detour_excess_cells
            ));
        }
        if cfg.p99_detour_percent > cfg.max_detour_percent {
            return Err(format!(
                "GenerationConfig: p99_detour_percent ({}) is greater than max_detour_percent ({}) -- the typical case cannot be worse than the tail ceiling",
                cfg.p99_detour_percent, cfg.max_detour_percent
            ));
        }
        if cfg.peripheral_low_band_floor_percent as i64
            > cfg.peripheral_pooled_min_ratio_percent as i64
        {
            return Err(format!(
                "GenerationConfig: peripheral_low_band_floor_percent ({}) is greater than peripheral_pooled_min_ratio_percent ({}) -- the per-city anti-inversion floor cannot ask for more than the pooled, density-blind-failing guard does",
                cfg.peripheral_low_band_floor_percent, cfg.peripheral_pooled_min_ratio_percent
            ));
        }
        if cfg.arterial_count_ns_min > cfg.arterial_count_ns_max {
            return Err(format!(
                "GenerationConfig: arterial_count_ns_min ({}) is greater than arterial_count_ns_max ({})",
                cfg.arterial_count_ns_min, cfg.arterial_count_ns_max
            ));
        }
        if cfg.arterial_count_ew_min > cfg.arterial_count_ew_max {
            return Err(format!(
                "GenerationConfig: arterial_count_ew_min ({}) is greater than arterial_count_ew_max ({})",
                cfg.arterial_count_ew_min, cfg.arterial_count_ew_max
            ));
        }
        if cfg.envelope_side_gap_periphery_cells % 2 != 0 {
            return Err(format!(
                "GenerationConfig: generation.envelopes.side_gap_periphery_cells ({}) must be even -- half is inset from each of two neighbouring envelopes",
                cfg.envelope_side_gap_periphery_cells
            ));
        }
        for u in LandUse::ALL {
            let i = u as usize;
            if cfg.plot_width_min_cells[i] > cfg.plot_width_max_cells[i] {
                return Err(format!(
                    "GenerationConfig: generation.plots.{}_width_min_cells ({}) is greater than {}_width_max_cells ({})",
                    land_use_key(u),
                    cfg.plot_width_min_cells[i],
                    land_use_key(u),
                    cfg.plot_width_max_cells[i]
                ));
            }
            let min_footprint_w =
                cfg.envelope_min_interior_width_cells[i] + 2 * cfg.envelope_wall_thickness_cells;
            let min_footprint_d =
                cfg.envelope_min_interior_depth_cells[i] + 2 * cfg.envelope_wall_thickness_cells;
            if min_footprint_w > cfg.plot_width_min_cells[i] {
                return Err(format!(
                    "GenerationConfig: {} envelope minimum footprint width ({min_footprint_w}) is larger than the {} plot minimum ({}) can ever hold",
                    land_use_key(u),
                    land_use_key(u),
                    cfg.plot_width_min_cells[i]
                ));
            }
            if min_footprint_d > cfg.plot_row_depth_cells[i] {
                return Err(format!(
                    "GenerationConfig: {} envelope minimum footprint depth ({min_footprint_d}) is larger than the {} plot row depth ({}) can ever hold",
                    land_use_key(u),
                    land_use_key(u),
                    cfg.plot_row_depth_cells[i]
                ));
            }
            if min_footprint_w > cfg.envelope_max_width_cells {
                return Err(format!(
                    "GenerationConfig: {} envelope minimum footprint width ({min_footprint_w}) is greater than envelopes.max_width_cells ({})",
                    land_use_key(u),
                    cfg.envelope_max_width_cells
                ));
            }
            if min_footprint_d > cfg.envelope_max_depth_cells {
                return Err(format!(
                    "GenerationConfig: {} envelope minimum footprint depth ({min_footprint_d}) is greater than envelopes.max_depth_cells ({})",
                    land_use_key(u),
                    cfg.envelope_max_depth_cells
                ));
            }
            // A plot at exactly its own class's minimum width/row depth
            // must still clear the *periphery* side gap/setback -- the
            // worst case `envelopes::place_one` ever subtracts -- or
            // every below-`plot_high_density_threshold` block of this use
            // rejects its own minimum-width plot by construction, not by
            // bad luck (the defect a real seed scan first found this
            // check for).
            if min_footprint_w + cfg.envelope_side_gap_periphery_cells > cfg.plot_width_min_cells[i]
            {
                return Err(format!(
                    "GenerationConfig: {} envelope minimum footprint width ({min_footprint_w}) plus envelopes.side_gap_periphery_cells ({}) is greater than plots.{}_width_min_cells ({}) -- every periphery plot at the class minimum would be rejected",
                    land_use_key(u),
                    cfg.envelope_side_gap_periphery_cells,
                    land_use_key(u),
                    cfg.plot_width_min_cells[i]
                ));
            }
            if min_footprint_d + cfg.plot_setback_periphery_cells > cfg.plot_row_depth_cells[i] {
                return Err(format!(
                    "GenerationConfig: {} envelope minimum footprint depth ({min_footprint_d}) plus plots.setback_periphery_cells ({}) is greater than plots.{}_row_depth_cells ({}) -- every periphery plot at the class minimum would be rejected",
                    land_use_key(u),
                    cfg.plot_setback_periphery_cells,
                    land_use_key(u),
                    cfg.plot_row_depth_cells[i]
                ));
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
            return Err(format!(
                "GenerationConfig: envelopes.mean_width_cells ({}) is outside [{overall_min_footprint_w}, {}]",
                cfg.envelope_mean_width_cells, cfg.envelope_max_width_cells
            ));
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
            return Err(format!(
                "GenerationConfig: envelopes.mean_depth_cells ({}) is outside [{overall_min_footprint_d}, {}]",
                cfg.envelope_mean_depth_cells, cfg.envelope_max_depth_cells
            ));
        }

        Ok(cfg)
    }

    /// Per-land-use envelope size limits, computed once here rather than
    /// re-derived by `envelopes::run` per plot (Tim's direction): the
    /// minimum footprint is the class's own minimum usable interior plus
    /// two wall rings, the maximum is the shared outer ceiling.
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
            seed("generation.envelopes.max_width_cells", 20, 4, 64),
            seed("generation.envelopes.max_depth_cells", 16, 4, 64),
            seed("generation.envelopes.side_gap_periphery_cells", 4, 0, 16),
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
            seed("generation.envelopes.max_rejected_plot_percent", 5, 0, 100),
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
        assert!(err.contains("whole multiple"));
    }

    #[test]
    fn from_balance_rejects_an_odd_street_width() {
        let balance = with_override("generation.streets.street_width_cells", 7);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("must be even"));
    }

    #[test]
    fn from_balance_rejects_shares_not_summing_to_100() {
        let balance = with_override("generation.land_use.share_residential_pct", 59);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("sum to"));
    }

    #[test]
    fn from_balance_rejects_density_min_over_density_max() {
        let balance = with_override("generation.land_use.density_min", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("density_min"));
    }

    #[test]
    fn from_balance_rejects_block_size_min_over_max() {
        let balance = with_override("generation.streets.block_size_min_cells", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("block_size_min_cells"));
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
        assert!(err.contains("max_leaf_cells"));
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
        assert!(err.contains("whole multiple"));
    }

    #[test]
    fn from_balance_rejects_peak_offset_min_over_max() {
        let balance = with_override("generation.land_use.density_peak_offset_min_pct", 45);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("density_peak_offset_min_pct"));
    }

    #[test]
    fn from_balance_rejects_max_block_depth_min_over_max() {
        let balance = with_override("generation.streets.max_block_depth_min_cells", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("max_block_depth_min_cells"));
    }

    #[test]
    fn from_balance_rejects_p99_detour_percent_over_max_detour_percent() {
        let balance = with_override("generation.streets.p99_detour_percent", 500);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("p99_detour_percent"));
    }

    #[test]
    fn from_balance_rejects_max_detour_excess_cells_over_the_structural_ceiling() {
        // fixture: block_size_max_cells=96, arterial_width_cells=12 ->
        // ceiling = 2*96 + 2*12 = 216.
        let balance = with_override("generation.streets.max_detour_excess_cells", 217);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("max_detour_excess_cells"));
    }

    #[test]
    fn from_balance_rejects_peripheral_low_band_floor_percent_over_pooled_min_ratio_percent() {
        let balance = with_override("generation.streets.peripheral_low_band_floor_percent", 200);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("peripheral_low_band_floor_percent"));
    }

    #[test]
    fn from_balance_rejects_arterial_count_ns_min_over_max() {
        let balance = with_override("generation.streets.arterial_count_ns_min", 4);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("arterial_count_ns_min"));
    }

    #[test]
    fn from_balance_rejects_arterial_count_ew_min_over_max() {
        let balance = with_override("generation.streets.arterial_count_ew_min", 4);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("arterial_count_ew_min"));
    }

    #[test]
    fn from_balance_rejects_an_odd_envelope_side_gap() {
        let balance = with_override("generation.envelopes.side_gap_periphery_cells", 3);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("side_gap_periphery_cells"));
    }

    #[test]
    fn from_balance_rejects_plot_width_min_over_max_for_a_land_use() {
        let balance = with_override("generation.plots.residential_width_min_cells", 20);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("residential_width_min_cells"));
    }

    #[test]
    fn from_balance_rejects_an_envelope_minimum_the_plot_minimum_can_never_hold() {
        let balance = with_override(
            "generation.envelopes.residential_min_interior_width_cells",
            20,
        );
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("plot minimum"));
    }

    #[test]
    fn from_balance_rejects_an_envelope_minimum_over_its_own_class_max() {
        let balance = with_override("generation.envelopes.max_width_cells", 4);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("max_width_cells"));
    }

    #[test]
    fn from_balance_rejects_a_mean_width_outside_its_own_band() {
        let balance = with_override("generation.envelopes.mean_width_cells", 100);
        let err = GenerationConfig::from_balance(&balance).unwrap_err();
        assert!(err.contains("mean_width_cells"));
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
}
