use sim::generation::{GenerationConfig, land_use, streets};

/// The fixed-seed figures: the seeds `0..256` pooled low/high band mean
/// block area and chopped share, and the evidence seeds' own ratios.
/// Deterministic -- no miss rate.
pub fn pooled_sweep(cfg: &GenerationConfig) {
    println!(
        "{}: seeds 0..256 pooled, evidence seeds 1, 2, 3",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::POOLED_EVIDENCE)
    );
    let (mut low_sum, mut high_sum) = (0i64, 0i64);
    let (mut chopped_sum, mut total_sum) = (0usize, 0usize);
    for seed in 0u64..256 {
        let lu = land_use::run(seed, cfg.site(), cfg).expect("committed config generates");
        let net = streets::run(seed, &lu, cfg);
        if let Some((low, high)) = net.mean_area_by_density_band(&lu, cfg) {
            low_sum += low;
            high_sum += high;
        }
        let (chopped, total) = net.low_band_chopped_blocks(&lu, cfg);
        chopped_sum += chopped;
        total_sum += total;
    }
    println!(
        "pooled low-band / high-band mean block area over seeds 0..256: {}% (peripheral_pooled_min_ratio_percent = {}%)",
        low_sum * 100 / high_sum.max(1),
        cfg.peripheral_pooled_min_ratio_percent
    );
    println!(
        "pooled chopped share of low-band blocks over seeds 0..256: {chopped_sum} of {total_sum} ({}%)",
        chopped_sum * 100 / total_sum.max(1)
    );
    for seed in [1u64, 2, 3] {
        let lu = land_use::run(seed, cfg.site(), cfg).expect("committed config generates");
        let net = streets::run(seed, &lu, cfg);
        let (low, high) = net
            .mean_area_by_density_band(&lu, cfg)
            .expect("the evidence seeds populate both density bands");
        println!(
            "evidence seed {seed}: low-band / high-band mean block area {}.{:02}x (Artie's bar 2x)",
            low / high.max(1),
            low * 100 / high.max(1) % 100
        );
    }
}
