//! NFR37: every table declares a bound -- `max_rows` (the ceiling),
//! `expected_rows` (the anticipated magnitude) and `alert_rows` (where the
//! metrics sampler raises) -- either game-mechanical or an engineering
//! ceiling, machine-readable. Pure data: the published module reads it at
//! runtime (`tables::metrics`) and `bounds`' tests gate it natively.

/// Whether a table's bound comes from the game's rules (a real ceiling the
/// simulation must never exceed) or is an engineering safety valve (a bound
/// that should never be hit in practice, guarding against a runaway bug).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundKind {
    Mechanical,
    Engineering,
}

/// One table's declared bound. `accessor` is the name passed to
/// `#[spacetimedb::table(accessor = ..., ...)]`.
#[derive(Debug, Clone, Copy)]
pub struct TableBound {
    pub accessor: &'static str,
    /// The bound: the ceiling the design (or an engineering safety valve)
    /// allows.
    pub max_rows: u64,
    /// The magnitude the design anticipates at launch scale (the
    /// 1024-squared district).
    pub expected_rows: u64,
    /// Where the metrics sampler raises `over_alert`.
    pub alert_rows: u64,
    pub kind: BoundKind,
}

/// The bound for every table in the module. Add a row here in the same PR
/// that adds a `#[spacetimedb::table]` -- `tests/registry_matches_tables.rs`
/// fails otherwise.
pub const TABLE_BOUNDS: &[TableBound] = &[
    // The scaffold's smoke slice (story 1.1) -- an engineering ceiling, not
    // a game rule, since the table itself is deleted once a reducer the
    // client reads exists. See `server/README.md`.
    TableBound {
        accessor: "demo_ping",
        max_rows: 1_000,
        expected_rows: 10,
        alert_rows: 750,
        kind: BoundKind::Engineering,
    },
    // Story 1.2: permanent schema decisions (NFR33-NFR37).
    //
    // Every registered player, ever -- no in-fiction rule caps this, so it
    // is an engineering ceiling generous enough for this project's whole
    // life, not a game-mechanical one.
    TableBound {
        accessor: "character",
        max_rows: 100_000,
        expected_rows: 5_000,
        alert_rows: 75_000,
        kind: BoundKind::Engineering,
    },
    // A handful of identities per character at most (FR142) -- bounded by
    // `character`'s own ceiling, not a separate game rule.
    TableBound {
        accessor: "character_identity",
        max_rows: 500_000,
        expected_rows: 10_000,
        alert_rows: 375_000,
        kind: BoundKind::Engineering,
    },
    // A one-row config table (the module owner, recorded from `init`) --
    // the row count is the game rule.
    TableBound {
        accessor: "module_owner",
        max_rows: 1,
        expected_rows: 1,
        alert_rows: 1,
        kind: BoundKind::Mechanical,
    },
    // Story 4.1: the in-city clock's epoch -- a one-row table, the row
    // count is the game rule.
    TableBound {
        accessor: "world_clock",
        max_rows: 1,
        expected_rows: 1,
        alert_rows: 1,
        kind: BoundKind::Mechanical,
    },
    // Story 1.4: whether a restore is currently open -- a one-row gate,
    // the same rule as `module_owner`'s.
    TableBound {
        accessor: "restore_state",
        max_rows: 1,
        expected_rows: 1,
        alert_rows: 1,
        kind: BoundKind::Mechanical,
    },
    // NFR14's growth target: ~20,000 citizens at the 1024-squared district.
    // A real game-mechanical ceiling, not a safety valve.
    TableBound {
        accessor: "citizen",
        max_rows: 20_000,
        expected_rows: 12_000,
        alert_rows: 15_000,
        kind: BoundKind::Mechanical,
    },
    // 1:1 with `citizen` (NFR35's narrowness split) -- same ceiling.
    TableBound {
        accessor: "citizen_state",
        max_rows: 20_000,
        expected_rows: 12_000,
        alert_rows: 15_000,
        kind: BoundKind::Mechanical,
    },
    // Extensible-set companion tables (NFR36): closed vocabularies the
    // game's own design bounds, not a runaway-bug safety net.
    TableBound {
        accessor: "matter_kind",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "provision",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "reason_code",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "node_kind",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "unit",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "layer_code",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    // Story 6.2: holders and stock (FR87).
    TableBound {
        accessor: "holder_kind",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    // One row per workplace (`bounds/tests/stock_bounds.rs` holds the
    // generator's workplace band under it at both scales). A closed
    // business keeps its row.
    TableBound {
        accessor: "business",
        max_rows: 10_000,
        expected_rows: 1_400,
        alert_rows: 7_500,
        kind: BoundKind::Engineering,
    },
    // `sim::stock::MAX_LINES_PER_HOLDER` (64) x the ceilings of every
    // holder table (`sim::stock::HOLDER_TABLES`): 64 x (business 10,000 +
    // citizen 20,000 + building 50,000). `bounds/tests/stock_bounds.rs`
    // recomputes it. Vehicles and municipal facilities have no table yet
    // and count for nothing until they do.
    TableBound {
        accessor: "stock",
        max_rows: 5_120_000,
        expected_rows: 200_000,
        alert_rows: 3_840_000,
        kind: BoundKind::Engineering,
    },
    // Story 6.11: item instances (FR95).
    TableBound {
        accessor: "container_kind",
        max_rows: 64,
        expected_rows: 16,
        alert_rows: 48,
        kind: BoundKind::Mechanical,
    },
    // Sum of `item_placed` 3,000,000 and `item_held` 192,000,000 (an
    // instance is in exactly one form): 195,000,000.
    // `bounds/tests/item_instance_bounds.rs` recomputes it.
    TableBound {
        accessor: "item_instance",
        max_rows: 195_000_000,
        expected_rows: 500_000,
        alert_rows: 146_250_000,
        kind: BoundKind::Engineering,
    },
    // The same density argument as `placed_object` (one per 4 cells over
    // the 1024x1024 district's 8 floors): 3,000,000.
    TableBound {
        accessor: "item_placed",
        max_rows: 3_000_000,
        expected_rows: 200_000,
        alert_rows: 2_250_000,
        kind: BoundKind::Engineering,
    },
    // `placed_object`'s `max_rows` x
    // `sim::item_instance::MAX_ITEMS_PER_CONTAINER` (64): 192,000,000.
    TableBound {
        accessor: "item_held",
        max_rows: 192_000_000,
        expected_rows: 300_000,
        alert_rows: 144_000_000,
        kind: BoundKind::Engineering,
    },
    // Story 1.5: world addressing (FR117-FR119). Cell facts are always
    // derived (never a dense per-cell table); these bound the placed
    // content a generator writes.
    //
    // One row per placed object anchor. NFR14's growth target is a
    // 1024x1024 district; a subway plus street plus up to six above-street
    // storeys is 8 addressable floors; assuming an average object
    // footprint of at least 2x2 tiles (FR127 caps it at 8x8, but most
    // props are far smaller) bounds density at one object per 4 cells:
    // 1024 * 1024 * 8 / 4 = 2,097,152 -- rounded up for headroom. An
    // engineering ceiling (the density assumption, not a game rule).
    TableBound {
        accessor: "placed_object",
        max_rows: 3_000_000,
        expected_rows: 2_000_000,
        alert_rows: 2_250_000,
        kind: BoundKind::Engineering,
    },
    // Stairs, ramps, ladders, manholes and station steps are sparse --
    // roughly one per 16x16 tile block, across the same 8 floors:
    // 1024 * 1024 / 256 * 8 = 32,768 -- rounded up. An engineering ceiling
    // (the block-density assumption, not a hard game rule).
    TableBound {
        accessor: "floor_transition",
        max_rows: 50_000,
        expected_rows: 30_000,
        alert_rows: 37_500,
        kind: BoundKind::Engineering,
    },
    // A real game-mechanical ceiling: a building's minimum plausible
    // footprint is 5x5 (25 tiles), so the 1024x1024 growth-target district
    // holds at most 1024 * 1024 / 25 = 41,943 -- rounded up.
    TableBound {
        accessor: "building",
        max_rows: 50_000,
        expected_rows: 30_000,
        alert_rows: 37_500,
        kind: BoundKind::Mechanical,
    },
    // Up to ~10 rooms per building on average (large buildings carry more,
    // most carry far fewer): 50,000 buildings * 10 = 500,000.
    TableBound {
        accessor: "room",
        max_rows: 500_000,
        expected_rows: 300_000,
        alert_rows: 375_000,
        kind: BoundKind::Mechanical,
    },
    // Most footprints are one rect; a non-rectangular one decomposes into
    // a handful more. 3x `building`'s own ceiling as headroom for that
    // decomposition and for chunk-boundary clipping (Tech Lead direction:
    // a rect is clipped to lie entirely inside the chunk its key names).
    TableBound {
        accessor: "building_area",
        max_rows: 150_000,
        expected_rows: 90_000,
        alert_rows: 112_500,
        kind: BoundKind::Engineering,
    },
    // One row per district ever generated: a world has one for a long
    // while and Epic 14 adds a handful more.
    TableBound {
        accessor: "district",
        max_rows: 64,
        expected_rows: 1,
        alert_rows: 48,
        kind: BoundKind::Engineering,
    },
    // Same reasoning as `building_area`, over `room`'s ceiling.
    TableBound {
        accessor: "room_area",
        max_rows: 1_500_000,
        expected_rows: 900_000,
        alert_rows: 1_125_000,
        kind: BoundKind::Engineering,
    },
    // Scheduled tables (NFR34): each carries at most a handful of pending
    // rows in practice; the ceiling is a safety net against a runaway
    // scheduling bug, not a game rule.
    TableBound {
        accessor: "citizen_transition_schedule",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "metrics_sample_schedule",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "budget_review_schedule",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "world_clock_schedule",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "economy_schedule",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "growth_schedule",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "maintenance_schedule",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    // Story 4.2: one row per armed cadence -- at most one per scheduled
    // table this file ever declares (7 today), an engineering ceiling
    // generous enough that it can never bind.
    TableBound {
        accessor: "cadence_liveness",
        max_rows: 16,
        expected_rows: 1,
        alert_rows: 12,
        kind: BoundKind::Engineering,
    },
    // Story 4.12: the metrics sampler's own tables, bounded by retention
    // (`storage::METRICS_RETENTION_DAYS`): one row per table per fire.
    // `bounds/tests/storage_budget.rs` keeps the ceilings above
    // `TABLE_BOUNDS.len() * 24 * METRICS_RETENTION_DAYS`.
    TableBound {
        accessor: "table_sample",
        max_rows: 200_000,
        expected_rows: 70_000,
        alert_rows: 150_000,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "storage_sample",
        max_rows: 4_000,
        expected_rows: 2_160,
        alert_rows: 3_000,
        kind: BoundKind::Engineering,
    },
    // Story 4.13: calls per reducer class (NFR17). The counter is one row
    // per class -- the row count is the rule; the sample keeps one row per
    // class per fire for the retention window.
    TableBound {
        accessor: "reducer_class_counter",
        max_rows: crate::reducer_classes::CLASS_COUNT,
        expected_rows: crate::reducer_classes::CLASS_COUNT,
        alert_rows: crate::reducer_classes::CLASS_COUNT,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "reducer_class_sample",
        max_rows: 20_000,
        expected_rows: 8_640,
        alert_rows: 15_000,
        kind: BoundKind::Engineering,
    },
];

/// The declared `max_rows` for `accessor`, if registered.
pub fn max_rows_of(accessor: &str) -> Option<u64> {
    TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == accessor)
        .map(|b| b.max_rows)
}
