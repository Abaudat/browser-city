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
mod pooled;
mod regions;
mod rows;
mod trace;

use common::*;
use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent};

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
    match args.first().map(String::as_str) {
        Some("detour") => detour::detour_sweep(&cfg, count(DETOUR_SEED_COUNT_DEFAULT)),
        Some("bands") => bands::band_sweep(&cfg, &content, count(BAND_SEED_COUNT_DEFAULT)),
        Some("rows") => rows::rows_sweep(&cfg, &content, count(rows::ROWS_SEED_COUNT_DEFAULT)),
        Some("pooled") => pooled::pooled_sweep(&cfg),
        Some("regions") => {
            regions::region_loss_sweep(&cfg, count(regions::REGION_SEED_COUNT_DEFAULT))
        }
        Some("p99") => {
            let seed = args
                .get(1)
                .map(|s| s.parse().unwrap_or_else(|e| panic!("p99 seed {s:?}: {e}")))
                .expect("usage: measure-generation p99 <seed>");
            trace::p99_trace(&cfg, seed)
        }
        _ => exhaustive::run(&cfg, &content),
    }
}
