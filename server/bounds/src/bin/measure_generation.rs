//! Re-measures every statistically-derived key in `generation.plots.*`,
//! `generation.envelopes.*` and `generation.streets.*`
//! (`max_open_percent_by_count/area`, `max_unplotted_percent`,
//! `max_rejected_plot_percent`, `target_count_per_million_cells`,
//! `count_tolerance_percent`, `mean_width/depth_cells`, `max_detour_
//! excess_cells`) over 50,000 seeds at the committed `defs::BALANCE`. A
//! binary, not a test: too slow for every CI run, and `scripts/ci/check-
//! trace-matrix.sh` refuses a skipped test.
//!
//! ```text
//! cargo run -p bounds --release --bin measure-generation
//! ```
//!
//! The 50,000 seeds are never `0..50_000` sequentially -- a genuinely
//! random sweep has twice found a worse case than a sequential scan ever
//! did (PR #317 cycle 5's own 276-vs-296 gap). Each seed is instead
//! derived from its own loop index through `sim::rng::seed_from_ids`
//! (NFR25's own pinned splitmix64-based mixer, the same one every pass
//! seeds its own RNG stream from -- never a second, ad hoc mixer, and
//! never a crate RNG), so the 50,000 draws are spread across the full
//! `u64` space, fully deterministic and reproducible by anyone running
//! this binary (story 3.18's own direction).
//!
//! Prints min/p1/p50/p99/max, mean and standard deviation for building
//! count, rejection percent, open-plot percent (by count and by area),
//! unplotted percent, per-city mean envelope width/depth (x10) and
//! street-network detour excess sampled at `streets::DETOUR_SAMPLE_
//! MAX_NODES` (one entry per sampled pair, every seed) -- the last
//! re-derives `generation.streets.max_detour_excess_cells`'s own comment
//! (PR #317 cycle 5: "put the worst-excess statistic in measure-
//! generation", never a temporary, uncommitted property). Separately,
//! `detour_excess_cells_exhaustive` measures the same statistic over
//! *every* non-both-boundary node pair (`streets::detour_samples(usize::
//! MAX)`), the population `max_detour_excess_cells` is actually keyed
//! against (Tim's direction: 91 sampled pairs is not a contract for an
//! estimator 3.11 runs between any two nodes) -- its own max, argmax
//! seed/pair, and the ten largest per-seed worsts, so the tail is
//! visible rather than only its single maximum. `detour_excess_cells_
//! exhaustive_both_endpoints_interior` is the same exhaustive scan
//! restricted to pairs with neither endpoint on the site boundary --
//! the player-felt figure (Artie's direction), since every worst pair
//! measured so far has one foot on the boundary, where the city stops
//! and almost nobody stands.
//!
//! Story 15.9 (the missing-cafe flake, Quentin's direction): a separate
//! `missing_tag_seed_count` sweep, over its own seed range (an optional
//! CLI argument, `cargo run -p bounds --release --bin measure-generation
//! -- 1000000`; defaults to [`MISSING_TAG_SEED_COUNT_DEFAULT`] when not
//! given), counts, for every committed `[[distribution]]` row this pass
//! actually feeds and for every tag `inv_generation_required_
//! institutions_are_present_when_their_own_target_is_nonzero`'s own
//! hand-named list still names (`shop`, never distributed), the seeds
//! where the basis/ratio target is at least 1 but nothing of that
//! subject was actually placed -- printing the miss count and up to ten
//! offending seeds per row/tag. Seeds are drawn the same way as every
//! other sweep in this binary: `seed_from_ids` on the loop index, spread
//! over the full `u64` space, never a sequential `0..N` scan -- the same
//! distribution `any::<u64>()` draws from in the proptest invariant this
//! sweep is standing in for at a much larger sample size.
//!
//! Story 15.10 (the detour-ratio flake, Tim's/Quentin's/Derek's
//! direction): a fourth sweep, `detour_seed_count` (a second optional
//! CLI argument, `cargo run -p bounds --release --bin measure-
//! generation -- <missing_tag_seed_count> <detour_seed_count>`;
//! defaults to [`DETOUR_SEED_COUNT_DEFAULT`] when not given, run at
//! 1,000,000 for this story), its own salt, running only passes 1-2
//! (land use, the street network -- never the full five-pass `plan`, a
//! million runs of which is hours this one pass-2 statistic does not
//! need). Per seed it computes exactly what CI asserts and nothing
//! looser, both through `streets::detour_bound_violation` (Derek's
//! max()-contract -- the same function `inv_generation_detour_ratio_
//! bounded` and its pinned regression call through, never a second,
//! hand-written copy of the comparison) over `detour_samples(DETOUR_
//! SAMPLE_MAX_NODES)`, and `p99_ratio_pct` over `detour_samples(DETOUR_
//! P99_SAMPLE_MAX_NODES)` (`inv_generation_p99_detour_ratio_bounded`'s).
//! For each of the two committed ceilings it prints the miss count,
//! miss rate, up to ten offending seeds, and the failure probability a
//! [`CI_PROPTEST_CASES`]-case CI run implies (`1 - (1 - p)^cases`); when
//! the miss count is zero, the rule-of-three upper bound (`3 / N` per
//! seed) instead, since zero observed misses over N seeds is a bound,
//! not a zero rate. Also prints the sampled worst ratio's own max and
//! ten largest per-seed values among pairs at or beyond `GenerationConfig
//! ::detour_ratio_takeover_distance_cells` (Derek's direction: that is
//! the only range where the ratio is the binding bound, so it is the
//! only figure `max_detour_percent` owes margin over), so its tail is
//! visible the way `detour_excess_cells_sampled_14node`'s already is.
//! The *exhaustive* version of that same figure (every non-both-
//! boundary pair, not the cheap 14-node sample) is measured in the
//! existing 50,000-seed loop above instead, alongside the exhaustive
//! excess figures it already prints -- an exhaustive pairing inside a
//! million-seed loop is what would make this sweep slow, not what a
//! ratio statistic needs. Prints this sweep's own wall-clock too.

//! Story 3.7: a rows sweep (`-- rows <n>` runs only it) over the committed
//! `[[distribution]]` rows -- the seeds `check_rules` rejects and each row's
//! pooled mean placed count, the two figures a retune of `defs/rules/
//! generation.toml` must hold (zero failing seeds; means within 10% of the
//! previous figures).
//!
//! Story 4.21 (the workplace-band flake): a band sweep over its own seed
//! range and salt (`cargo run -p bounds --release --bin measure-generation
//! -- bands <n>` runs only it; the full run does it first, at
//! [`BAND_SEED_COUNT_DEFAULT`]). Per seed it runs the full five-pass
//! `plan` and prints, for the three per-seed bands CI gates on -- land-use
//! area share (`land_use.share_tolerance_pct`), building count
//! (`envelopes.count_tolerance_percent`) and workplace count
//! (`building_types.workplace_count_tolerance_percent`) -- the statistic's
//! min/p1/p50/p99/max/mean/stddev, the 5.5-sigma tolerance those imply,
//! the band's miss count and the failure probability a
//! [`CI_PROPTEST_CASES`]-case run implies (the rule-of-three bound when
//! there are no misses). Those figures, with the seed count and date, are
//! what the three invariants' doc comments and the keys' comments quote.

