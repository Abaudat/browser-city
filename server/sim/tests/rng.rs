//! Behavioural tests for the pinned PRNG (NFR25). Written before
//! `sim::rng` exists.

use proptest::prelude::*;
use sim::rng::{Rng, seed_from_ids};

proptest! {
    /// Two `Rng`s built from the same seed produce the same stream, forever
    /// (not just the first value) -- the property `inv_identical_seeds_derive_identically`
    /// in `tests/invariants.rs` depends on.
    #[test]
    fn same_seed_same_stream(seed: u64, n in 1usize..128) {
        let mut a = Rng::new(seed);
        let mut b = Rng::new(seed);
        let out_a: Vec<u64> = (0..n).map(|_| a.next_u64()).collect();
        let out_b: Vec<u64> = (0..n).map(|_| b.next_u64()).collect();
        prop_assert_eq!(out_a, out_b);
    }

    /// `seed_from_ids` is a pure function of its inputs: called twice with
    /// the same ids, it returns the same seed.
    #[test]
    fn seed_from_ids_is_deterministic(a: u64, b: u64) {
        prop_assert_eq!(seed_from_ids(a, b), seed_from_ids(a, b));
    }

    /// Different id pairs are extremely unlikely to collide -- guards
    /// against a degenerate derivation (e.g. one that ignores an input).
    #[test]
    fn seed_from_ids_distinguishes_inputs(a: u64, b: u64) {
        prop_assume!(a != b);
        prop_assert_ne!(seed_from_ids(a, 0), seed_from_ids(b, 0));
    }

    /// The stream is not a constant and does not immediately repeat --
    /// catches a broken generator that always returns the seed itself.
    #[test]
    fn stream_is_not_degenerate(seed: u64) {
        let mut rng = Rng::new(seed);
        let v: Vec<u64> = (0..8).map(|_| rng.next_u64()).collect();
        prop_assert!(v.iter().collect::<std::collections::BTreeSet<_>>().len() > 1);
    }
}
