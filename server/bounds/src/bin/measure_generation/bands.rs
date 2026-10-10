use std::collections::BTreeMap;
use std::time::Instant;

use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generated::defs;
use sim::generation::guards;
use sim::generation::{GenerationConfig, GenerationContent, LandUse, building_types};

use crate::common::*;

/// A `generation.neighbourhood.<name>` balance value.
fn nkey(name: &str) -> i64 {
    sim::balance::value(defs::BALANCE, &format!("generation.neighbourhood.{name}"))
}

/// Everything one seed's full five-pass district tells the band sweep.
struct Record {
    seed: u64,
    share_dev: [i64; 3],
    share_miss: bool,
    placed: i64,
    building_miss: bool,
    workplaces: i64,
    workplace_miss: bool,
    core: u64,
    edge: u64,
    legibility: guards::Legibility,
    character_miss: bool,
    pocket_count: usize,
    pocket_share_bp: i64,
    pocket_miss: bool,
    depth: i64,
}

/// The band sweep: every per-seed band and any-seed guard the proptests
/// draw arbitrary seeds against, over the full five-pass `plan`.
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
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let character = guards::CharacterParams {
        legible_step: nkey("legible_step") as i32,
        min_corners: nkey("min_corners") as usize,
        min_apart_neighbourhoods: nkey("min_apart_neighbourhoods") as usize,
        poor_band_max: nkey("poor_band_max") as i32,
    };
    let min_shops = nkey("legibility_min_shops") as u64;
    let min_employers = sim::balance::value(
        defs::BALANCE,
        "generation.building_types.min_employers_per_profession",
    ) as u64;
    let busy_min = nkey("busy_screen_min_citizens") as u64;
    let quiet_max = nkey("quiet_edge_max_percent_of_core") as u64;
    let shop_min = nkey("legibility_min_shop_mix_percent");
    let pole_min = nkey("legibility_pole_shop_mix_percent");
    let age_min = nkey("legibility_min_distance_percent");
    let pocket_min = cfg.institutional_min_pockets;
    let pocket_max_pct = cfg.institutional_max_pocket_share_percent;
    let depth_min = sim::balance::value(
        defs::BALANCE,
        "generation.building_types.profession_count_per_city_min",
    );

    let start = Instant::now();
    let records = par_map_in_seed_order(n, threads(), |i| {
        let seed = mixed_band_seed(i);
        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
        let total = d.land_use.cols() as i64 * d.land_use.rows() as i64;
        let mut dev = [0i64; 3];
        for (k, (u, key, _)) in uses.iter().enumerate() {
            dev[k] = d.land_use.area_cells(*u) * 1000 / total - *key as i64 * 10;
        }
        let (core, edge) = guards::core_and_edge(&d, cfg, content);
        let pockets = guards::institutional_pockets(&d.land_use);
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
                .filter(|a| building_types::is_workplace(by_id[&a.building_type]))
                .count() as i64,
            workplace_miss: d.check_workplace_count(cfg, content).is_err(),
            core,
            edge,
            legibility: guards::legibility(&d, cfg, content, character.legible_step, min_shops),
            character_miss: guards::character_violation(&d, cfg, content, &character).is_some(),
            pocket_count: pockets.count,
            pocket_share_bp: pockets.largest_share_basis_points(),
            pocket_miss: (pockets.count as i64) < pocket_min
                || pockets.largest_cells * 100 > pockets.total_cells * pocket_max_pct
                || pockets.touching.is_some(),
            depth: guards::profession_depth(&d, content, min_employers),
        }
    });

    let mut share_dev: Vec<Vec<i64>> = vec![Vec::new(); uses.len()];
    let mut building_count = Vec::new();
    let mut workplace_count = Vec::new();
    let (mut share_miss, mut building_miss, mut workplace_miss) =
        (BandMiss::new(), BandMiss::new(), BandMiss::new());
    let (mut busy_miss, mut quiet_miss, mut shop_miss, mut pole_miss, mut age_miss) = (
        BandMiss::new(),
        BandMiss::new(),
        BandMiss::new(),
        BandMiss::new(),
        BandMiss::new(),
    );
    let (mut character_miss, mut pocket_miss, mut depth_miss) =
        (BandMiss::new(), BandMiss::new(), BandMiss::new());
    let (mut min_count, mut max_count) = ((i64::MAX, 0u64), (i64::MIN, 0u64));
    let (mut cores, mut quiet_pct) = (Vec::new(), Vec::new());
    let (mut shop_mix, mut pole_mix, mut age_mix) = (Vec::new(), Vec::new(), Vec::new());
    let (mut pocket_counts, mut pocket_shares, mut depths) = (Vec::new(), Vec::new(), Vec::new());
    for r in records {
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
        cores.push(r.core as i64);
        quiet_pct.push((r.edge * 100 / r.core.max(1)) as i64);
        if r.core < busy_min {
            busy_miss.record(r.seed);
        }
        if r.edge * 100 > r.core * quiet_max {
            quiet_miss.record(r.seed);
        }
        if let Some((v, _, _)) = r.legibility.affluence_shop_mix {
            shop_mix.push(v);
            if v < shop_min {
                shop_miss.record(r.seed);
            }
        }
        if let Some((v, _, _)) = r.legibility.pole_shop_mix {
            pole_mix.push(v);
            if v < pole_min {
                pole_miss.record(r.seed);
            }
        }
        if let Some((v, _, _)) = r.legibility.age_distance {
            age_mix.push(v);
            if v < age_min {
                age_miss.record(r.seed);
            }
        }
        if r.character_miss {
            character_miss.record(r.seed);
        }
        pocket_counts.push(r.pocket_count as i64);
        pocket_shares.push(r.pocket_share_bp);
        if r.pocket_miss {
            pocket_miss.record(r.seed);
        }
        depths.push(r.depth);
        if r.depth < depth_min {
            depth_miss.record(r.seed);
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
        "building_count extremes over the band sweep: min {} at seed {}, max {} at seed {} (pinned in invariants.rs's PINNED_BUILDING_COUNT_SEEDS)",
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

    Stats::new(cores).print("core_citizens_per_screen");
    print_ceiling_report(
        &format!("busy core (busy_screen_min_citizens = {busy_min})"),
        &busy_miss,
        n,
    );
    Stats::new(quiet_pct).print("edge_percent_of_core");
    print_ceiling_report(
        &format!("quiet edge (quiet_edge_max_percent_of_core = {quiet_max}%)"),
        &quiet_miss,
        n,
    );
    for (name, values, threshold, miss) in [
        (
            "legibility_min_shop_mix_percent",
            shop_mix,
            shop_min,
            &shop_miss,
        ),
        (
            "legibility_pole_shop_mix_percent",
            pole_mix,
            pole_min,
            &pole_miss,
        ),
        (
            "legibility_min_distance_percent",
            age_mix,
            age_min,
            &age_miss,
        ),
    ] {
        Stats::new(values).print(&format!("{name} closest qualifying pair per seed"));
        print_ceiling_report(&format!("{name} = {threshold}%"), miss, n);
    }
    print_ceiling_report(
        &format!(
            "district character (min_corners, min_apart_neighbourhoods, legible_step, min_home_cells via poor_band_max = {})",
            character.poor_band_max
        ),
        &character_miss,
        n,
    );
    Stats::new(pocket_counts).print("institutional_pockets");
    Stats::new(pocket_shares).print("largest_institutional_pocket_share_basis_points");
    print_ceiling_report(
        &format!(
            "institutional pockets (institutional_min_pockets = {pocket_min}, institutional_max_pocket_share_percent = {pocket_max_pct}%, no two touching)"
        ),
        &pocket_miss,
        n,
    );
    Stats::new(depths).print("profession_depth_per_city");
    print_ceiling_report(
        &format!("profession_count_per_city_min = {depth_min}"),
        &depth_miss,
        n,
    );
    println!(
        "band sweep wall-clock: {:.1}s ({:.3}ms/seed)",
        start.elapsed().as_secs_f64(),
        start.elapsed().as_secs_f64() * 1000.0 / n.max(1) as f64
    );
}
