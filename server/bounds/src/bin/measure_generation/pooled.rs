use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generated::defs;
use sim::generation::guards;
use sim::generation::{GenerationConfig, GenerationContent};

/// A `generation.neighbourhood.<name>` balance value.
fn nkey(name: &str) -> i64 {
    sim::balance::value(defs::BALANCE, &format!("generation.neighbourhood.{name}"))
}

/// What one of the fixed seeds `0..256` contributes to the pooled figures.
struct Record {
    low: i64,
    high: i64,
    chopped: usize,
    total: usize,
    core: u64,
    edge: u64,
    city_tenths: u64,
    shuttered: guards::Shuttered,
    /// Per scoped row: `(biting, pairs)`.
    bite: Vec<(u64, u64)>,
}

/// The fixed-seed figures: the seeds `0..256` pooled low/high band mean
/// block area, chopped share, shuttered frontage, catchment floor bite and
/// crowding, and the evidence seeds' own ratios. Deterministic -- no miss
/// rate.
pub fn pooled_sweep(cfg: &GenerationConfig) {
    let content = GenerationContent::committed();
    println!(
        "{}: seeds 0..256 pooled, evidence seeds 1, 2, 3",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::POOLED_EVIDENCE)
    );
    let scoped: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|r| matches!(r.scope, sim::rules::DistributionScope::Catchment { .. }))
        .collect();
    let screen =
        (cfg.neighbourhood.viewport_width_cells * cfg.neighbourhood.viewport_height_cells) as u64;
    let site = cfg.site();
    let records = par_map_in_seed_order(256, threads(), |seed| {
        let d = sim::generation::plan(seed, cfg, &content).expect("committed config generates");
        let sk = &d.skeleton;
        let (low, high) = sk
            .streets
            .mean_area_by_density_band(&sk.land_use, cfg)
            .unwrap_or((0, 0));
        let (chopped, total) = sk.streets.low_band_chopped_blocks(&sk.land_use, cfg);
        let (core, edge) = guards::core_and_edge(sk, cfg, &content);
        let mut shuttered = guards::Shuttered::default();
        shuttered.add(sk, cfg, &content);
        let site_view = d.site(&content);
        Record {
            low,
            high,
            chopped,
            total,
            core,
            edge,
            city_tenths: sk.supported_citizens(site, cfg, &content) * screen * 10
                / (site.width() * site.height()) as u64,
            shuttered,
            bite: scoped
                .iter()
                .map(|row| guards::catchment_bite(&site_view, row))
                .collect(),
        }
    });
    let (mut low_sum, mut high_sum) = (0i64, 0i64);
    let (mut chopped_sum, mut total_sum) = (0usize, 0usize);
    let (mut core_sum, mut edge_sum, mut city_sum) = (0u64, 0u64, 0u64);
    let mut shuttered = guards::Shuttered::default();
    let mut bite = vec![(0u64, 0u64); scoped.len()];
    for r in &records {
        low_sum += r.low;
        high_sum += r.high;
        chopped_sum += r.chopped;
        total_sum += r.total;
        core_sum += r.core;
        edge_sum += r.edge;
        city_sum += r.city_tenths;
        shuttered.poor.0 += r.shuttered.poor.0;
        shuttered.poor.1 += r.shuttered.poor.1;
        shuttered.rich.0 += r.shuttered.rich.0;
        shuttered.rich.1 += r.shuttered.rich.1;
        for (k, (b, p)) in r.bite.iter().enumerate() {
            bite[k].0 += b;
            bite[k].1 += p;
        }
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
        let d = sim::generation::plan(seed, cfg, &content).expect("committed config generates");
        let (low, high) = d
            .skeleton
            .streets
            .mean_area_by_density_band(&d.skeleton.land_use, cfg)
            .expect("the evidence seeds populate both density bands");
        println!(
            "evidence seed {seed}: low-band / high-band mean block area {}.{:02}x (Artie's bar 2x)",
            low / high.max(1),
            low * 100 / high.max(1) % 100
        );
    }
    println!(
        "pooled shuttered share of the bottom affluence third's commercial frontage: {} of {} ({}%, shuttered_bottom_third_min_percent = {}); top third shuttered: {} of {}",
        shuttered.poor.0,
        shuttered.poor.1,
        shuttered.poor.0 * 100 / shuttered.poor.1.max(1),
        nkey("shuttered_bottom_third_min_percent"),
        shuttered.rich.0,
        shuttered.rich.1
    );
    for (row, (b, p)) in scoped.iter().zip(&bite) {
        println!(
            "catchment floor bite, row {}: {b} of {p} (seed, catchment) pairs ({}%, catchment_floor_min_bite_percent = {})",
            content.rules.key_of(row.id).unwrap_or("?"),
            b * 100 / (*p).max(1),
            sim::balance::value(defs::BALANCE, "generation.catchment_floor_min_bite_percent")
        );
    }
    println!(
        "pooled edge over core: {}% (quiet_edge_pooled_max_percent_of_core = {}%)",
        edge_sum * 100 / core_sum.max(1),
        nkey("quiet_edge_pooled_max_percent_of_core")
    );
    println!(
        "pooled core over city mean screen: {}% (busy_core_over_city_min_percent = {}%); city mean screen {}.{} citizens",
        core_sum * 1000 / city_sum.max(1),
        nkey("busy_core_over_city_min_percent"),
        city_sum / 256 / 10,
        city_sum / 256 % 10
    );
}
