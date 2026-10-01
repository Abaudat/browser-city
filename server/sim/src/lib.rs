//! Pure simulation logic (NFR28). This crate never depends on `spacetimedb`
//! and never will -- `check-sim-purity.sh` fails CI if it does. It reads no
//! table and touches no clock, filesystem, or network; every input it needs
//! is passed in by its caller in `../src` (the reducer crate).

pub mod appearance;
pub mod author;
pub mod balance;
pub mod cadence;
pub mod cash;
pub mod codes;
pub mod demo_ping;
pub mod generation;
// `tools/defs-build` emits already-formatted text (docs/architecture.md's
// "defs/" section), never by shelling out to `rustfmt` -- but its own
// notion of "formatted" (one struct literal per array element, on one
// line) is not what `rustfmt` itself would produce, so this whole subtree
// is skipped rather than kept in permanent disagreement with `cargo fmt
// --check`.
#[rustfmt::skip]
pub mod generated;
pub mod item_instance;
pub mod reducer_classes;
pub mod rng;
pub mod routing;
pub mod rules;
pub mod stock;
pub mod storage;
pub mod table_bounds;
pub mod time;
pub mod validation;
pub mod world;

/// Proves the determinism lints are live: each deliberate violation is
/// expected, so if `clippy.toml` or the `[lints.clippy]` table stops
/// applying, the unfulfilled expectation turns clippy red.
#[cfg(test)]
#[allow(dead_code)]
mod lint_canary {
    #[expect(clippy::disallowed_types)]
    fn float_type(x: f64) -> usize {
        x as usize
    }

    #[expect(clippy::disallowed_types)]
    fn hash_map() -> usize {
        std::collections::HashMap::<u8, u8>::new().len()
    }

    #[expect(clippy::float_arithmetic)]
    #[allow(clippy::disallowed_types)]
    fn float_math(a: f64, b: f64) -> f64 {
        a * b
    }

    #[expect(clippy::disallowed_methods)]
    fn unstable_sort_by_key(v: &mut [u8]) {
        v.sort_unstable_by_key(|x| *x);
    }
}
