use std::collections::BTreeMap;

use bounds::generation_stamp::{CITY_POOL_SIZE, INTERIORS_SWEEP};
use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generation::guards::{self, InteriorFigures};
use sim::generation::{GenerationConfig, GenerationContent, InteriorOutcome};
use sim::rng::seed_from_ids;

use crate::common::*;

/// The interiors sweep's default city count. The CI run judges
/// [`CITY_POOL_SIZE`] cities per property, so with zero misses over `n`
/// cities the rule-of-three bound `3 / n` per city implies a failure
/// probability of `1 - (1 - 3/n)^96`; `n = 30,000` keeps it at 0.96%,
/// under the 1.2% the other blocks sit at.
pub const INTERIOR_SEED_COUNT_DEFAULT: u64 = 30_000;
/// The sweep's own salt, distinct from every other sweep's.
pub const MEASURE_INTERIORS_SEED_SALT: u64 = 0xB0F0_5EE7;

/// What one city's interiors say.
struct Record {
    seed: u64,
    figures: InteriorFigures,
    /// The first verdict `check` fails on, `None` when it holds.
    failure: Option<String>,
    kind_spread_ok: bool,
    placed_buildings: i64,
    shells: i64,
    rejected: i64,
    walls: i64,
    floors: i64,
    thresholds: i64,
    fixtures: i64,
    attempts: Vec<u32>,
}

fn report(name: &str, miss: &BandMiss, n: u64, cases: u32) {
    print_ceiling_report(name, miss, n, cases);
}

