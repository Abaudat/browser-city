//! Our own pinned PRNG (NFR25). `sim` never depends on `rand`: a dependency
//! bump to `rand` could change its output stream out from under us with no
//! warning, and NFR25 requires a pinned RNG whose stream we control.
//!
//! xoshiro256++ (Blackman & Vigna), seeded via splitmix64 as its own authors
//! recommend. Both are public-domain algorithms re-implemented here in full;
//! see `RNG_VERSION` below -- bump it if this implementation ever changes,
//! `check-golden-version-bump.sh` enforces that the golden vectors in
//! `tests/goldens/` move only alongside it.

/// Bumped whenever the algorithm or its seeding changes in a way that moves
/// the output stream. Golden vectors in `tests/goldens/` are keyed by this.
pub const RNG_VERSION: u32 = 1;

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E3779B97F4A7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

/// Derives a seed from a pair of stable ids (e.g. citizen id, tick), so the
/// same pair always yields the same seed, on any machine, on any run.
pub fn seed_from_ids(a: u64, b: u64) -> u64 {
    let mut state = a ^ splitmix64(&mut { b });
    splitmix64(&mut state)
}

/// xoshiro256++, a deterministic, non-cryptographic PRNG over `u64`.
pub struct Rng {
    state: [u64; 4],
}

impl Rng {
    /// Builds a generator from a single `u64` seed, expanded into the
    /// 256-bit state via splitmix64 (the scheme xoshiro256++'s authors
    /// recommend for seeding from a smaller value).
    pub fn new(seed: u64) -> Self {
        let mut sm_state = seed;
        let state = [
            splitmix64(&mut sm_state),
            splitmix64(&mut sm_state),
            splitmix64(&mut sm_state),
            splitmix64(&mut sm_state),
        ];
        Rng { state }
    }

    /// The next `u64` in the stream.
    pub fn next_u64(&mut self) -> u64 {
        let result = self.state[0]
            .wrapping_add(self.state[3])
            .rotate_left(23)
            .wrapping_add(self.state[0]);

        let t = self.state[1] << 17;

        self.state[2] ^= self.state[0];
        self.state[3] ^= self.state[1];
        self.state[1] ^= self.state[2];
        self.state[0] ^= self.state[3];

        self.state[2] ^= t;
        self.state[3] = self.state[3].rotate_left(45);

        result
    }
}

#[cfg(test)]
mod known_answer_tests {
    use super::*;

    /// splitmix64 from seed 0, checked against the reference algorithm's
    /// own published output (Sebastiano Vigna, `splitmix64.c`) rather than
    /// against this file -- a self-generated golden proves this
    /// implementation is consistent with itself, never that it implements
    /// splitmix64 correctly. A future rewrite of `splitmix64` has to match
    /// these three literals, not just match its own past behaviour.
    #[test]
    fn splitmix64_matches_the_reference_implementation() {
        let mut state: u64 = 0;
        assert_eq!(splitmix64(&mut state), 0xE220A8397B1DCDAF);
        assert_eq!(splitmix64(&mut state), 0x6E789E6AA1B965F4);
        assert_eq!(splitmix64(&mut state), 0x06C45D188009454F);
    }

    /// xoshiro256++ from raw state `[1, 2, 3, 4]` -- the exact fixture the
    /// reference C source's own test uses -- checked against the first ten
    /// outputs published with `rand_xoshiro`'s port of that reference
    /// (`Xoshiro256PlusPlus`'s `reference` test, itself sourced from
    /// http://xoshiro.di.unimi.it/xoshiro256plusplus.c). Bypasses
    /// `seed_from_ids`/`Rng::new` deliberately: this is a check on the
    /// `next_u64` step function against a known-answer, seeding-independent
    /// fixture, not on our seed derivation.
    #[test]
    fn next_u64_matches_the_reference_implementation() {
        let mut rng = Rng {
            state: [1, 2, 3, 4],
        };
        let expected = [
            41943041u64,
            58720359,
            3588806011781223,
            3591011842654386,
            9228616714210784205,
            9973669472204895162,
            14011001112246962877,
            12406186145184390807,
            15849039046786891736,
            10450023813501588000,
        ];
        for e in expected {
            assert_eq!(rng.next_u64(), e);
        }
    }
}
