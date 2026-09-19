//! Story 3.2 (FR110): the first two of the generator's seven coarse-to-fine
//! passes -- land use, then the street network. Pure functions and data
//! only (NFR28): every input is passed in by the caller, nothing here
//! reads a table, a clock or the filesystem.
//!
//! A pass's own signature carries FR110's ordering, not convention: a pass
//! takes the city seed, its own predecessor's output and [`GenerationConfig`]
//! -- nothing else. `streets::run` takes [`land_use::LandUseMap`] by
//! reference and cannot mutate it; `land_use.rs` never imports `streets`.
//! Persisting the generated city or walking it is later stories' job (this
//! module hands down an abstract plan, never a `PlacedObject`); there is no
//! table and no reducer here.
//!
//! Each pass seeds its own [`crate::rng::Rng`] stream from
//! [`crate::rng::seed_from_ids`]`(city_seed, PASS_ID)`, so adding a draw to
//! one pass never reshuffles another. Pass ids are append-only, in FR110's
//! own order -- a pass not yet implemented still reserves its id.

pub mod land_use;
pub mod streets;

pub use land_use::{LandUse, LandUseCell, LandUseMap, Region};
pub use streets::{Block, StreetClass, StreetEdge, StreetNetwork};

use crate::generated::defs;

/// Bumped whenever either pass's algorithm or seeding changes in a way
/// that could move its output for a fixed seed -- `tests/goldens/
/// generation_v1.golden` is keyed to this, exactly like `sim::rng::
/// RNG_VERSION`/`sim::appearance::APPEARANCE_VERSION`.
pub const GENERATION_VERSION: u32 = 1;

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

    pub arterial_count_ns: u32,
    pub arterial_count_ew: u32,
    pub arterial_width_cells: i32,
    pub street_width_cells: i32,
    pub lane_width_cells: i32,
    pub arterial_jitter_pct: i32,
    /// How close (world cells) a candidate arterial or block-split
    /// position must be to an existing land-use district boundary to
    /// snap onto it instead of its own jittered position -- Artie's
    /// direction: streets are laid on land-use boundaries, a boundary
    /// never cuts through the middle of a block.
    pub boundary_snap_tolerance_cells: i32,
    pub block_size_min_cells: i32,
    pub block_size_max_cells: i32,
    pub min_block_depth_cells: i32,
    pub max_block_depth_cells: i32,
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
    pub max_detour_percent: i32,
    pub detour_min_manhattan_cells: i32,
    /// The minimum number of distinct block widths (and, separately,
    /// heights) a single generated network must show -- Quentin's
    /// direction, cycle 1: "not a perfect grid" as a number, asserted
    /// over arbitrary seeds, not a literal repeated in test files.
    pub min_distinct_block_sizes: i64,
}

fn get(balance: &[defs::BalanceSeed], key: &str) -> i64 {
    crate::balance::value(balance, key)
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
    /// leaf-size guarantee hold), or `density_peak_offset_min_pct` over
    /// `density_peak_offset_max_pct`.
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

            arterial_count_ns: get(balance, "generation.streets.arterial_count_ns") as u32,
            arterial_count_ew: get(balance, "generation.streets.arterial_count_ew") as u32,
            arterial_width_cells: get(balance, "generation.streets.arterial_width_cells") as i32,
            street_width_cells: get(balance, "generation.streets.street_width_cells") as i32,
            lane_width_cells: get(balance, "generation.streets.lane_width_cells") as i32,
            arterial_jitter_pct: get(balance, "generation.streets.arterial_jitter_pct") as i32,
            boundary_snap_tolerance_cells: get(
                balance,
                "generation.streets.boundary_snap_tolerance_cells",
            ) as i32,
            block_size_min_cells: get(balance, "generation.streets.block_size_min_cells") as i32,
            block_size_max_cells: get(balance, "generation.streets.block_size_max_cells") as i32,
            min_block_depth_cells: get(balance, "generation.streets.min_block_depth_cells") as i32,
            max_block_depth_cells: get(balance, "generation.streets.max_block_depth_cells") as i32,
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
            max_detour_percent: get(balance, "generation.streets.max_detour_percent") as i32,
            detour_min_manhattan_cells: get(
                balance,
                "generation.streets.detour_min_manhattan_cells",
            ) as i32,
            min_distinct_block_sizes: get(balance, "generation.streets.min_distinct_block_sizes"),
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

        Ok(cfg)
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
            seed("generation.streets.arterial_count_ns", 3, 0, 4),
            seed("generation.streets.arterial_count_ew", 2, 0, 4),
            seed("generation.streets.arterial_width_cells", 12, 2, 64),
            seed("generation.streets.street_width_cells", 8, 2, 64),
            seed("generation.streets.lane_width_cells", 4, 2, 64),
            seed("generation.streets.arterial_jitter_pct", 20, 0, 45),
            seed(
                "generation.streets.boundary_snap_tolerance_cells",
                24,
                0,
                256,
            ),
            seed("generation.streets.block_size_min_cells", 24, 4, 512),
            seed("generation.streets.block_size_max_cells", 96, 4, 512),
            seed("generation.streets.min_block_depth_cells", 16, 2, 256),
            seed("generation.streets.max_block_depth_cells", 40, 2, 1024),
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
            seed("generation.streets.max_detour_percent", 350, 100, 500),
            seed("generation.streets.detour_min_manhattan_cells", 64, 1, 2048),
            seed("generation.streets.min_distinct_block_sizes", 3, 1, 16),
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
}
