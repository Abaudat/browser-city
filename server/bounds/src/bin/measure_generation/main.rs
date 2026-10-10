//! Re-measures the generator's statistically-derived ceilings at the
//! committed `defs::BALANCE`, one stamped block per subcommand (the
//! registry is `bounds::generation_stamp::MEASURED_BLOCKS`; every figure
//! lives in `docs/generation.md`, pasted verbatim). A binary, not a test:
//! too slow for every CI run.
//!
//! ```text
//! cargo run -p bounds --release --bin measure-generation [-- <subcommand> [n]]
//! ```
//!
//! - *(none)*: `exhaustive loop` -- envelope, detour-excess, building-type
//!   and missing-tag statistics over 50,000 / 5,000 mixed seeds.
//! - `detour <n>`: `detour-bounds sweep` -- the detour max()-contract, the
//!   p99 fill and the per-city periphery floor over `n` seeds, passes 1-2.
//! - `bands <n>`: `band sweep` -- the land-use share, building-count and
//!   workplace-count bands over `n` seeds, all five passes.
//! - `rows <n>`: `rows sweep` -- the `[[distribution]]` rows over `n` seeds.
//! - `regions <n>`: `region-loss sweep` -- regions carried by no block.
//! - `pooled`: `pooled evidence` -- seeds 0..256 pooled ratio and chopped
//!   share, and the evidence seeds' own ratios.
//! - `p99 <seed>`: traces one seed's p99 detour fill (no stamped block).
//!
//! Every seed is drawn through `sim::rng::seed_from_ids` with a salt of the
//! sweep's own and the loop index, spread over the full `u64` space, and
//! threaded sweeps reduce in seed-index order: a block is byte-identical
//! for a given version and fingerprint, bar thread count and wall-clock.

mod bands;
mod common;
mod detour;
mod exhaustive;
mod interiors;
mod pooled;
mod regions;
mod rows;
mod trace;

use bounds::generation_stamp::{
    BAND_SWEEP, DETOUR_SWEEP, EXHAUSTIVE_LOOP, INTERIORS_SWEEP, MeasuredBlock, POOLED_EVIDENCE,
    REGION_LOSS_SWEEP, ROWS_SWEEP,
};
use common::*;
use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent};

/// The sweeps a registered block's subcommand reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sweep {
    Exhaustive,
    Detour,
    Bands,
    Rows,
    Regions,
    Pooled,
    Interiors,
}

/// Each registered block and the sweep that prints it: the one table
/// `main` dispatches through.
const SWEEPS: [(&MeasuredBlock, Sweep); 7] = [
    (&EXHAUSTIVE_LOOP, Sweep::Exhaustive),
    (&DETOUR_SWEEP, Sweep::Detour),
    (&BAND_SWEEP, Sweep::Bands),
    (&ROWS_SWEEP, Sweep::Rows),
    (&REGION_LOSS_SWEEP, Sweep::Regions),
    (&POOLED_EVIDENCE, Sweep::Pooled),
    (&INTERIORS_SWEEP, Sweep::Interiors),
];

fn sweep_for(subcommand: &str) -> Option<Sweep> {
    SWEEPS
        .iter()
        .find(|(block, _)| block.subcommand == subcommand)
        .map(|(_, sweep)| *sweep)
}

fn main() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).expect("committed balance is valid");
    let content = GenerationContent::committed();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let count = |default: u64| -> u64 {
        args.get(1)
            .map(|s| {
                s.parse()
                    .unwrap_or_else(|e| panic!("{} count {s:?}: {e}", args[0]))
            })
            .unwrap_or(default)
    };
    let first = args.first().map(String::as_str).unwrap_or("");
    if first == "p99" {
        let seed = args
            .get(1)
            .map(|s| s.parse().unwrap_or_else(|e| panic!("p99 seed {s:?}: {e}")))
            .expect("usage: measure-generation p99 <seed>");
        return trace::p99_trace(&cfg, seed);
    }
    // A bare number is the exhaustive loop's missing-tag seed count.
    let sweep = sweep_for(first).unwrap_or(Sweep::Exhaustive);
    match sweep {
        Sweep::Detour => detour::detour_sweep(&cfg, count(DETOUR_SEED_COUNT_DEFAULT)),
        Sweep::Bands => bands::band_sweep(&cfg, &content, count(BAND_SEED_COUNT_DEFAULT)),
        Sweep::Rows => rows::rows_sweep(&cfg, &content, count(rows::ROWS_SEED_COUNT_DEFAULT)),
        Sweep::Pooled => pooled::pooled_sweep(&cfg),
        Sweep::Interiors => interiors::interiors_sweep(&cfg, &content),
        Sweep::Regions => {
            regions::region_loss_sweep(&cfg, count(regions::REGION_SEED_COUNT_DEFAULT))
        }
        Sweep::Exhaustive => exhaustive::run(&cfg, &content),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bounds::generation_stamp::MEASURED_BLOCKS;

    #[test]
    fn every_registered_subcommand_reaches_its_sweep() {
        for block in MEASURED_BLOCKS {
            let reached = sweep_for(block.subcommand)
                .unwrap_or_else(|| panic!("`{}` is not dispatched", block.label));
            let (listed, sweep) = SWEEPS
                .iter()
                .find(|(b, _)| b.label == block.label)
                .unwrap_or_else(|| panic!("`{}` has no sweep", block.label));
            assert_eq!(listed.subcommand, block.subcommand);
            assert_eq!(reached, *sweep, "{}", block.label);
        }
        assert_eq!(SWEEPS.len(), MEASURED_BLOCKS.len());
    }

    #[test]
    fn the_default_run_is_the_empty_subcommand() {
        assert_eq!(sweep_for(""), Some(Sweep::Exhaustive));
        assert_eq!(sweep_for("no-such-sweep"), None);
    }
}
