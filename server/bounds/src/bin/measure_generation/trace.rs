use sim::generation::{GenerationConfig, land_use, streets};

/// `p99 <seed>`: the 64-node sample's pairs at or above the p99 fill
/// rank, with each pair's ratio, excess and fill, then the pairs over
/// `p99_detour_fill_percent` through `streets::p99_detour_violation`.
pub fn p99_trace(cfg: &GenerationConfig, seed: u64) {
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
