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

use std::collections::BTreeMap;

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, building_types, envelopes, streets};
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

fn main() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).expect("committed balance is valid");
    let content = GenerationContent::committed();
    let site = cfg.site();
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
        deep_profession_count
            .push(employers_this_city.values().filter(|&&c| c >= 5).count() as i64);
        for (&p, &c) in &employers_this_city {
            *profession_sum.entry(p).or_insert(0) += c;
        }
        for row in &dist_rows_for_ratio {
            let basis = tag_counts.get(&row.per).copied().unwrap_or(0).max(0) as u64;
            let expected = basis / (row.ratio.max(1) as u64);
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
    let mut dist_rows: Vec<sim::rules::DistributionRow> = content
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
    dist_rows.sort_by_key(|d| d.id);
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
        for row in &dist_rows {
            let basis = tag_counts.get(&row.per).copied().unwrap_or(0);
            let target = basis / (row.ratio.max(1) as u64);
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
    for row in &dist_rows {
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
}