use std::collections::BTreeMap;
use std::time::Instant;

use sim::generated::defs;
use sim::generation::{
    GenerationConfig, GenerationContent, LandUse, building_types, envelopes, land_use, streets,
};
use sim::rng::seed_from_ids;

const SEED_COUNT: u64 = 50_000;
/// Story 3.4's own pass adds `sim::rules::evaluate` over the whole
/// finished district on top of pass 5's own placement -- measured over a
/// smaller range than the four-pass stats above so this binary still
/// finishes in a reasonable time; still large enough to see a real tail.
const BUILDING_TYPE_SEED_COUNT: u64 = 5_000;

/// Salt for [`seed_from_ids`] below -- distinct from every other caller's
/// own salt (`0` is pass 1's own city-seed role in `seed_from_ids(city_
/// seed, PASS_ID)` elsewhere in this codebase) so this harness's own
/// mixed stream is never accidentally the same sequence a real pass
/// seeds itself from.
const MEASURE_SEED_SALT: u64 = 0xB0F0_5EED;
/// A second, distinct salt for the building-type loop below -- its own
/// index range overlaps the first loop's, so reusing [`MEASURE_SEED_SALT`]
/// would measure the same 5,000 cities twice under two different names
/// rather than 5,000 further ones.
const MEASURE_BUILDING_TYPE_SEED_SALT: u64 = 0xB0F0_5EE1;

/// The missing-tag sweep's own default seed count when no CLI argument
/// is given -- large enough to be a real check on every local run
/// without this binary's own wall-clock growing noticeably; the
/// 1,000,000-seed run a retune actually needs is a deliberate, explicit
/// argument (module doc above), never this default.
const MISSING_TAG_SEED_COUNT_DEFAULT: u64 = 5_000;
/// A third, distinct salt for the missing-tag sweep -- its own index
/// range overlaps the two loops above, so reusing either salt would
/// measure the same cities again under a third name rather than fresh
/// ones.
const MEASURE_MISSING_TAG_SEED_SALT: u64 = 0xB0F0_5EE2;

/// The detour-bounds sweep's own default seed count when no second CLI
/// argument is given (story 15.10) -- the same small-default/explicit-
/// million shape as [`MISSING_TAG_SEED_COUNT_DEFAULT`].
const DETOUR_SEED_COUNT_DEFAULT: u64 = 5_000;
/// A fourth, distinct salt for the detour-bounds sweep -- its own index
/// range overlaps the three loops above, so reusing any of them would
/// measure the same cities again under a fourth name rather than fresh
/// ones.
const MEASURE_DETOUR_SEED_SALT: u64 = 0xB0F0_5EE3;

/// `.github/workflows/ci.yml`'s own top-level `PROPTEST_CASES` (Tim's
/// direction, story 15.10): the printed "implied CI failure probability"
/// is only ever meaningful as a statement about CI's own case count, so
/// it is named once here, with this pointer, rather than left as a bare
/// `4096` repeated at every call site and once more in the doc comment
/// above -- there is no build-time way to read the workflow file itself,
/// so a named mirror is the right level, not a literal. Update this
/// alongside that key if it ever moves.
const CI_PROPTEST_CASES: u32 = 4096;

/// The band sweep's own default seed count when no `bands <n>` argument is
/// given.
const BAND_SEED_COUNT_DEFAULT: u64 = 50_000;
/// A fifth, distinct salt for the band sweep -- see
/// [`MEASURE_DETOUR_SEED_SALT`].
const MEASURE_BAND_SEED_SALT: u64 = 0xB0F0_5EE4;

/// This loop index's own measured seed -- spread over the full `u64`
/// space by `seed_from_ids` (see the module doc above), never the index
/// itself.
fn mixed_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_SEED_SALT, index)
}

fn mixed_building_type_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_BUILDING_TYPE_SEED_SALT, index)
}

fn mixed_missing_tag_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_MISSING_TAG_SEED_SALT, index)
}

fn mixed_band_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_BAND_SEED_SALT, index)
}

fn mixed_detour_seed(index: u64) -> u64 {
    seed_from_ids(MEASURE_DETOUR_SEED_SALT, index)
}

/// Regions-lost sweep's own default seed count and salt.
const REGION_SEED_COUNT_DEFAULT: u64 = 100_000;
const MEASURE_REGION_SEED_SALT: u64 = 0xB0F0_5EE5;

