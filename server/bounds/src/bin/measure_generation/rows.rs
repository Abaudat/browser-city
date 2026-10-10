use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generation::{GenerationConfig, GenerationContent};
use sim::rng::seed_from_ids;

use crate::common::*;

/// The rows sweep's own default seed count when no `rows <n>` argument is
/// given.
pub const ROWS_SEED_COUNT_DEFAULT: u64 = 1_000_000;
/// The rows sweep's own salt -- distinct from every other sweep's.
pub const MEASURE_ROWS_SEED_SALT: u64 = 0xB0F0_5EE6;

/// What one seed says about the committed `[[distribution]]` rows.
struct Record {
    seed: u64,
    failing: Option<String>,
    /// Per row: subjects placed, and whether the row owes a subject
    /// somewhere yet placed none.
    placed: Vec<(u64, bool)>,
}

/// The `[[distribution]]` rows over `n` seeds: the seeds `check_rules`
/// rejects (the property `inv_generation_committed_rules_hold_for_any_seed`
/// holds over the shared city pool; this is the same verdict over `n`
/// fresh seeds) and, per row, the pooled mean placed count.
pub fn rows_sweep(cfg: &GenerationConfig, content: &GenerationContent, n: u64) {
    use sim::rules::RuleSite;
    let rows: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    let records = par_map_in_seed_order(n, threads(), |i| {
        let seed = seed_from_ids(MEASURE_ROWS_SEED_SALT, i);
        // Subjects and their dials are passes 1-5's and pass 6 adds no
        // building tag, so every building stands as a shell here: the
        // rows are judged exactly as `check_rules` judges them, without
        // laying out every interior of a million cities.
        let skeleton = sim::generation::plan_skeleton(seed, cfg, content)
            .expect("the committed config plans every seed");
        let shells = skeleton
            .building_types
            .assignments()
            .iter()
            .map(|a| sim::generation::InteriorOutcome::Shell {
                plot: a.plot,
                building_type: a.building_type,
            })
            .collect();
        let d = sim::generation::District {
            skeleton,
            interiors: sim::generation::InteriorMap::test_fixture(shells),
        };
        let site = d.site(content);
        let failing = d.check_rules(content).err().map(|e| e.to_string());
        let placed = rows
            .iter()
            .map(|row| {
                let n_placed = site.subjects_in_area(None, row.subject).len() as u64;
                // Whether the row owes a subject somewhere (the
                // evaluator's own `targets`).
                let read = match row.ratio {
                    sim::rules::RowRatio::Read(r) => Some(r.parameter),
                    sim::rules::RowRatio::Fixed(_) => None,
                };
                let owed = row
                    .targets(
                        site.subjects_in_area(None, row.per)
                            .iter()
                            .map(|&c| (c, read.and_then(|p| site.parameter_at(c, p)))),
                    )
                    .values()
                    .any(|t| t.expected >= 1);
                (n_placed, owed && n_placed == 0)
            })
            .collect();
        Record {
            seed,
            failing,
            placed,
        }
    });
    println!(
        "\n{}: {n} seeds, {} threads",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::ROWS_SWEEP),
        threads()
    );
    let mut failing = BandMiss::new();
    let mut reasons: Vec<(u64, String)> = Vec::new();
    // Per row: pooled placed, fewest placed in one district, districts
    // where the row owes a subject somewhere yet placed none.
    let mut totals = vec![(0u64, u64::MAX, 0u64); rows.len()];
    for r in &records {
        if let Some(why) = &r.failing {
            failing.record(r.seed);
            if reasons.len() < 10 {
                reasons.push((r.seed, why.clone()));
            }
        }
        for (k, (n_placed, owed_none)) in r.placed.iter().enumerate() {
            totals[k].0 += n_placed;
            totals[k].1 = totals[k].1.min(*n_placed);
            totals[k].2 += u64::from(*owed_none);
        }
    }
    print_ceiling_report(
        "committed rules hold (inv_generation_committed_rules_hold_for_any_seed)",
        &failing,
        n,
    );
    for (seed, why) in &reasons {
        println!("    {seed}: {why}");
    }
    for (k, row) in rows.iter().enumerate() {
        let (total, fewest, owed_none) = totals[k];
        println!(
            "  {}: pooled mean placed {}.{:02}, fewest in one district {fewest}, owed somewhere but none placed in {owed_none} districts",
            content.rules.key_of(row.id).unwrap_or("?"),
            total / n,
            total * 100 / n % 100
        );
    }
}
