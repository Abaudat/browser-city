use std::time::Instant;

use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generation::{GenerationConfig, land_use, streets};

use crate::common::*;

/// What one seed's passes 1-2 say about the three per-seed ceilings.
struct Record {
    seed: u64,
    max_miss: bool,
    p99_miss: bool,
    floor_miss: bool,
    /// Worst ratio among sampled pairs at or beyond the takeover distance.
    ratio: Option<i64>,
    fill: i64,
    /// Low-band over high-band mean block area, in tenths of a percent.
    floor_ratio: Option<i64>,
}

/// Keeps the 10 largest `(value, seed)` entries, ascending.
fn push_top(top: &mut Vec<(i64, u64)>, entry: (i64, u64)) {
    top.push(entry);
    top.sort_unstable();
    if top.len() > 10 {
        top.remove(0);
    }
}

/// The detour-bounds sweep (passes 1-2 only): the max()-contract (14-node
/// sample), the p99 fill (64-node sample), the per-city periphery floor,
/// and the top-10 per-seed worsts of the fill and the takeover-range ratio.
pub fn detour_sweep(cfg: &GenerationConfig, n: u64) {
    let takeover = cfg.detour_ratio_takeover_distance_cells();
    println!(
        "\n{}: {n} seeds, {} threads, passes 1-2 only",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::DETOUR_SWEEP),
        threads()
    );
    let start = Instant::now();
    let records = par_map_in_seed_order(n, threads(), |i| {
        let seed = mixed_detour_seed(i);
        let lu = land_use::run(seed, cfg.site(), cfg).expect("pass 1 is total");
        let net = streets::run(seed, &lu, cfg);
        let samples = net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES);
        let p99_samples = net.detour_samples(streets::DETOUR_P99_SAMPLE_MAX_NODES);
        let bands = net.mean_area_by_density_band(&lu, cfg);
        Record {
            seed,
            max_miss: streets::detour_bound_violation(&samples, cfg).is_some(),
            p99_miss: streets::p99_detour_violation(&p99_samples, cfg).is_some(),
            floor_miss: bands.is_some_and(|(low, high)| {
                low * 100 < high * cfg.peripheral_low_band_floor_percent as i64
            }),
            ratio: samples
                .iter()
                .filter(|s| s.manhattan >= takeover)
                .map(streets::DetourSample::ratio_pct)
                .max(),
            fill: streets::p99_fill_pct(&p99_samples, cfg),
            floor_ratio: bands.map(|(low, high)| low * 1000 / high.max(1)),
        }
    });
    let elapsed = start.elapsed();

    let (mut max_miss, mut p99_miss, mut floor_miss) =
        (BandMiss::new(), BandMiss::new(), BandMiss::new());
    let mut ratio_top: Vec<(i64, u64)> = Vec::new();
    let mut fill_top: Vec<(i64, u64)> = Vec::new();
    // Negated, so the lowest ratios are the largest entries kept.
    let mut floor_low: Vec<(i64, u64)> = Vec::new();
    for r in records {
        if r.max_miss {
            max_miss.record(r.seed);
        }
        if r.p99_miss {
            p99_miss.record(r.seed);
        }
        if r.floor_miss {
            floor_miss.record(r.seed);
        }
        if let Some(ratio) = r.ratio {
            push_top(&mut ratio_top, (ratio, r.seed));
        }
        push_top(&mut fill_top, (r.fill, r.seed));
        if let Some(permille) = r.floor_ratio {
            push_top(&mut floor_low, (-permille, r.seed));
        }
    }

    print_ceiling_report("detour max()-contract (14-node sample)", &max_miss, n);
    print_ceiling_report(
        &format!(
            "p99_detour_fill_percent = {}% (64-node sample)",
            cfg.p99_detour_fill_percent
        ),
        &p99_miss,
        n,
    );
    print_ceiling_report(
        &format!(
            "peripheral_low_band_floor_percent = {}% (per-city low/high band mean block area)",
            cfg.peripheral_low_band_floor_percent
        ),
        &floor_miss,
        n,
    );
    println!("peripheral low/high band mean block area, 10 lowest per-seed ratios (ascending):");
    for (negated, seed) in floor_low.iter().rev() {
        let permille = -negated;
        println!("  {}.{}% at seed {seed}", permille / 10, permille % 10);
    }
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
