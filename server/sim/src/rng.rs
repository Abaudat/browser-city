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
