//! Pure simulation logic (NFR28). This crate never depends on `spacetimedb`
//! and never will -- `check-sim-purity.sh` fails CI if it does. It reads no
//! table and touches no clock, filesystem, or network; every input it needs
//! is passed in by its caller in `../src` (the reducer crate).

pub mod codes;
pub mod demo_ping;
// `tools/defs-build` emits already-formatted text (docs/architecture.md's
// "defs/" section), never by shelling out to `rustfmt` -- but its own
// notion of "formatted" (one struct literal per array element, on one
// line) is not what `rustfmt` itself would produce, so this whole subtree
// is skipped rather than kept in permanent disagreement with `cargo fmt
// --check`.
#[rustfmt::skip]
pub mod generated;
pub mod rng;
pub mod world;
