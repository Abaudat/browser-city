//! NFR37: every table declares a bound, either game-mechanical or an
//! engineering ceiling, machine-readable. This crate is a standalone
//! workspace member -- not a module of `browser_city` -- because
//! `browser_city` embeds SpacetimeDB's reducer/table macros, which reference
//! host FFI symbols the wasm runtime supplies; that makes `browser_city`
//! impossible to `cargo test` natively (the linker cannot resolve them).
//! Keeping the registry here, with no `spacetimedb` dependency, is what
//! makes `tests/registry_matches_tables.rs` (which scans `../src` for
//! `#[spacetimedb::table(...)]` accessors and fails on any missing from
//! [`TABLE_BOUNDS`]) runnable with plain `cargo test`.
//!
//! Story 4.12 hangs the metrics sampler off this same registry; nothing
//! here needs to change for that.

pub mod schema;
pub mod world_fixture;

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
    pub max_rows: u64,
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
        kind: BoundKind::Engineering,
    },
    // A handful of identities per character at most (FR142) -- bounded by
    // `character`'s own ceiling, not a separate game rule.
    TableBound {
        accessor: "character_identity",
        max_rows: 500_000,
        kind: BoundKind::Engineering,
    },
    // A one-row config table (the module owner, recorded from `init`) --
    // the row count is the game rule.
    TableBound {
        accessor: "module_owner",
        max_rows: 1,
        kind: BoundKind::Mechanical,
    },
    // Story 1.4: whether a restore is currently open -- a one-row gate,
    // the same rule as `module_owner`'s.
    TableBound {
        accessor: "restore_state",
        max_rows: 1,
        kind: BoundKind::Mechanical,
    },
    // NFR14's growth target: ~20,000 citizens at the 1024-squared district.
    // A real game-mechanical ceiling, not a safety valve.
    TableBound {
        accessor: "citizen",
        max_rows: 20_000,
        kind: BoundKind::Mechanical,
    },
    // 1:1 with `citizen` (NFR35's narrowness split) -- same ceiling.
    TableBound {
        accessor: "citizen_state",
        max_rows: 20_000,
        kind: BoundKind::Mechanical,
    },
    // Extensible-set companion tables (NFR36): closed vocabularies the
    // game's own design bounds, not a runaway-bug safety net.
    TableBound {
        accessor: "matter_kind",
        max_rows: 64,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "provision",
        max_rows: 64,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "reason_code",
        max_rows: 64,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "node_kind",
        max_rows: 64,
        kind: BoundKind::Mechanical,
    },
    TableBound {
        accessor: "layer_code",
        max_rows: 64,
        kind: BoundKind::Mechanical,
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
        kind: BoundKind::Engineering,
    },
    // Stairs, ramps, ladders, manholes and station steps are sparse --
    // roughly one per 16x16 tile block, across the same 8 floors:
    // 1024 * 1024 / 256 * 8 = 32,768 -- rounded up. An engineering ceiling
    // (the block-density assumption, not a hard game rule).
    TableBound {
        accessor: "floor_transition",
        max_rows: 50_000,
        kind: BoundKind::Engineering,
    },
    // A real game-mechanical ceiling: a building's minimum plausible
    // footprint is 5x5 (25 tiles), so the 1024x1024 growth-target district
    // holds at most 1024 * 1024 / 25 = 41,943 -- rounded up.
    TableBound {
        accessor: "building",
        max_rows: 50_000,
        kind: BoundKind::Mechanical,
    },
    // Up to ~10 rooms per building on average (large buildings carry more,
    // most carry far fewer): 50,000 buildings * 10 = 500,000.
    TableBound {
        accessor: "room",
        max_rows: 500_000,
        kind: BoundKind::Mechanical,
    },
    // Most footprints are one rect; a non-rectangular one decomposes into
    // a handful more. 3x `building`'s own ceiling as headroom for that
    // decomposition and for chunk-boundary clipping (Tech Lead direction:
    // a rect is clipped to lie entirely inside the chunk its key names).
    TableBound {
        accessor: "building_area",
        max_rows: 150_000,
        kind: BoundKind::Engineering,
    },
    // Same reasoning as `building_area`, over `room`'s ceiling.
    TableBound {
        accessor: "room_area",
        max_rows: 1_500_000,
        kind: BoundKind::Engineering,
    },
    // Scheduled tables (NFR34): each carries at most a handful of pending
    // rows in practice; the ceiling is a safety net against a runaway
    // scheduling bug, not a game rule.
    TableBound {
        accessor: "citizen_transition_schedule",
        max_rows: 16,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "metrics_sample_schedule",
        max_rows: 16,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "budget_review_schedule",
        max_rows: 16,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "world_clock_schedule",
        max_rows: 16,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "economy_schedule",
        max_rows: 16,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "growth_schedule",
        max_rows: 16,
        kind: BoundKind::Engineering,
    },
    TableBound {
        accessor: "maintenance_schedule",
        max_rows: 16,
        kind: BoundKind::Engineering,
    },
];
