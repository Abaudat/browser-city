use std::time::Instant;

use sim::generation::{GenerationConfig, land_use, streets};

use crate::common::*;

/// The detour-bounds sweep (passes 1-2 only), threaded over seeds: every
/// pass-2 detour ceiling's miss count -- the max()-contract (14-node
/// sample) and the p99 fill (64-node sample), both through `streets::`'s
/// one comparison each -- plus the top-10 per-seed worst p99 fills and
/// takeover-range ratios. The header carries the `GENERATION_VERSION` it
/// ran at; `docs/generation.md`'s pasted copy must carry the same one
/// (`bounds`'s `generation_sweep_current`).
pub fn detour_sweep(cfg: &GenerationConfig, n: u64) {
    let threads = std::thread::available_parallelism().map_or(4, |t| t.get()) as u64;
    let takeover = cfg.detour_ratio_takeover_distance_cells();
    println!(
        "
{}: {n} seeds, {threads} threads, passes 1-2 only",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::DETOUR_SWEEP)
    );
    struct Partial {
        max_miss: BandMiss,
        p99_miss: BandMiss,
        floor_miss: BandMiss,
        ratio_top: Vec<(i64, u64)>,
        fill_top: Vec<(i64, u64)>,
        /// Lowest per-city low/high band mean-area ratios, in tenths of
        /// a percent (descending, so the 10 lowest are kept).
        floor_low: Vec<(i64, u64)>,
    }
    pub fn push_low(low: &mut Vec<(i64, u64)>, entry: (i64, u64)) {
        low.push(entry);
        low.sort_unstable_by(|a, b| b.cmp(a));
        if low.len() > 10 {
            low.remove(0);
        }
    }
    pub fn push_top(top: &mut Vec<(i64, u64)>, entry: (i64, u64)) {
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
                        floor_miss: BandMiss::new(),
                        ratio_top: Vec::new(),
                        fill_top: Vec::new(),
                        floor_low: Vec::new(),
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
                        if let Some((low, high)) = net.mean_area_by_density_band(&lu, cfg) {
                            if low * 100 < high * cfg.peripheral_low_band_floor_percent as i64 {
                                p.floor_miss.record(seed);
                            }
                            push_low(&mut p.floor_low, (low * 1000 / high.max(1), seed));
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
    let (mut max_miss, mut p99_miss, mut floor_miss) =
        (BandMiss::new(), BandMiss::new(), BandMiss::new());
    let mut ratio_top: Vec<(i64, u64)> = Vec::new();
    let mut fill_top: Vec<(i64, u64)> = Vec::new();
    let mut floor_low: Vec<(i64, u64)> = Vec::new();
    for p in partials {
        floor_miss.count += p.floor_miss.count;
        floor_miss.seeds.extend(p.floor_miss.seeds);
        for e in p.floor_low {
            push_low(&mut floor_low, e);
        }
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
    for (permille, seed) in floor_low.iter().rev() {
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
