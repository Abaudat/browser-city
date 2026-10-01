//! The generate-once gate: what a persisted district record carries, and
//! the one pure decision that stands between a seed and the generator.
//! Pure functions and data only (NFR28) -- the reducer that calls
//! [`create`] reads the recorded rows and inserts the returned record, and
//! decides nothing itself.

use super::{
    District, GENERATION_VERSION, GenerationConfig, GenerationContent, GenerationError, SiteBounds,
    generate,
};
use crate::generated::defs::DEFS_VERSION;
use crate::rng::RNG_VERSION;

/// Every version a generated district's output depends on. Three typed
/// fields, never folded into one string or hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleSetVersion {
    pub generation: u32,
    pub rng: u32,
    pub defs: &'static str,
}

impl RuleSetVersion {
    /// This build's own versions -- the only non-test constructor.
    pub fn current() -> Self {
        RuleSetVersion {
            generation: GENERATION_VERSION,
            rng: RNG_VERSION,
            defs: DEFS_VERSION,
        }
    }
}

/// What persists about one generated district: its seed, its world-absolute
/// site, and the versions it was generated under. Read back as stored,
/// never re-stamped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DistrictRecord {
    pub seed: u64,
    pub site: SiteBounds,
    pub generation_version: u32,
    pub rng_version: u32,
    pub defs_version: String,
}

fn overlaps(a: SiteBounds, b: SiteBounds) -> bool {
    (a.x0 as i64) < b.x1 as i64
        && (b.x0 as i64) < a.x1 as i64
        && (a.y0 as i64) < b.y1 as i64
        && (b.y0 as i64) < a.y1 as i64
}

/// The one gate to the generator: refuses with
/// [`GenerationError::SiteAlreadyGenerated`] when `cfg.site()` overlaps any
/// recorded site -- whatever versions that record carries -- otherwise runs
/// [`generate`] and stamps [`RuleSetVersion::current`]. A record exists
/// only for a seed whose generation succeeded.
pub fn create(
    existing: &[DistrictRecord],
    seed: u64,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> Result<(DistrictRecord, District), GenerationError> {
    let site = cfg.site();
    if existing.iter().any(|r| overlaps(r.site, site)) {
        return Err(GenerationError::SiteAlreadyGenerated { site });
    }
    let district = generate(seed, cfg, content)?;
    let v = RuleSetVersion::current();
    let record = DistrictRecord {
        seed,
        site,
        generation_version: v.generation,
        rng_version: v.rng,
        defs_version: v.defs.to_string(),
    };
    Ok((record, district))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    #[test]
    fn current_names_the_three_compiled_in_versions() {
        let v = RuleSetVersion::current();
        assert_eq!(v.generation, GENERATION_VERSION);
        assert_eq!(v.rng, RNG_VERSION);
        assert_eq!(v.defs, DEFS_VERSION);
    }

    #[test]
    fn create_with_no_record_stamps_the_current_versions_and_site() {
        let cfg = cfg();
        let (rec, _) = create(&[], 7, &cfg, &GenerationContent::committed()).unwrap();
        assert_eq!(rec.seed, 7);
        assert_eq!(rec.site, cfg.site());
        assert_eq!(rec.generation_version, GENERATION_VERSION);
        assert_eq!(rec.rng_version, RNG_VERSION);
        assert_eq!(rec.defs_version, DEFS_VERSION);
    }

    #[test]
    fn create_refuses_over_a_recorded_site_whatever_its_versions() {
        let cfg = cfg();
        for (g, r, d) in [
            (GENERATION_VERSION, RNG_VERSION, DEFS_VERSION),
            (GENERATION_VERSION + 1, RNG_VERSION, DEFS_VERSION),
            (0, 0, "older"),
        ] {
            let existing = [DistrictRecord {
                seed: 1,
                site: cfg.site(),
                generation_version: g,
                rng_version: r,
                defs_version: d.to_string(),
            }];
            assert_eq!(
                create(&existing, 2, &cfg, &GenerationContent::committed()).unwrap_err(),
                GenerationError::SiteAlreadyGenerated { site: cfg.site() }
            );
        }
    }

    #[test]
    fn a_disjoint_recorded_site_does_not_block() {
        let cfg = cfg();
        let s = cfg.site();
        let far = SiteBounds {
            x0: s.x1,
            y0: s.y0,
            x1: s.x1 + 10,
            y1: s.y1,
        };
        let existing = [DistrictRecord {
            seed: 1,
            site: far,
            generation_version: 1,
            rng_version: 1,
            defs_version: "x".into(),
        }];
        assert!(create(&existing, 2, &cfg, &GenerationContent::committed()).is_ok());
    }
}
