use std::collections::BTreeMap;
use std::time::Instant;

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, LandUse, building_types};

use crate::common::*;

/// The band sweep (module doc, story 4.21).
pub fn band_sweep(cfg: &GenerationConfig, content: &GenerationContent, n: u64) {
    println!(
        "
{}: {n} seeds, all five passes (salt {MEASURE_BAND_SEED_SALT:#x})",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::BAND_SWEEP)
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
    // One record per seed index, computed on threads and reduced in
    // index order, so the printed block does not depend on thread count.
    struct Record {
        seed: u64,
        share_dev: [i64; 3],
        share_miss: bool,
        placed: i64,
        building_miss: bool,
        workplaces: i64,
        workplace_miss: bool,
    }
    let threads = std::thread::available_parallelism().map_or(4, |t| t.get()) as u64;
    let mut records: Vec<(u64, Record)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let (uses, by_id) = (&uses, &by_id);
                scope.spawn(move || {
                    let mut out = Vec::new();
                    let mut i = t;
                    while i < n {
                        let seed = mixed_band_seed(i);
                        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
                        let total = d.land_use.cols() as i64 * d.land_use.rows() as i64;
                        let mut dev = [0i64; 3];
                        for (k, (u, key, _)) in uses.iter().enumerate() {
                            dev[k] = d.land_use.area_cells(*u) * 1000 / total - *key as i64 * 10;
                        }
                        out.push((
                            i,
                            Record {
                                seed,
                                share_dev: dev,
                                share_miss: d.land_use.share_band_violation(cfg).is_some(),
                                placed: d.envelopes.placed_count(),
                                building_miss: d.check_building_count(cfg).is_err(),
                                workplaces: d
                                    .building_types
                                    .assignments()
                                    .iter()
                                    .filter(|a| {
                                        building_types::is_workplace(by_id[&a.building_type])
                                    })
                                    .count() as i64,
                                workplace_miss: d.check_workplace_count(cfg, content).is_err(),
                            },
                        ));
                        i += threads;
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("a sweep thread panicked"))
            .collect()
    });
    records.sort_unstable_by_key(|r| r.0);
    for (_, r) in records {
        for (k, dev) in r.share_dev.iter().enumerate() {
            share_dev[k].push(*dev);
        }
        if r.share_miss {
            share_miss.record(r.seed);
        }
        if r.placed < min_count.0 {
            min_count = (r.placed, r.seed);
        }
        if r.placed > max_count.0 {
            max_count = (r.placed, r.seed);
        }
        building_count.push(r.placed);
        if r.building_miss {
            building_miss.record(r.seed);
        }
        workplace_count.push(r.workplaces);
        if r.workplace_miss {
            workplace_miss.record(r.seed);
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
