use sim::generation::{GenerationConfig, LandUse, land_use, streets};
use sim::rng::seed_from_ids;

/// Regions-lost sweep's own default seed count and salt.
pub const REGION_SEED_COUNT_DEFAULT: u64 = 100_000;
pub const MEASURE_REGION_SEED_SALT: u64 = 0xB0F0_5EE5;

/// Passes 1-2 only: how many seeds have a pass-1 region whose land use no
/// block carries (`StreetNetwork::regions_carried_by_no_block`), and how
/// many lose every institutional region -- what `streets::SWALLOW_MIN_
/// REGION_SHARE_DENOM` keeps small. Prints the counts and the first
/// offending seeds so a retune re-measures this rather than rediscovers it.
pub fn region_loss_sweep(cfg: &GenerationConfig, n: u64) {
    println!(
        "
{}: {n} seeds, passes 1-2 only (salt {MEASURE_REGION_SEED_SALT:#x})",
        bounds::generation_stamp::stamp(&bounds::generation_stamp::REGION_LOSS_SWEEP)
    );
    let (mut any_lost, mut all_inst_lost) = (0u64, 0u64);
    let mut first_any: Option<u64> = None;
    let mut offending: Vec<u64> = Vec::new();
    for i in 0..n {
        let seed = seed_from_ids(MEASURE_REGION_SEED_SALT, i);
        let lu = land_use::run(seed, cfg.site(), cfg).expect("committed config generates");
        let net = streets::run(seed, &lu, cfg);
        let lost = net.regions_carried_by_no_block(&lu);
        if !lost.is_empty() {
            any_lost += 1;
            first_any.get_or_insert(seed);
        }
        let institutional = lu
            .regions()
            .iter()
            .filter(|r| r.use_ == LandUse::Institutional)
            .count();
        let inst_lost = lost
            .iter()
            .filter(|r| r.use_ == LandUse::Institutional)
            .count();
        if institutional > 0 && inst_lost == institutional {
            all_inst_lost += 1;
            if offending.len() < 10 {
                offending.push(seed);
            }
        }
    }
    println!(
        "  seeds with any region carried by no block: {any_lost} of {n} (first: {first_any:?}) -- by design, a block takes its majority use"
    );
    println!(
        "  seeds losing every institutional region: {all_inst_lost} of {n} (rate {:.6}%), offending seeds: {offending:?}",
        all_inst_lost as f64 * 100.0 / n as f64
    );
}
