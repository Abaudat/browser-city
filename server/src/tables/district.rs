//! The record of a generated district: one row per district ever generated,
//! carrying its seed, its world-absolute site and every version its output
//! depends on. Read back as stored, never re-stamped. Private; nothing
//! reads it client-side.
//!
//! `create_district` is the only path to the generator
//! (`sim::generation::create` decides, this reducer only reads the rows and
//! inserts the record). `scripts/ci/check-district-write-path.sh` fails any
//! other file under `server/src/` that names `generation::` or the
//! `district` accessor outside the places listed there.

use sim::generated::defs;
use sim::generation::{
    DistrictRecord, GenerationConfig, GenerationContent, RuleSetVersion, SiteBounds, create,
};
use sim::reducer_classes::ReducerClass;
use spacetimedb::{ReducerContext, Table, Timestamp};

use super::metrics::count_call;
use super::ops::require_owner;

#[derive(Clone)]
#[spacetimedb::table(accessor = district)]
pub struct District {
    // bc:wide-table: one permanent record row -- site rect plus the three version fields
    #[primary_key]
    #[auto_inc]
    pub district_id: u64,
    pub seed: u64,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub generation_version: u32,
    pub rng_version: u32,
    pub defs_version: String,
    pub generated_at: Timestamp,
}

/// Generates the district for `seed` over the configured site and records
/// it, once: a site that already has a record is refused, whatever the
/// recorded versions.
#[spacetimedb::reducer]
pub fn create_district(ctx: &ReducerContext, seed: u64) -> Result<(), String> {
    count_call(ctx, ReducerClass::Operator);
    require_owner(ctx)?;
    let existing: Vec<DistrictRecord> = ctx
        .db
        .district()
        .iter()
        .map(|r| DistrictRecord {
            seed: r.seed,
            site: SiteBounds {
                x0: r.x0,
                y0: r.y0,
                x1: r.x1,
                y1: r.y1,
            },
            version: RuleSetVersion {
                generation: r.generation_version,
                rng: r.rng_version,
                defs: r.defs_version,
            },
        })
        .collect();
    let cfg = GenerationConfig::from_balance(defs::BALANCE).map_err(|e| e.to_string())?;
    let (record, _district) = create(&existing, seed, &cfg, &GenerationContent::committed())
        .map_err(|e| e.to_string())?;
    ctx.db.district().insert(District {
        district_id: 0,
        seed: record.seed,
        x0: record.site.x0,
        y0: record.site.y0,
        x1: record.site.x1,
        y1: record.site.y1,
        generation_version: record.version.generation,
        rng_version: record.version.rng,
        defs_version: record.version.defs,
        generated_at: ctx.timestamp,
    });
    Ok(())
}
