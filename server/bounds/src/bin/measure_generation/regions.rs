use bounds::sweep::{par_map_in_seed_order, threads};
use sim::generation::{GenerationConfig, LandUse, land_use, streets};
use sim::rng::seed_from_ids;

use crate::common::*;

/// Regions-lost sweep's own default seed count and salt.
pub const REGION_SEED_COUNT_DEFAULT: u64 = 1_000_000;
pub const MEASURE_REGION_SEED_SALT: u64 = 0xB0F0_5EE5;

/// Passes 1-2 only: how many seeds have a pass-1 region whose land use no
/// block carries (`StreetNetwork::regions_carried_by_no_block`, by design),
/// and how many lose every institutional region -- the any-seed property
/// `inv_generation_an_institutional_region_is_carried_by_a_block` asserts.
pub fn region_loss_sweep(cfg: &GenerationConfig, n: u64) {
    println!(
        "\n{}: {n} seeds, passes 1-2 only (salt {MEASURE_REGION_SEED_SALT:#x})",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::REGION_LOSS_SWEEP)
    );
    // (seed, any region lost, every institutional region lost)
    let records = par_map_in_seed_order(n, threads(), |i| {
        let seed = seed_from_ids(MEASURE_REGION_SEED_SALT, i);
        let lu = land_use::run(seed, cfg.site(), cfg).expect("committed config generates");
        let net = streets::run(seed, &lu, cfg);
        let lost = net.regions_carried_by_no_block(&lu);
        let institutional = lu
            .regions()
            .iter()
            .filter(|r| r.use_ == LandUse::Institutional)
            .count();
        let inst_lost = lost
            .iter()
            .filter(|r| r.use_ == LandUse::Institutional)
            .count();
        (
            seed,
            !lost.is_empty(),
            institutional > 0 && inst_lost == institutional,
        )
    });
    let mut any_lost = 0u64;
    let mut first_any: Option<u64> = None;
    let mut all_inst_lost = BandMiss::new();
    for (seed, any, all_inst) in records {
        if any {
            any_lost += 1;
            first_any.get_or_insert(seed);
        }
        if all_inst {
            all_inst_lost.record(seed);
        }
    }
    println!(
        "  seeds with any region carried by no block: {any_lost} of {n} (first: {first_any:?}) -- by design, a block takes its majority use"
    );
    print_ceiling_report(
        "every institutional region carried by no block (inv_generation_an_institutional_region_is_carried_by_a_block)",
        &all_inst_lost,
        n,
    );
}
