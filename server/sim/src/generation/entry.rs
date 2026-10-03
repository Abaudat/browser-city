//! The two functions that chain the generator's passes. Private to this
//! module and re-exported by `mod.rs` only with `test-fixtures`
//! (`pub(crate)` otherwise): production reaches the generator through
//! `create` alone.

use super::{
    District, GenerationConfig, GenerationContent, GenerationError, building_types, envelopes,
    land_use, plots, streets,
};

/// Chains every implemented pass, in FR110's own order, with no verdict
/// on the result -- only pass 1's own site check can fail. What a
/// harness that must inspect every pass of an outlier city calls.
pub fn plan(
    city_seed: u64,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> Result<District, GenerationError> {
    let land_use = land_use::run(city_seed, cfg.site(), cfg)?;
    let streets = streets::run(city_seed, &land_use, cfg);
    let plots = plots::run(city_seed, &land_use, &streets, cfg);
    let envelopes = envelopes::run(city_seed, &plots, cfg);
    let building_types = building_types::run(city_seed, &envelopes, &plots, &streets, cfg, content);
    Ok(District {
        land_use,
        streets,
        plots,
        envelopes,
        building_types,
    })
}

/// The one entry point production calls: [`plan`], then
/// [`District::check_building_count`], [`District::check_rules`] and
/// [`District::check_workplace_count`] -- a seed whose district fails any
/// of the three is a world that fails to create.
pub fn generate(
    city_seed: u64,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> Result<District, GenerationError> {
    let district = plan(city_seed, cfg, content)?;
    district.check_building_count(cfg)?;
    district.check_rules(content)?;
    district.check_workplace_count(cfg, content)?;
    Ok(district)
}
