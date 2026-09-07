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
