//! NFR37: every table declares a bound, either game-mechanical or an
//! engineering ceiling, machine-readable. This crate is a standalone
//! workspace member -- not a module of `browser_city` -- because
//! `browser_city` embeds SpacetimeDB's reducer/table macros, which reference
//! host FFI symbols the wasm runtime supplies; that makes `browser_city`
//! impossible to `cargo test` natively (the linker cannot resolve them).
//! The registry itself is `sim::table_bounds` (pure data the module reads
//! at runtime); this crate's tests, which scan `../src` and need no
//! `spacetimedb` dependency, gate it with plain `cargo test`.

pub mod city_clock_fixture;
#[cfg(test)]
mod float_scan;
pub mod generation_evidence;
pub mod generation_stamp;
pub mod neighbourhood_evidence;
pub mod schema;
pub mod sweep;
pub mod world_fixture;

pub use sim::table_bounds::{BoundKind, TABLE_BOUNDS, TableBound};
