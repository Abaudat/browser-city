use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generation::{GenerationConfig, GenerationContent};
use sim::routing::graph::NodeKind;

/// Cities measured at the committed site and at the 1024 growth target.
const SEEDS_AT_COMMITTED_SITE: u64 = 32;
const SEEDS_AT_GROWTH_TARGET: u64 = 4;

struct Counts {
    nodes: u64,
    edges: u64,
    internal: u64,
    sources: u64,
}

fn measure(cfg: &GenerationConfig, content: &GenerationContent, n: u64) -> Vec<Counts> {
    par_map_in_seed_order(n, threads(), |seed| {
        let (_, g) = sim::generation::generate(seed, cfg, content)
            .expect("the committed config generates every measured seed");
        let count = |k: NodeKind| g.nodes().iter().filter(|n| n.kind == k).count() as u64;
        Counts {
            nodes: g.nodes().len() as u64,
            edges: g.edges().len() as u64,
            internal: count(NodeKind::Internal),
            sources: count(NodeKind::Source),
        }
    })
}

fn report(label: &str, side: i32, counts: &[Counts]) {
    let range = |f: fn(&Counts) -> u64| {
        let v: Vec<u64> = counts.iter().map(f).collect();
        let sum: u64 = v.iter().sum();
        (
            *v.iter().min().unwrap(),
            sum / v.len() as u64,
            *v.iter().max().unwrap(),
        )
    };
    let (nmin, nmean, nmax) = range(|c| c.nodes);
    let (emin, emean, emax) = range(|c| c.edges);
    let internal: u64 = counts.iter().map(|c| c.internal).sum();
    let sources: u64 = counts.iter().map(|c| c.sources).sum();
    println!(
        "{label} ({side} x {side}, {} seeds): nodes min {nmin} mean {nmean} max {nmax}; edges min {emin} mean {emean} max {emax}; internal nodes {}% of entrances",
        counts.len(),
        internal * 100 / sources.max(1)
    );
}

/// The macro routing graph's node and edge counts: fixed seeds, so no miss
/// rate.
pub fn graph_sweep(cfg: &GenerationConfig, content: &GenerationContent) {
    println!(
        "{}: seeds 0..{SEEDS_AT_COMMITTED_SITE} at the committed site, 0..{SEEDS_AT_GROWTH_TARGET} at 1024",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::MACRO_GRAPH)
    );
    report(
        "committed site",
        cfg.site_extent_cells,
        &measure(cfg, content, SEEDS_AT_COMMITTED_SITE),
    );
    let mut big = *cfg;
    big.site_extent_cells = 1024;
    report(
        "growth target",
        big.site_extent_cells,
        &measure(&big, content, SEEDS_AT_GROWTH_TARGET),
    );
}