/// Story 3.5's per-city interior ceilings over `n` seeds drawn through
/// `seed_from_ids`, each judged by the same guard function the pooled
/// invariants call, and the pooled enterable-share band over consecutive
/// [`CITY_POOL_SIZE`]-city pools.
pub fn interiors_sweep(cfg: &GenerationConfig, content: &GenerationContent, n: u64) {
    println!(
        "{}: {n} seeds, {} threads (salt {MEASURE_INTERIORS_SEED_SALT:#x})",
        bounds::generation_stamp::stamp(&INTERIORS_SWEEP),
        threads()
    );
    let cases = INTERIORS_SWEEP.ci_cases;
    let records = par_map_in_seed_order(n, threads(), |i| {
        let seed = seed_from_ids(MEASURE_INTERIORS_SEED_SALT, i);
        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
        let figures = guards::interior_figures(&d, content, cfg);
        let (mut walls, mut floors, mut thresholds, mut fixtures) = (0i64, 0i64, 0i64, 0i64);
        let mut attempts = Vec::new();
        for o in d.interiors.outcomes() {
            match o {
                InteriorOutcome::Laid {
                    interior,
                    attempts: a,
                    ..
                } => {
                    attempts.push(*a);
                    walls += interior.walls().len() as i64;
                    floors += interior
                        .rooms
                        .iter()
                        .map(|r| r.rect.width() * r.rect.height())
                        .sum::<i64>();
                    thresholds += interior.thresholds.len() as i64;
                    fixtures += interior.fixtures.len() as i64;
                }
                InteriorOutcome::Rejected { .. } => attempts.push(u32::MAX),
                InteriorOutcome::Shell { .. } => {}
            }
        }
        Record {
            seed,
            kind_spread_ok: guards::kind_spread_verdict(
                figures.placed,
                figures.kind_enterable,
                figures.laid,
                cfg,
            )
            .is_ok(),
            figures,
            failure: d.check(cfg, content).err().map(|e| format!("{e:?}")),
            placed_buildings: d.skeleton.envelopes.placed_count(),
            shells: d.interiors.shell_count(),
            rejected: d.interiors.rejected_count(),
            walls,
            floors,
            thresholds,
            fixtures,
            attempts,
        }
    });

    let cap_x100 = cfg.interior_max_room_aspect as i64 * 100;
    let mut miss: BTreeMap<&str, BandMiss> = BTreeMap::new();
    for key in [
        "generate", "attempts", "rejected", "floor", "aspect", "kinds", "low_band",
    ] {
        miss.insert(key, BandMiss::new());
    }
    let mut attempts_total: BTreeMap<u32, u64> = BTreeMap::new();
    for r in &records {
        let f = &r.figures;
        let flags = [
            ("generate", r.failure.is_some()),
            (
                "attempts",
                f.max_attempts > cfg.interior_max_layout_attempts,
            ),
            (
                "rejected",
                f.rejected_percent > cfg.interior_max_rejected_percent,
            ),
            ("floor", f.enterable < cfg.interior_min_enterable_count),
            ("aspect", f.max_room_aspect_x100 > cap_x100),
            ("kinds", !r.kind_spread_ok),
            ("low_band", !f.low_band_dwelling),
        ];
        for (key, bad) in flags {
            if bad {
                miss.get_mut(key).unwrap().record(r.seed);
            }
        }
        for a in &r.attempts {
            *attempts_total.entry(*a).or_insert(0) += 1;
        }
    }

    let col = |f: fn(&Record) -> i64| Stats::new(records.iter().map(f).collect());
    col(|r| r.figures.enterable).print("enterable_count");
    col(|r| r.figures.enterable * 100 / r.placed_buildings.max(1)).print("enterable_share_percent");
    col(|r| r.shells).print("shell_count");
    col(|r| r.rejected).print("rejected_count");
    col(|r| r.figures.rejected_percent).print("rejected_percent_of_attempted");
    col(|r| i64::from(r.figures.max_attempts)).print("max_layout_attempts_used");
    col(|r| r.figures.max_room_aspect_x100).print("max_room_aspect_x100");
    for (k, name) in ["dwelling", "shop", "cafe", "back_room"].iter().enumerate() {
        let pct: Vec<i64> = records
            .iter()
            .map(|r| r.figures.kind_enterable[k] * 100 / r.figures.placed[k].max(1))
            .collect();
        Stats::new(pct).print(&format!("{name}_enterable_percent_of_placed"));
        let share: Vec<i64> = records
            .iter()
            .map(|r| r.figures.kind_enterable[k] * 100 / r.figures.laid.max(1))
            .collect();
        Stats::new(share).print(&format!("{name}_percent_of_enterable_set"));
    }
    col(|r| r.walls).print("wall_cells_per_city");
    col(|r| r.floors).print("floor_cells_per_city");
    col(|r| r.thresholds).print("threshold_cells_per_city");
    col(|r| r.fixtures).print("fixture_cells_per_city");
    println!("layout attempts needed (u32::MAX = rejected): {attempts_total:?}");
    let mut failures: BTreeMap<String, u64> = BTreeMap::new();
    for f in records.iter().filter_map(|r| r.failure.as_ref()) {
        let kind = f.split([' ', '{', '(']).next().unwrap_or("").to_string();
        *failures.entry(kind).or_insert(0) += 1;
    }
    println!("check-chain failures by verdict: {failures:?}");
    for r in records.iter().filter(|r| r.failure.is_some()).take(3) {
        println!("  seed {}: {}", r.seed, r.failure.as_ref().unwrap());
    }

    report(
        "generate succeeds (check chain)",
        &miss["generate"],
        n,
        cases,
    );
    report(
        &format!(
            "layout attempts at most max_layout_attempts = {}",
            cfg.interior_max_layout_attempts
        ),
        &miss["attempts"],
        n,
        cases,
    );
    report(
        &format!(
            "rejected share at most max_rejected_percent = {}%",
            cfg.interior_max_rejected_percent
        ),
        &miss["rejected"],
        n,
        cases,
    );
    report(
        &format!(
            "enterable count at least min_enterable_count = {}",
            cfg.interior_min_enterable_count
        ),
        &miss["floor"],
        n,
        cases,
    );
    report(
        &format!(
            "no room past max_room_aspect = {}:1",
            cfg.interior_max_room_aspect
        ),
        &miss["aspect"],
        n,
        cases,
    );
    report(
        &format!(
            "required kinds spread (min enterable percent per kind {:?}, max_kind_share_percent = {}%)",
            cfg.interior_kind_min_enterable_percent, cfg.interior_max_kind_share_percent
        ),
        &miss["kinds"],
        n,
        cases,
    );
    report(
        "an enterable dwelling in the lowest density band",
        &miss["low_band"],
        n,
        cases,
    );

    // The pooled band is a statistic over one CI run's pool, not over one
    // city: judge consecutive pools of the CI run's own size.
    let lo = (cfg.interior_enterable_target_percent
        - cfg.interior_enterable_target_tolerance_percent)
        * 1000;
    let hi = (cfg.interior_enterable_target_percent
        + cfg.interior_enterable_target_tolerance_percent)
        * 1000;
    let mut pools = 0u64;
    let mut outside = BandMiss::new();
    for (k, pool) in records.chunks(CITY_POOL_SIZE as usize).enumerate() {
        if pool.len() < CITY_POOL_SIZE as usize {
            break;
        }
        pools += 1;
        let enterable: i64 = pool.iter().map(|r| r.figures.laid).sum();
        let placed: i64 = pool.iter().map(|r| r.placed_buildings).sum();
        let share_x1000 = enterable * 100_000 / placed.max(1);
        if share_x1000 < lo || share_x1000 > hi {
            // The pool's first seed names it.
            outside.record(pool[0].seed);
            let _ = k;
        }
    }
    report(
        &format!(
            "pooled enterable share within enterable_target_percent = {}% +- {}% ({CITY_POOL_SIZE}-city pools)",
            cfg.interior_enterable_target_percent, cfg.interior_enterable_target_tolerance_percent
        ),
        &outside,
        pools,
        1,
    );
}
