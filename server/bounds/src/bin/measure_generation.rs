//! Re-measures every statistically-derived key in `generation.plots.*`
//! and `generation.envelopes.*` (`max_open_percent_by_count/area`,
//! `max_unplotted_percent`, `max_rejected_plot_percent`,
//! `target_count_per_million_cells`, `count_tolerance_percent`,
//! `mean_width/depth_cells`) over seeds `0..50_000` at the committed
//! `defs::BALANCE`. A binary, not a test: too slow for every CI run, and
//! `scripts/ci/check-trace-matrix.sh` refuses a skipped test.
//!
//! ```text
//! cargo run -p bounds --release --bin measure-generation
//! ```
//!
//! Prints min/p1/p50/p99/max, mean and standard deviation for building
//! count, rejection percent, open-plot percent (by count and by area),
//! unplotted percent and per-city mean envelope width/depth (x10).

use std::collections::BTreeMap;

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, building_types, envelopes};

const SEED_COUNT: u64 = 50_000;
/// Story 3.4's own pass adds `sim::rules::evaluate` over the whole
/// finished district on top of pass 5's own placement -- measured over a
/// smaller range than the four-pass stats above so this binary still
/// finishes in a reasonable time; still large enough to see a real tail.
const BUILDING_TYPE_SEED_COUNT: u64 = 5_000;

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

    for seed in 0..SEED_COUNT {
        let d = sim::generation::plan(seed, &cfg, &content).expect("pass 1 is total");
        let (net, pm, em) = (&d.streets, &d.plots, &d.envelopes);

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

    for seed in 0..BUILDING_TYPE_SEED_COUNT {
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
        if d.check_rules(&content).is_err() {
            rule_violation_seeds += 1;
        }
    }

    Stats::new(dwelling_count).print("dwelling_count");
    Stats::new(workplace_count).print("workplace_count");
    println!(
        "seeds (0..{BUILDING_TYPE_SEED_COUNT}) with a real rule violation: {rule_violation_seeds}"
    );
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
}
