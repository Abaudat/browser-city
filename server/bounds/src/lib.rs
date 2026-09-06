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
pub const TABLE_BOUNDS: &[TableBound] = &[];
