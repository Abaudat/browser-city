use sim::rng::seed_from_ids;

pub const SEED_COUNT: u64 = 50_000;
/// Story 3.4's own pass adds `sim::rules::evaluate` over the whole
/// finished district on top of pass 5's own placement -- measured over a
/// smaller range than the four-pass stats above so this binary still
/// finishes in a reasonable time; still large enough to see a real tail.
pub const BUILDING_TYPE_SEED_COUNT: u64 = 5_000;

/// Salt for [`seed_from_ids`] below -- distinct from every other caller's
/// own salt (`0` is pass 1's own city-seed role in `seed_from_ids(city_
/// seed, PASS_ID)` elsewhere in this codebase) so this harness's own
/// mixed stream is never accidentally the same sequence a real pass
/// seeds itself from.
pub const MEASURE_SEED_SALT: u64 = 0xB0F0_5EED;
/// A second, distinct salt for the building-type loop below -- its own
/// index range overlaps the first loop's, so reusing [`MEASURE_SEED_SALT`]
/// would measure the same 5,000 cities twice under two different names
/// rather than 5,000 further ones.
pub const MEASURE_BUILDING_TYPE_SEED_SALT: u64 = 0xB0F0_5EE1;

/// The missing-tag sweep's own default seed count when no CLI argument
/// is given -- large enough to be a real check on every local run
/// without this binary's own wall-clock growing noticeably; the
/// 1,000,000-seed run a retune actually needs is a deliberate, explicit
/// argument (module doc above), never this default.
pub const MISSING_TAG_SEED_COUNT_DEFAULT: u64 = 5_000;
/// A third, distinct salt for the missing-tag sweep -- its own index
/// range overlaps the two loops above, so reusing either salt would
/// measure the same cities again under a third name rather than fresh
/// ones.
pub const MEASURE_MISSING_TAG_SEED_SALT: u64 = 0xB0F0_5EE2;

/// The detour-bounds sweep's own default seed count when no second CLI
/// argument is given (story 15.10) -- the same small-default/explicit-
/// million shape as [`MISSING_TAG_SEED_COUNT_DEFAULT`].
pub const DETOUR_SEED_COUNT_DEFAULT: u64 = 5_000;
/// A fourth, distinct salt for the detour-bounds sweep -- its own index
/// range overlaps the three loops above, so reusing any of them would
/// measure the same cities again under a fourth name rather than fresh
/// ones.
pub const MEASURE_DETOUR_SEED_SALT: u64 = 0xB0F0_5EE3;

/// `.github/workflows/ci.yml`'s own top-level `PROPTEST_CASES` (Tim's
/// direction, story 15.10): the printed "implied CI failure probability"
/// is only ever meaningful as a statement about CI's own case count, so
/// it is named once here, with this pointer, rather than left as a bare
/// `4096` repeated at every call site and once more in the doc comment
/// above -- there is no build-time way to read the workflow file itself,
/// so a named mirror is the right level, not a literal. Update this
/// alongside that key if it ever moves.
#[allow(dead_code)]
pub const CI_PROPTEST_CASES: u32 = bounds::generation_stamp::CI_PROPTEST_CASES;

/// The band sweep's own default seed count when no `bands <n>` argument is
/// given.
pub const BAND_SEED_COUNT_DEFAULT: u64 = 50_000;
/// A fifth, distinct salt for the band sweep -- see
/// [`MEASURE_DETOUR_SEED_SALT`].
pub const MEASURE_BAND_SEED_SALT: u64 = 0xB0F0_5EE4;

/// This loop index's own measured seed -- spread over the full `u64`
/// space by `seed_from_ids` (see the module doc above), never the index
/// itself.
pub fn mixed_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_SEED_SALT, index)
}

pub fn mixed_building_type_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_BUILDING_TYPE_SEED_SALT, index)
}

pub fn mixed_missing_tag_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_MISSING_TAG_SEED_SALT, index)
}

pub fn mixed_band_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_BAND_SEED_SALT, index)
}

pub fn mixed_detour_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_DETOUR_SEED_SALT, index)
}

/// (excess cells, seed, node a, node b) -- one detour-excess extreme,
/// named so the tuple is never spelled out four times over.
pub type DetourWorst = (i64, u64, (i32, i32), (i32, i32));

pub struct Stats {
    pub values: Vec<i64>,
}

impl Stats {
    pub fn new(mut values: Vec<i64>) -> Self {
        values.sort_unstable();
        Stats { values }
    }

    /// Nearest-rank percentile.
    pub fn percentile(&self, pct: f64) -> i64 {
        let n = self.values.len();
        let rank = ((pct / 100.0) * n as f64).ceil() as usize;
        self.values[rank.clamp(1, n) - 1]
    }

    pub fn mean(&self) -> f64 {
        self.values.iter().sum::<i64>() as f64 / self.values.len() as f64
    }

    pub fn stddev(&self) -> f64 {
        let mean = self.mean();
        let variance = self
            .values
            .iter()
            .map(|&v| {
                let d = v as f64 - mean;
                d * d
            })
            .sum::<f64>()
            / self.values.len() as f64;
        variance.sqrt()
    }

    pub fn print(&self, label: &str) {
        println!(
            "{label}: min={} p1={} p50={} p99={} max={} mean={:.1} stddev={:.1}",
            self.values[0],
            self.percentile(1.0),
            self.percentile(50.0),
            self.percentile(99.0),
            self.values[self.values.len() - 1],
            self.mean(),
            self.stddev(),
        );
    }
}

/// One committed ceiling's own miss tally over the detour-bounds sweep --
/// count and every offending seed; the report prints the ten smallest, so
/// the output does not depend on thread count.
pub struct BandMiss {
    pub count: u64,
    pub seeds: Vec<u64>,
}

impl BandMiss {
    pub fn new() -> Self {
        BandMiss {
            count: 0,
            seeds: Vec::new(),
        }
    }

    pub fn record(&mut self, seed: u64) {
        self.count += 1;
        self.seeds.push(seed);
    }
}

/// Prints one ceiling through the one shared report
/// (`bounds::generation_stamp::ceiling_report`).
pub fn print_ceiling_report(name: &str, miss: &BandMiss, n: u64) {
    let mut seeds = miss.seeds.clone();
    seeds.sort_unstable();
    seeds.truncate(10);
    println!(
        "{}",
        bounds::generation_stamp::ceiling_report(name, miss.count, &seeds, n)
    );
}
