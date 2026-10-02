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

/// Proves the determinism lints are live: every ban in `clippy.toml` has
/// one deliberate violation here, each expected, so if an entry or the
/// `[lints.clippy]` table stops applying (or its path is misspelled), the
/// unfulfilled expectation fails the build (`unfulfilled_lint_expectations`
/// is denied in `Cargo.toml`).
#[cfg(test)]
#[allow(dead_code)]
mod lint_canary {
    #[expect(clippy::disallowed_types)]
    fn f64_type(x: f64) -> usize {
        x as usize
    }

    #[expect(clippy::disallowed_types)]
    fn f32_type(x: f32) -> usize {
        x as usize
    }

    #[expect(clippy::disallowed_types)]
    fn hash_map() -> usize {
        std::collections::HashMap::<u8, u8>::new().len()
    }

    #[expect(clippy::disallowed_types)]
    fn hash_set() -> usize {
        std::collections::HashSet::<u8>::new().len()
    }

    #[expect(clippy::disallowed_types)]
    fn system_time() -> std::time::SystemTime {
        std::time::UNIX_EPOCH
    }

    #[expect(clippy::disallowed_types)]
    fn instant(i: std::time::Instant) -> std::time::Instant {
        i
    }

    #[expect(clippy::disallowed_types)]
    fn default_hasher() -> std::hash::DefaultHasher {
        std::hash::DefaultHasher::new()
    }

    #[expect(clippy::disallowed_types)]
    fn random_state() -> std::hash::RandomState {
        std::hash::RandomState::new()
    }

    #[expect(clippy::float_arithmetic)]
    #[allow(clippy::disallowed_types)]
    fn float_math(a: f64, b: f64) -> f64 {
        a * b
    }

    #[expect(clippy::disallowed_methods)]
    fn sort_unstable_by(v: &mut [u8]) {
        v.sort_unstable_by(|a, b| b.cmp(a));
    }

    #[expect(clippy::disallowed_methods)]
    fn sort_unstable_by_key(v: &mut [u8]) {
        v.sort_unstable_by_key(|x| *x);
    }

    #[expect(clippy::disallowed_methods)]
    fn select_nth_unstable_by(v: &mut [u8]) {
        v.select_nth_unstable_by(0, |a, b| b.cmp(a));
    }

    #[expect(clippy::disallowed_methods)]
    fn select_nth_unstable_by_key(v: &mut [u8]) {
        v.select_nth_unstable_by_key(0, |x| *x);
    }
}