/// Passes 1-2 only: how many seeds have a pass-1 region whose land use no
/// block carries (`StreetNetwork::regions_carried_by_no_block`), and how
/// many lose every institutional region -- what `streets::SWALLOW_MIN_
/// REGION_SHARE_DENOM` keeps small. Prints the counts and the first
/// offending seeds so a retune re-measures this rather than rediscovers it.
fn region_loss_sweep(cfg: &GenerationConfig, n: u64) {
    println!(
        "
region-loss sweep: {n} seeds, passes 1-2 only (salt {MEASURE_REGION_SEED_SALT:#x})"
    );
    let (mut any_lost, mut all_inst_lost) = (0u64, 0u64);
    let mut first_any: Option<u64> = None;
    let mut offending: Vec<u64> = Vec::new();
    for i in 0..n {
        let seed = seed_from_ids(MEASURE_REGION_SEED_SALT, i);
        let lu = land_use::run(seed, cfg.site(), cfg).expect("committed config generates");
        let net = streets::run(seed, &lu, cfg);
        let lost = net.regions_carried_by_no_block(&lu);
        if !lost.is_empty() {
            any_lost += 1;
            first_any.get_or_insert(seed);
        }
        let institutional = lu
            .regions()
            .iter()
            .filter(|r| r.use_ == LandUse::Institutional)
            .count();
        let inst_lost = lost
            .iter()
            .filter(|r| r.use_ == LandUse::Institutional)
            .count();
        if institutional > 0 && inst_lost == institutional {
            all_inst_lost += 1;
            if offending.len() < 10 {
                offending.push(seed);
            }
        }
    }
    println!(
        "  seeds with any region carried by no block: {any_lost} of {n} (first: {first_any:?}) -- by design, a block takes its majority use"
    );
    println!(
        "  seeds losing every institutional region: {all_inst_lost} of {n} (rate {:.6}%), offending seeds: {offending:?}",
        all_inst_lost as f64 * 100.0 / n as f64
    );
}

/// (excess cells, seed, node a, node b) -- one detour-excess extreme,
/// named so the tuple is never spelled out four times over.
type DetourWorst = (i64, u64, (i32, i32), (i32, i32));

struct Stats {
    values: Vec<i64>,
}

impl Stats {
    fn new(mut values: Vec<i64>) -> Self {
        values.sort_unstable();
        Stats { values }
    }

    /// Nearest-rank percentile.
    fn percentile(&self, pct: f64) -> i64 {
        let n = self.values.len();
        let rank = ((pct / 100.0) * n as f64).ceil() as usize;
        self.values[rank.clamp(1, n) - 1]
    }

    fn mean(&self) -> f64 {
        self.values.iter().sum::<i64>() as f64 / self.values.len() as f64
    }

    fn stddev(&self) -> f64 {
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

    fn print(&self, label: &str) {
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

/// The band sweep (module doc, story 4.21).
fn band_sweep(cfg: &GenerationConfig, content: &GenerationContent, n: u64) {
    println!(
        "
band sweep: {n} seeds, all five passes (salt {MEASURE_BAND_SEED_SALT:#x})"
    );
    let uses = [
        (LandUse::Commercial, cfg.share_commercial_pct, "commercial"),
        (LandUse::Industrial, cfg.share_industrial_pct, "industrial"),
        (
            LandUse::Institutional,
            cfg.share_institutional_pct,
            "institutional",
        ),
    ];
    let mut share_dev: Vec<Vec<i64>> = vec![Vec::new(); uses.len()];
    let mut building_count = Vec::new();
    let mut workplace_count = Vec::new();
    let (mut share_miss, mut building_miss, mut workplace_miss) =
        (BandMiss::new(), BandMiss::new(), BandMiss::new());
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let (mut min_count, mut max_count) = ((i64::MAX, 0u64), (i64::MIN, 0u64));
    let start = Instant::now();
    for i in 0..n {
        let seed = mixed_band_seed(i);
        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
        let total = d.land_use.cols() as i64 * d.land_use.rows() as i64;
        for (k, (u, key, _)) in uses.iter().enumerate() {
            share_dev[k].push(d.land_use.area_cells(*u) * 1000 / total - *key as i64 * 10);
        }
        if d.land_use.share_band_violation(cfg).is_some() {
            share_miss.record(seed);
        }
        let placed = d.envelopes.placed_count();
        if placed < min_count.0 {
            min_count = (placed, seed);
        }
        if placed > max_count.0 {
            max_count = (placed, seed);
        }
        building_count.push(placed);
        if d.check_building_count(cfg).is_err() {
            building_miss.record(seed);
        }
        workplace_count.push(
            d.building_types
                .assignments()
                .iter()
                .filter(|a| building_types::is_workplace(by_id[&a.building_type]))
                .count() as i64,
        );
        if d.check_workplace_count(cfg, content).is_err() {
            workplace_miss.record(seed);
        }
    }
    for (k, (_, key, name)) in uses.iter().enumerate() {
        let st = Stats::new(share_dev[k].clone());
        st.print(&format!(
            "land_use_share_{name} deviation from its key ({key}%), permille of the site"
        ));
        println!(
            "  5.5-sigma share tolerance implied: {:.2} percentage points",
            5.5 * st.stddev() / 10.0
        );
    }
    print_ceiling_report("land-use share band (share_tolerance_pct)", &share_miss, n);
    let target_b = cfg.building_count_target(cfg.site().width() * cfg.site().height());
    let st = Stats::new(building_count);
    st.print("building_count");
    println!(
        "  5.5-sigma building tolerance implied: {:.1}% of the {target_b} target",
        5.5 * st.stddev() * 100.0 / target_b as f64
    );
    println!(
        "building_count extremes over the band sweep: min {} at seed {}, max {} at seed {} (pin both in invariants.rs's PINNED_BUILDING_COUNT_SEEDS)",
        min_count.0, min_count.1, max_count.0, max_count.1
    );
    print_ceiling_report(
        "building-count band (count_tolerance_percent)",
        &building_miss,
        n,
    );
    let target_w = cfg.workplace_count_target(cfg.site().width() * cfg.site().height());
    let st = Stats::new(workplace_count);
    st.print("workplace_count");
    println!(
        "  5.5-sigma workplace tolerance implied: {:.1}% of the {target_w} target",
        5.5 * st.stddev() * 100.0 / target_w as f64
    );
    print_ceiling_report(
        "workplace-count band (workplace_count_tolerance_percent)",
        &workplace_miss,
        n,
    );
    println!(
        "band sweep wall-clock: {:.1}s ({:.3}ms/seed)",
        start.elapsed().as_secs_f64(),
        start.elapsed().as_secs_f64() * 1000.0 / n.max(1) as f64
    );
}

/// The rows sweep's own default seed count when no `rows <n>` argument is
/// given.
const ROWS_SEED_COUNT_DEFAULT: u64 = 20_000;
/// A sixth, distinct salt for the rows sweep -- see
/// [`MEASURE_DETOUR_SEED_SALT`].
const MEASURE_ROWS_SEED_SALT: u64 = 0xB0F0_5EE5;

/// Story 3.7: the retune loop for the committed `[[distribution]]` rows
/// (`cargo run -p bounds --release --bin measure-generation -- rows 1000000`
/// runs only it). Per seed it runs `plan` and evaluates the committed rules
/// over the finished district (`District::check_rules`' own verdict, never a
/// second judgement): the seeds that fail -- a catchment whose land cannot
/// hold what a scoped row owes outside its tolerance -- and, per row, the
/// pooled mean placed count the row's comment quotes. Parallel across
/// threads; every seed is derived from its own index, so the result never
/// depends on thread scheduling.
fn rows_sweep(cfg: &GenerationConfig, content: &GenerationContent, n: u64) {
    use sim::rules::RuleSite;
    let rows: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    let threads = std::thread::available_parallelism().map_or(4, |t| t.get()) as u64;
    // Per row: pooled placed, fewest placed in one district, and districts
    // where the row owes a subject somewhere yet placed none.
    type Partial = (Vec<(u64, String)>, Vec<(u64, u64, u64)>);
    let partials: Vec<Partial> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let rows = &rows;
                scope.spawn(move || {
                    let mut failing: Vec<(u64, String)> = Vec::new();
                    let mut placed = vec![(0u64, u64::MAX, 0u64); rows.len()];
                    let mut i = t;
                    while i < n {
                        let seed = seed_from_ids(MEASURE_ROWS_SEED_SALT, i);
                        let d = sim::generation::plan(seed, cfg, content)
                            .expect("the committed config plans every seed");
                        let site = d.site(content);
                        if let Err(e) = d.check_rules(content) {
                            failing.push((seed, e.to_string()));
                        }
                        for (k, row) in rows.iter().enumerate() {
                            let n_placed = site.subjects_in_area(None, row.subject).len() as u64;
                            placed[k].0 += n_placed;
                            placed[k].1 = placed[k].1.min(n_placed);
                            // Whether the row owes a subject somewhere (the
                            // evaluator's own `targets`).
                            let read = match row.ratio {
                                sim::rules::RowRatio::Read(r) => Some(r.parameter),
                                sim::rules::RowRatio::Fixed(_) => None,
                            };
                            let owed = row
                                .targets(
                                    site.subjects_in_area(None, row.per)
                                        .iter()
                                        .map(|&c| (c, read.and_then(|p| site.parameter_at(c, p)))),
                                )
                                .values()
                                .any(|t| t.expected >= 1);
                            if owed && n_placed == 0 {
                                placed[k].2 += 1;
                            }
                        }
                        i += threads;
                    }
                    (failing, placed)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("a sweep thread panicked"))
            .collect()
    });
    let mut failing: Vec<(u64, String)> = partials.iter().flat_map(|p| p.0.clone()).collect();
    failing.sort();
    println!(
        "
rows sweep: {n} seeds, {threads} threads"
    );
    println!("  seeds failing check_rules: {}", failing.len());
    for (seed, why) in failing.iter().take(10) {
        println!("    {seed}: {why}");
    }
    for (k, row) in rows.iter().enumerate() {
        let total: u64 = partials.iter().map(|p| p.1[k].0).sum();
        let fewest = partials.iter().map(|p| p.1[k].1).min().unwrap_or(0);
        let owed_none: u64 = partials.iter().map(|p| p.1[k].2).sum();
        println!(
            "  {}: pooled mean placed {}.{:02}, fewest in one district {fewest}, owed somewhere but none placed in {owed_none} districts",
            content.rules.key_of(row.id).unwrap_or("?"),
            total / n,
            total * 100 / n % 100
        );
    }
}

fn main() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).expect("committed balance is valid");
    let content = GenerationContent::committed();
    let site = cfg.site();

    if std::env::args().nth(1).as_deref() == Some("detour") {
        let n = std::env::args()
            .nth(2)
            .map(|s| {
                s.parse()
                    .unwrap_or_else(|e| panic!("detour count {s:?}: {e}"))
            })
            .unwrap_or(DETOUR_SEED_COUNT_DEFAULT);
        detour_sweep(&cfg, n);
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("p99") {
        let seed: u64 = std::env::args()
            .nth(2)
            .map(|s| s.parse().unwrap_or_else(|e| panic!("p99 seed {s:?}: {e}")))
            .expect("usage: measure-generation p99 <seed>");
        p99_trace(&cfg, seed);
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("bands") {
        let n = std::env::args()
            .nth(2)
            .map(|s| {
                s.parse()
                    .unwrap_or_else(|e| panic!("bands count {s:?}: {e}"))
            })
            .unwrap_or(BAND_SEED_COUNT_DEFAULT);
        band_sweep(&cfg, &content, n);
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("rows") {
        let n = std::env::args()
            .nth(2)
            .map(|s| {
                s.parse()
                    .unwrap_or_else(|e| panic!("rows count {s:?}: {e}"))
            })
            .unwrap_or(ROWS_SEED_COUNT_DEFAULT);
        rows_sweep(&cfg, &content, n);
        return;
    }
    band_sweep(&cfg, &content, BAND_SEED_COUNT_DEFAULT);
    region_loss_sweep(&cfg, REGION_SEED_COUNT_DEFAULT);
    println!(
        "measure-generation: {SEED_COUNT} seeds at {}x{} cells",
        site.width(),
        site.height()
    );

    let mut building_count = Vec::with_capacity(SEED_COUNT as usize);
    let mut rejected_percent = Vec::with_capacity(SEED_COUNT as usize);
    let mut open_percent_by_count = Vec::with_capacity(SEED_COUNT as usize);
    let mut open_percent_by_area = Vec::with_capacity(SEED_COUNT as usize);
    let mut unplotted_percent = Vec::with_capacity(SEED_COUNT as usize);
    let mut mean_width_x10 = Vec::with_capacity(SEED_COUNT as usize);
    let mut mean_depth_x10 = Vec::with_capacity(SEED_COUNT as usize);
    let (mut too_narrow, mut too_shallow) = (0u64, 0u64);
    let (mut min_count, mut max_count) = ((i64::MAX, 0u64), (i64::MIN, 0u64));
    let mut open_slivers = 0u64;
    let mut sliver_blocks = 0u64;
    // The detour-excess ceiling's own worst-case statistic (PR #317
    // cycle 5, Quentin's direction: "put the worst-excess statistic in
    // measure-generation so the number in the comment can be
    // re-derived", never a temporary, uncommitted property). One entry
    // per sampled pair, every seed -- `DetourSample::excess_cells()`,
    // the same additive Manhattan-fitness overshoot `generation.
    // streets.max_detour_excess_cells` bounds.
    let mut detour_excess: Vec<i64> = Vec::new();
    let mut detour_excess_max: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    // The exhaustive-pair statistic `max_detour_excess_cells` is actually
    // keyed against (this module's own doc comment): every non-both-
    // boundary pair, not the cheap `DETOUR_SAMPLE_MAX_NODES` sample above.
    // `detour_excess_worst.0` is the running max; `detour_excess_top10`
    // holds the ten largest *per-seed* worsts seen so far, ascending, so
    // the tail beyond the single maximum is visible too.
    let mut detour_excess_worst: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    let mut detour_excess_top10: Vec<DetourWorst> = Vec::new();
    // Artie's direction, story 3.18 cycle 1: the player-felt figure is the
    // worst pair with *both* endpoints off the boundary -- every drawn
    // worst case so far has one foot on the site edge, where the city
    // stops and almost nobody stands.
    let mut detour_excess_both_interior_max: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    // Story 15.10 (Derek's direction): the exhaustive-pair worst ratio
    // among pairs at or beyond `GenerationConfig::detour_ratio_takeover_
    // distance_cells` -- the only range where the ratio term is the
    // binding half of the max()-contract, so the only figure `max_
    // detour_percent` owes margin over. The exhaustive pairing this
    // needs is too slow for the 1,000,000-seed detour-bounds sweep
    // below, so it rides this existing 50,000-seed loop instead.
    // `DetourWorst.0` holds `ratio_pct()`, not excess, here.
    let mut detour_ratio_exhaustive_worst: DetourWorst = (i64::MIN, 0, (0, 0), (0, 0));
    let mut detour_ratio_exhaustive_top10: Vec<DetourWorst> = Vec::new();
    let detour_takeover_distance = cfg.detour_ratio_takeover_distance_cells();

    for i in 0..SEED_COUNT {
        let seed = mixed_seed(i);
        let d = sim::generation::plan(seed, &cfg, &content).expect("pass 1 is total");
        let (net, pm, em) = (&d.streets, &d.plots, &d.envelopes);

        for s in net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES) {
            let excess = s.excess_cells();
            detour_excess.push(excess);
            if excess > detour_excess_max.0 {
                detour_excess_max = (excess, seed, s.a, s.b);
            }
        }

        let exhaustive = net.detour_samples(usize::MAX);
        let seed_worst = exhaustive
            .iter()
            .map(|s| (s.excess_cells(), seed, s.a, s.b))
            .max_by_key(|&(excess, ..)| excess);
        if let Some(w) = seed_worst {
            if w.0 > detour_excess_worst.0 {
                detour_excess_worst = w;
            }
            detour_excess_top10.push(w);
            detour_excess_top10.sort_unstable_by_key(|&(excess, ..)| excess);
            if detour_excess_top10.len() > 10 {
                detour_excess_top10.remove(0);
            }
        }
        let seed_both_interior_worst = exhaustive
            .iter()
            .filter(|s| !net.is_on_boundary(s.a) && !net.is_on_boundary(s.b))
            .map(|s| (s.excess_cells(), seed, s.a, s.b))
            .max_by_key(|&(excess, ..)| excess);
        if let Some(w) = seed_both_interior_worst
            && w.0 > detour_excess_both_interior_max.0
        {
            detour_excess_both_interior_max = w;
        }
        let seed_ratio_worst = exhaustive
            .iter()
            .filter(|s| s.manhattan >= detour_takeover_distance)
            .map(|s| (s.ratio_pct(), seed, s.a, s.b))
            .max_by_key(|&(ratio, ..)| ratio);
        if let Some(w) = seed_ratio_worst {
            if w.0 > detour_ratio_exhaustive_worst.0 {
                detour_ratio_exhaustive_worst = w;
            }
            detour_ratio_exhaustive_top10.push(w);
            detour_ratio_exhaustive_top10.sort_unstable_by_key(|&(ratio, ..)| ratio);
            if detour_ratio_exhaustive_top10.len() > 10 {
                detour_ratio_exhaustive_top10.remove(0);
            }
        }

        let placed = em.placed_count();
        if placed < min_count.0 {
            min_count = (placed, seed);
        }
        if placed > max_count.0 {
            max_count = (placed, seed);
        }
        building_count.push(placed);
        for p in pm.plots() {
            let short = p.bounds.width().min(p.bounds.height());
            if p.open && short < cfg.plot_open_min_side_cells as i64 {
                open_slivers += 1;
                if p.bounds == net.blocks()[p.block as usize].bounds {
                    sliver_blocks += 1;
                }
            }
        }
        rejected_percent.push(em.rejected_percent());
        for o in em.outcomes() {
            if let envelopes::EnvelopeOutcome::Rejected { reason, .. } = o {
                match reason {
                    envelopes::RejectReason::PlotTooNarrow => too_narrow += 1,
                    envelopes::RejectReason::PlotTooShallow => too_shallow += 1,
                }
            }
        }
        open_percent_by_count.push(pm.open_count_percent());
        open_percent_by_area.push(pm.open_area_percent());
        unplotted_percent.push(pm.unplotted_percent(net.blocks()));

        let (mut sum_w, mut sum_d, mut n) = (0i64, 0i64, 0i64);
        for e in em.envelopes() {
            sum_w += e.along_face_cells();
            sum_d += e.depth_cells();
            n += 1;
        }
        if n > 0 {
            mean_width_x10.push(sum_w * 10 / n);
            mean_depth_x10.push(sum_d * 10 / n);
        }
    }

    Stats::new(building_count).print("building_count");
    println!(
        "building_count extremes: min {} at seed {}, max {} at seed {} (pin both in invariants.rs's PINNED_BUILDING_COUNT_SEEDS)",
        min_count.0, min_count.1, max_count.0, max_count.1
    );
    Stats::new(rejected_percent).print("rejected_percent");
    println!("rejections by reason: too_narrow={too_narrow} too_shallow={too_shallow}");
    println!(
        "open plots with a short side under open_min_side_cells: {open_slivers} ({sliver_blocks} of them whole sliver blocks from pass 2)"
    );
    Stats::new(open_percent_by_count).print("open_percent_by_count");
    Stats::new(open_percent_by_area).print("open_percent_by_area");
    Stats::new(unplotted_percent).print("unplotted_percent");
    Stats::new(mean_width_x10).print("mean_width_cells_x10");
    Stats::new(mean_depth_x10).print("mean_depth_cells_x10");
    Stats::new(detour_excess).print("detour_excess_cells_sampled_14node");
    println!(
        "detour_excess_cells_sampled_14node worst: {} at seed {} ({:?}-{:?})",
        detour_excess_max.0, detour_excess_max.1, detour_excess_max.2, detour_excess_max.3
    );
    println!(
        "detour_excess_cells_exhaustive max: {} at seed {} ({:?}-{:?}) -- the number max_detour_excess_cells's own margin rule is applied to; pin the seed (with this exhaustive figure) in streets::PINNED_DETOUR_SEEDS if it moves",
        detour_excess_worst.0, detour_excess_worst.1, detour_excess_worst.2, detour_excess_worst.3
    );
    println!("detour_excess_cells_exhaustive top 10 per-seed worsts (ascending):");
    for (excess, seed, a, b) in &detour_excess_top10 {
        println!("  {excess} at seed {seed} ({a:?}-{b:?})");
    }
    println!(
        "detour_excess_cells_exhaustive_both_endpoints_interior max: {} at seed {} ({:?}-{:?}) -- the player-felt figure: the worst pair with neither endpoint on the site boundary",
        detour_excess_both_interior_max.0,
        detour_excess_both_interior_max.1,
        detour_excess_both_interior_max.2,
        detour_excess_both_interior_max.3
    );
    println!(
        "detour_ratio_pct_exhaustive_at_or_beyond_takeover ({detour_takeover_distance} cells) max: {}% at seed {} ({:?}-{:?}) -- the only range where the ratio term is the binding half of the max()-contract, so the only figure max_detour_percent owes margin over (story 15.10, Derek's direction)",
        detour_ratio_exhaustive_worst.0,
        detour_ratio_exhaustive_worst.1,
        detour_ratio_exhaustive_worst.2,
        detour_ratio_exhaustive_worst.3
    );
    println!(
        "detour_ratio_pct_exhaustive_at_or_beyond_takeover top 10 per-seed worsts (ascending):"
    );
    for (ratio, seed, a, b) in &detour_ratio_exhaustive_top10 {
        println!("  {ratio}% at seed {seed} ({a:?}-{b:?})");
    }

    // -- story 3.4: building types -------------------------------------
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let mut dwelling_count = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    let mut workplace_count = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    let mut per_tag_min: BTreeMap<u32, i64> = BTreeMap::new();
    let mut per_tag_sum: BTreeMap<u32, i64> = BTreeMap::new();
    let mut rule_violation_seeds = 0u64;
    // Per seed: how many distinct professions this one city employs at
    // >=5 distinct workplaces -- pooled (meaned) over every seed below,
    // the same two-step AC4 shape as building/workplace count.
    let mut deep_profession_count = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    // Story 15.9: the per-city barista employer count (an FR14 launch job,
    // posted only at cafes) -- its own minimum is what `cafe_present`'s
    // comment and `inv_generation_barista_has_at_least_min_employers` hold.
    let mut barista_employers = Vec::with_capacity(BUILDING_TYPE_SEED_COUNT as usize);
    let mut profession_sum: BTreeMap<&str, u64> = BTreeMap::new();

    // Every committed distribution row's own actual/expected ratio
    // (`sim::rules::evaluate`'s own tolerance-band check), pooled and
    // per-seed-worst -- the same figures `welfare_office_present`'s and
    // `shelter_present`'s own comments were measured with (Tim's
    // direction, story 15.9), re-derivable for every row rather than
    // hand-copied from a one-off scan. Only seeds with a nonzero
    // expected count enter this (a row with `expected == 0` never has
    // a tolerance band to be inside or outside of).
    let mut dist_rows_for_ratio: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    dist_rows_for_ratio.sort_by_key(|d| d.id);
    let mut ratio_actual_sum: BTreeMap<&str, u64> = BTreeMap::new();
    let mut ratio_expected_sum: BTreeMap<&str, u64> = BTreeMap::new();
    let mut ratio_min_percent: BTreeMap<&str, f64> = BTreeMap::new();
    let mut ratio_min_percent_seed: BTreeMap<&str, u64> = BTreeMap::new();

    for i in 0..BUILDING_TYPE_SEED_COUNT {
        let seed = mixed_building_type_seed(i);
        let d = sim::generation::plan(seed, &cfg, &content).expect("pass 1 is total");
        let mut tag_counts: BTreeMap<u32, i64> = BTreeMap::new();
        let mut workplaces = 0i64;
        let mut employers_this_city: BTreeMap<&str, u64> = BTreeMap::new();
        for a in d.building_types.assignments() {
            let def = by_id[&a.building_type];
            for &t in def.tags {
                *tag_counts.entry(t).or_insert(0) += 1;
            }
            if building_types::is_workplace(def) {
                workplaces += 1;
                for &p in def.professions {
                    *employers_this_city.entry(p).or_insert(0) += 1;
                }
            }
        }
        dwelling_count.push(*tag_counts.get(&18).unwrap_or(&0)); // "dwelling" tag id
        workplace_count.push(workplaces);
        for (&tag, &count) in &tag_counts {
            per_tag_sum
                .entry(tag)
                .and_modify(|s| *s += count)
                .or_insert(count);
            per_tag_min
                .entry(tag)
                .and_modify(|m| *m = (*m).min(count))
                .or_insert(count);
        }
        barista_employers.push(employers_this_city.get("barista").copied().unwrap_or(0) as i64);
        deep_profession_count
            .push(employers_this_city.values().filter(|&&c| c >= 5).count() as i64);
        for (&p, &c) in &employers_this_city {
            *profession_sum.entry(p).or_insert(0) += c;
        }
        for row in &dist_rows_for_ratio {
            let basis = tag_counts.get(&row.per).copied().unwrap_or(0).max(0) as u64;
            let expected = basis / (row.ratio.smallest() as u64);
            if expected == 0 {
                continue;
            }
            let actual = tag_counts.get(&row.subject).copied().unwrap_or(0).max(0) as u64;
            *ratio_actual_sum.entry(row.key).or_insert(0) += actual;
            *ratio_expected_sum.entry(row.key).or_insert(0) += expected;
            let percent = actual as f64 * 100.0 / expected as f64;
            let slot = ratio_min_percent.entry(row.key).or_insert(f64::MAX);
            if percent < *slot {
                *slot = percent;
                ratio_min_percent_seed.insert(row.key, seed);
            }
        }
        if let Err(e) = d.check_rules(&content) {
            rule_violation_seeds += 1;
            eprintln!("seed {seed}: real rule violation: {e:?}");
        }
    }

    Stats::new(dwelling_count).print("dwelling_count");
    Stats::new(workplace_count).print("workplace_count");
    println!(
        "seeds (0..{BUILDING_TYPE_SEED_COUNT}) with a real rule violation: {rule_violation_seeds}"
    );
    println!(
        "distribution row actual/expected ratio, pooled and per-seed worst, over seeds with a nonzero expected count (0..{BUILDING_TYPE_SEED_COUNT}):"
    );
    for row in &dist_rows_for_ratio {
        let (Some(&actual_sum), Some(&expected_sum)) = (
            ratio_actual_sum.get(row.key),
            ratio_expected_sum.get(row.key),
        ) else {
            println!("  {}: expected is 0 for every seed in this range", row.key);
            continue;
        };
        let pooled_percent = actual_sum as f64 * 100.0 / expected_sum as f64;
        println!(
            "  {}: pooled actual/expected {pooled_percent:.1}% (actual sum {actual_sum}, expected sum {expected_sum}), worst single seed {:.1}% at seed {} (committed tolerance_percent allows down to {}%)",
            row.key,
            ratio_min_percent[row.key],
            ratio_min_percent_seed[row.key],
            100u32.saturating_sub(row.tolerance_percent),
        );
    }
    println!("per-tag placed count, min and pooled mean over 0..{BUILDING_TYPE_SEED_COUNT}:");
    for (&tag, &min) in &per_tag_min {
        let mean = per_tag_sum[&tag] as f64 / BUILDING_TYPE_SEED_COUNT as f64;
        println!("  tag {tag}: min={min} mean={mean:.2}");
    }
    let mut by_mean: Vec<(&str, f64)> = profession_sum
        .iter()
        .map(|(&p, &s)| (p, s as f64 / BUILDING_TYPE_SEED_COUNT as f64))
        .collect();
    by_mean.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    println!("per-profession pooled mean employer count (below 5 shown first):");
    for (p, mean) in &by_mean {
        if *mean < 8.0 {
            println!("  {p}: {mean:.2}");
        }
    }
    Stats::new(barista_employers).print("barista_employers_per_city");
    Stats::new(deep_profession_count)
        .print("professions_employed_by_5_plus_workplaces_per_city (Scale Baseline target ~69)");

    // -- story 15.9: the missing-cafe flake, generalised -----------------
    let missing_tag_seed_count: u64 = std::env::args()
        .nth(1)
        .map(|s| {
            s.parse()
                .unwrap_or_else(|e| panic!("seed count argument {s:?} is not a u64: {e}"))
        })
        .unwrap_or(MISSING_TAG_SEED_COUNT_DEFAULT);
    // Mirrors `inv_generation_required_institutions_are_present_when_
    // their_own_target_is_nonzero`'s own generic distribution loop, plus
    // its hand-named list of tags no `[[distribution]]` row covers --
    // `cafe` left that list in story 15.9 (it is a distribution row now)
    // so only `shop` remains.
    const AD_HOC_PRESENCE_TAGS: &[&str] = &["shop"];
    let dist_rows = &dist_rows_for_ratio[..];
    let ad_hoc_tag_ids: Vec<(&str, u32)> = AD_HOC_PRESENCE_TAGS
        .iter()
        .map(|&key| {
            let id = defs::TAGS
                .iter()
                .find(|t| t.key == key)
                .unwrap_or_else(|| panic!("committed tags must carry a '{key}' entry"))
                .id;
            (key, id)
        })
        .collect();

    println!(
        "\nmissing-tag sweep: {missing_tag_seed_count} seeds (distinct from every sweep above -- \
         `cargo run -p bounds --release --bin measure-generation -- <n>` to change the count)"
    );
    let mut dist_misses: BTreeMap<&str, (u64, Vec<u64>)> = dist_rows
        .iter()
        .map(|r| (r.key, (0u64, Vec::new())))
        .collect();
    let mut ad_hoc_misses: BTreeMap<&str, (u64, Vec<u64>)> = ad_hoc_tag_ids
        .iter()
        .map(|&(key, _)| (key, (0u64, Vec::new())))
        .collect();

    for i in 0..missing_tag_seed_count {
        let seed = mixed_missing_tag_seed(i);
        let d = sim::generation::plan(seed, &cfg, &content).expect("pass 1 is total");
        let mut tag_counts: BTreeMap<u32, u64> = BTreeMap::new();
        for a in d.building_types.assignments() {
            for &t in by_id[&a.building_type].tags {
                *tag_counts.entry(t).or_insert(0) += 1;
            }
        }
        for row in dist_rows {
            let basis = tag_counts.get(&row.per).copied().unwrap_or(0);
            let target = basis / (row.ratio.smallest() as u64);
            if target == 0 {
                continue;
            }
            let actual = tag_counts.get(&row.subject).copied().unwrap_or(0);
            if actual == 0 {
                let entry = dist_misses.get_mut(row.key).unwrap();
                entry.0 += 1;
                if entry.1.len() < 10 {
                    entry.1.push(seed);
                }
            }
        }
        for &(key, tag_id) in &ad_hoc_tag_ids {
            if tag_counts.get(&tag_id).copied().unwrap_or(0) == 0 {
                let entry = ad_hoc_misses.get_mut(key).unwrap();
                entry.0 += 1;
                if entry.1.len() < 10 {
                    entry.1.push(seed);
                }
            }
        }
    }

    println!("distribution rows -- seeds with target >= 1 but 0 actually placed:");
    for row in dist_rows {
        let (count, seeds) = &dist_misses[row.key];
        println!(
            "  {}: {count} of {missing_tag_seed_count} (rate {:.6}%), offending seeds: {:?}",
            row.key,
            *count as f64 * 100.0 / missing_tag_seed_count as f64,
            seeds
        );
    }
    println!("ad hoc presence tags (never distributed) -- seeds with 0 placed:");
    for &(key, _) in &ad_hoc_tag_ids {
        let (count, seeds) = &ad_hoc_misses[key];
        println!(
            "  {key}: {count} of {missing_tag_seed_count} (rate {:.6}%), offending seeds: {:?}",
            *count as f64 * 100.0 / missing_tag_seed_count as f64,
            seeds
        );
    }

    // -- story 15.10: the detour-ratio flake, generalised -----------------
    let detour_seed_count: u64 = std::env::args()
        .nth(2)
        .map(|s| {
            s.parse()
                .unwrap_or_else(|e| panic!("detour seed count argument {s:?} is not a u64: {e}"))
        })
        .unwrap_or(DETOUR_SEED_COUNT_DEFAULT);
    detour_sweep(&cfg, detour_seed_count);
}

/// The detour-bounds sweep (passes 1-2 only), threaded over seeds: every
/// pass-2 detour ceiling's miss count -- the max()-contract (14-node
/// sample) and the p99 fill (64-node sample), both through `streets::`'s
/// one comparison each -- plus the top-10 per-seed worst p99 fills and
/// takeover-range ratios. The header carries the `GENERATION_VERSION` it
/// ran at; `docs/generation.md`'s pasted copy must carry the same one
/// (`bounds`'s `generation_sweep_current`).
fn detour_sweep(cfg: &GenerationConfig, n: u64) {
    let threads = std::thread::available_parallelism().map_or(4, |t| t.get()) as u64;
    let takeover = cfg.detour_ratio_takeover_distance_cells();
    println!(
        "\ndetour-bounds sweep at GENERATION_VERSION={}: {n} seeds, {threads} threads, passes 1-2 \
         only (`cargo run -p bounds --release --bin measure-generation -- detour <n>`)",
        sim::generation::GENERATION_VERSION
    );
    struct Partial {
        max_miss: BandMiss,
        p99_miss: BandMiss,
        ratio_top: Vec<(i64, u64)>,
        fill_top: Vec<(i64, u64)>,
    }
    fn push_top(top: &mut Vec<(i64, u64)>, entry: (i64, u64)) {
        top.push(entry);
        top.sort_unstable();
        if top.len() > 10 {
            top.remove(0);
        }
    }
    let start = Instant::now();
    let partials: Vec<Partial> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                scope.spawn(move || {
                    let mut p = Partial {
                        max_miss: BandMiss::new(),
                        p99_miss: BandMiss::new(),
                        ratio_top: Vec::new(),
                        fill_top: Vec::new(),
                    };
                    let mut i = t;
                    while i < n {
                        let seed = mixed_detour_seed(i);
                        i += threads;
                        let lu = land_use::run(seed, cfg.site(), cfg).expect("pass 1 is total");
                        let net = streets::run(seed, &lu, cfg);
                        let samples = net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES);
                        if streets::detour_bound_violation(&samples, cfg).is_some() {
                            p.max_miss.record(seed);
                        }
                        if let Some(r) = samples
                            .iter()
                            .filter(|s| s.manhattan >= takeover)
                            .map(streets::DetourSample::ratio_pct)
                            .max()
                        {
                            push_top(&mut p.ratio_top, (r, seed));
                        }
                        let p99_samples = net.detour_samples(streets::DETOUR_P99_SAMPLE_MAX_NODES);
                        push_top(
                            &mut p.fill_top,
                            (streets::p99_fill_pct(&p99_samples, cfg), seed),
                        );
                        if streets::p99_detour_violation(&p99_samples, cfg).is_some() {
                            p.p99_miss.record(seed);
                        }
                    }
                    p
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("a sweep thread panicked"))
            .collect()
    });
    let elapsed = start.elapsed();
    let (mut max_miss, mut p99_miss) = (BandMiss::new(), BandMiss::new());
    let (mut ratio_top, mut fill_top) = (Vec::new(), Vec::new());
    for p in partials {
        max_miss.count += p.max_miss.count;
        max_miss.seeds.extend(p.max_miss.seeds);
        p99_miss.count += p.p99_miss.count;
        p99_miss.seeds.extend(p.p99_miss.seeds);
        for e in p.ratio_top {
            push_top(&mut ratio_top, e);
        }
        for e in p.fill_top {
            push_top(&mut fill_top, e);
        }
    }
    max_miss.seeds.sort_unstable();
    max_miss.seeds.truncate(10);
    p99_miss.seeds.sort_unstable();
    p99_miss.seeds.truncate(10);

    print_ceiling_report("detour max()-contract (14-node sample)", &max_miss, n);
    print_ceiling_report(
        &format!(
            "p99_detour_fill_percent = {}% (64-node sample)",
            cfg.p99_detour_fill_percent
        ),
        &p99_miss,
        n,
    );
    println!("p99 detour fill, top 10 per-seed worsts (ascending):");
    for (fill, seed) in &fill_top {
        println!("  {fill}% at seed {seed}");
    }
    println!(
        "detour_ratio_pct_sampled_at_or_beyond_takeover ({takeover} cells) top 10 per-seed \
         worsts (ascending):"
    );
    for (ratio, seed) in &ratio_top {
        println!("  {ratio}% at seed {seed}");
    }
    println!(
        "detour-bounds sweep wall-clock: {:.1}s ({:.3}ms/seed)",
        elapsed.as_secs_f64(),
        elapsed.as_secs_f64() * 1000.0 / n.max(1) as f64
    );
}

/// One committed ceiling's own miss tally over the detour-bounds sweep --
/// count and up to ten offending seeds, never every offending seed (the
/// same shape as the missing-tag sweep's own `dist_misses`/`ad_hoc_
/// misses` above).
struct BandMiss {
    count: u64,
    seeds: Vec<u64>,
}

impl BandMiss {
    fn new() -> Self {
        BandMiss {
            count: 0,
            seeds: Vec::new(),
        }
    }

    fn record(&mut self, seed: u64) {
        self.count += 1;
        if self.seeds.len() < 10 {
            self.seeds.push(seed);
        }
    }
}

/// Prints one ceiling's own miss count, rate and the failure probability
/// a [`CI_PROPTEST_CASES`]-case CI run implies (`1 - (1 - p)^cases`) --
/// and, when the miss count is zero, the rule-of-three upper bound on
/// the per-seed miss probability (`3 / n`) instead, since zero observed
/// misses over `n` seeds is a bound, never a zero rate (Quentin's
/// direction, story 15.10: the doc comment and toml comment that read
/// this output must state the observed count, `n` and the bound, never
/// the word "zero" alone).
fn print_ceiling_report(name: &str, miss: &BandMiss, n: u64) {
    let rate = miss.count as f64 / n as f64;
    let ci_fail_prob = 1.0 - (1.0 - rate).powi(CI_PROPTEST_CASES as i32);
    println!(
        "  {name}: {} of {n} misses (rate {:.6}%), implied {CI_PROPTEST_CASES}-case CI failure \
         probability {:.6}%, offending seeds: {:?}",
        miss.count,
        rate * 100.0,
        ci_fail_prob * 100.0,
        miss.seeds
    );
    if miss.count == 0 {
        let rule_of_three_bound = 3.0 / n as f64;
        let bound_ci_fail_prob = 1.0 - (1.0 - rule_of_three_bound).powi(CI_PROPTEST_CASES as i32);
        println!(
            "    zero observed misses over {n} seeds is a bound, not a zero rate -- rule-of-\
             three upper bound on the per-seed miss probability: {:.6}% (implied \
             {CI_PROPTEST_CASES}-case CI failure probability <= {:.4}%)",
            rule_of_three_bound * 100.0,
            bound_ci_fail_prob * 100.0
        );
    }
}

/// `p99 <seed>`: the 64-node sample's pairs at or above the p99 fill
/// rank, with each pair's ratio, excess and fill, then the pairs over
/// `p99_detour_fill_percent` through `streets::p99_detour_violation`.
fn p99_trace(cfg: &GenerationConfig, seed: u64) {
    let lu = land_use::run(seed, cfg.site(), cfg).expect("pass 1 is total");
    let net = streets::run(seed, &lu, cfg);
    let samples = net.detour_samples(streets::DETOUR_P99_SAMPLE_MAX_NODES);
    let p99 = streets::p99_fill_pct(&samples, cfg);
    println!(
        "seed {seed}: {} sampled pairs, p99 fill {p99}% (bound {}%), p99 ratio {}%, max_detour_excess_cells {}",
        samples.len(),
        cfg.p99_detour_fill_percent,
        streets::p99_ratio_pct(&samples),
        cfg.max_detour_excess_cells
    );
    let mut tail: Vec<_> = samples.iter().filter(|s| s.fill_pct(cfg) >= p99).collect();
    tail.sort_by_key(|s| (s.manhattan, s.a, s.b));
    for s in &tail {
        println!(
            "  {:?}-{:?} manhattan {} network {} ratio {}% excess {} allowed {} fill {}%",
            s.a,
            s.b,
            s.manhattan,
            s.network,
            s.ratio_pct(),
            s.excess_cells(),
            s.detour_allowed(cfg),
            s.fill_pct(cfg)
        );
    }
    println!(
        "p99_detour_violation: {:?}",
        streets::p99_detour_violation(&samples, cfg)
    );
    println!(
        "pairs failing detour_bound_holds: {}",
        samples
            .iter()
            .filter(|s| !s.detour_bound_holds(cfg))
            .count()
    );
}
