use std::collections::BTreeMap;

use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generation::{GenerationConfig, GenerationContent, InteriorOutcome};

use crate::common::*;

/// Seeds `0..INTERIOR_SEED_COUNT`: pass 6 lays out every building of every
/// city, so this sweep is over a smaller range than the passes above.
pub const INTERIOR_SEED_COUNT: u64 = 500;

/// What one city's interiors say.
struct Record {
    enterable: i64,
    shells: i64,
    rejected: i64,
    enterable_share: i64,
    rejected_percent: i64,
    walls: i64,
    floors: i64,
    thresholds: i64,
    fixtures: i64,
    attempts: Vec<u32>,
}

/// Story 3.5's interiors over seeds `0..INTERIOR_SEED_COUNT`: the enterable
/// count and share, shells, rejections and layout attempts, and the future
/// row count of the rasterised district (wall, floor, threshold and fixture
/// cells per seed). Deterministic -- no miss rate.
pub fn interiors_sweep(cfg: &GenerationConfig, content: &GenerationContent) {
    println!(
        "{}: seeds 0..{INTERIOR_SEED_COUNT}",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::INTERIORS_SWEEP)
    );
    let records = par_map_in_seed_order(INTERIOR_SEED_COUNT, threads(), |seed| {
        let d = sim::generation::plan(seed, cfg, content).expect("pass 1 is total");
        let io = &d.interiors;
        let placed = d.skeleton.envelopes.placed_count().max(1);
        let (mut walls, mut floors, mut thresholds, mut fixtures) = (0i64, 0i64, 0i64, 0i64);
        let mut attempts = Vec::new();
        let (mut laid, mut rejected) = (0i64, 0i64);
        for o in io.outcomes() {
            match o {
                InteriorOutcome::Laid {
                    interior,
                    attempts: n,
                    ..
                } => {
                    laid += 1;
                    attempts.push(*n);
                    walls += interior.walls().len() as i64;
                    floors += interior
                        .rooms
                        .iter()
                        .map(|r| r.rect.width() * r.rect.height())
                        .sum::<i64>();
                    thresholds += interior.thresholds.len() as i64;
                    fixtures += interior.fixtures.len() as i64;
                }
                InteriorOutcome::Rejected { .. } => {
                    rejected += 1;
                    attempts.push(u32::MAX);
                }
                InteriorOutcome::Shell { .. } => {}
            }
        }
        Record {
            enterable: io.enterable_count(),
            shells: io.shell_count(),
            rejected: io.rejected_count(),
            enterable_share: io.enterable_count() * 100 / placed,
            rejected_percent: rejected * 100 / (laid + rejected).max(1),
            walls,
            floors,
            thresholds,
            fixtures,
            attempts,
        }
    });
    let mut attempts_total: BTreeMap<u32, u64> = BTreeMap::new();
    for r in &records {
        for a in &r.attempts {
            *attempts_total.entry(*a).or_insert(0) += 1;
        }
    }
    let col = |f: fn(&Record) -> i64| Stats::new(records.iter().map(f).collect());
    col(|r| r.enterable).print("enterable_count");
    col(|r| r.enterable_share).print("enterable_share_percent");
    col(|r| r.shells).print("shell_count");
    col(|r| r.rejected).print("rejected_count");
    col(|r| r.rejected_percent).print("rejected_percent_of_attempted");
    col(|r| r.walls).print("wall_cells_per_city");
    col(|r| r.floors).print("floor_cells_per_city");
    col(|r| r.thresholds).print("threshold_cells_per_city");
    col(|r| r.fixtures).print("fixture_cells_per_city");
    println!("layout attempts needed (u32::MAX = rejected): {attempts_total:?}");
}
