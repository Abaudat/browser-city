//! Proves the determinism lints are live: every ban in `clippy.toml` has
//! one deliberate violation here, each expected, so if an entry or the
//! `[lints.clippy]` table stops applying (or its path is misspelled), the
//! unfulfilled expectation fails the build (`unfulfilled_lint_expectations`
//! is denied in `Cargo.toml`).
//!
//! The one file under `sim/src/` the float-token scan (`bounds`) exempts.

#![allow(dead_code)]
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
