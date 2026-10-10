use sim::generation::{GenerationConfig, GenerationContent};
use sim::rng::seed_from_ids;

/// The rows sweep's own default seed count when no `rows <n>` argument is
/// given.
pub const ROWS_SEED_COUNT_DEFAULT: u64 = 20_000;
/// A sixth, distinct salt for the rows sweep -- see
/// [`MEASURE_DETOUR_SEED_SALT`].
pub const MEASURE_ROWS_SEED_SALT: u64 = 0xB0F0_5EE5;

/// Story 3.7: the retune loop for the committed `[[distribution]]` rows
/// (`cargo run -p bounds --release --bin measure-generation -- rows 1000000`
/// runs only it). Per seed it runs `plan` and evaluates the committed rules
/// over the finished district (`District::check_rules`' own verdict, never a
/// second judgement): the seeds that fail -- a catchment whose land cannot
/// hold what a scoped row owes outside its tolerance -- and, per row, the
/// pooled mean placed count the row's comment quotes. Parallel across
/// threads; every seed is derived from its own index, so the result never
/// depends on thread scheduling.
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
    let threads = std::thread::available_parallelism().map_or(4, |t| t.get()) as u64;
    // Per row: pooled placed, fewest placed in one district, and districts
    // where the row owes a subject somewhere yet placed none.
    type Partial = (Vec<(u64, String)>, Vec<(u64, u64, u64)>);
    let partials: Vec<Partial> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let rows = &rows;
                scope.spawn(move || {
                    let mut failing: Vec<(u64, String)> = Vec::new();
                    let mut placed = vec![(0u64, u64::MAX, 0u64); rows.len()];
                    let mut i = t;
                    while i < n {
                        let seed = seed_from_ids(MEASURE_ROWS_SEED_SALT, i);
                        let d = sim::generation::plan(seed, cfg, content)
                            .expect("the committed config plans every seed");
                        let site = d.site(content);
                        if let Err(e) = d.check_rules(content) {
                            failing.push((seed, e.to_string()));
                        }
                        for (k, row) in rows.iter().enumerate() {
                            let n_placed = site.subjects_in_area(None, row.subject).len() as u64;
                            placed[k].0 += n_placed;
                            placed[k].1 = placed[k].1.min(n_placed);
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
                            if owed && n_placed == 0 {
                                placed[k].2 += 1;
                            }
                        }
                        i += threads;
                    }
                    (failing, placed)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("a sweep thread panicked"))
            .collect()
    });
    let mut failing: Vec<(u64, String)> = partials.iter().flat_map(|p| p.0.clone()).collect();
    failing.sort();
    println!(
        "
{}: {n} seeds, {threads} threads",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::ROWS_SWEEP)
    );
    println!("  seeds failing check_rules: {}", failing.len());
    for (seed, why) in failing.iter().take(10) {
        println!("    {seed}: {why}");
    }
    for (k, row) in rows.iter().enumerate() {
        let total: u64 = partials.iter().map(|p| p.1[k].0).sum();
        let fewest = partials.iter().map(|p| p.1[k].1).min().unwrap_or(0);
        let owed_none: u64 = partials.iter().map(|p| p.1[k].2).sum();
        println!(
            "  {}: pooled mean placed {}.{:02}, fewest in one district {fewest}, owed somewhere but none placed in {owed_none} districts",
            content.rules.key_of(row.id).unwrap_or("?"),
            total / n,
            total * 100 / n % 100
        );
    }
}
