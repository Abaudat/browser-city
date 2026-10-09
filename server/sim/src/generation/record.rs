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
    pub defs: String,
}

impl RuleSetVersion {
    /// This build's own versions -- the only non-test constructor.
    pub fn current() -> Self {
        RuleSetVersion {
            generation: GENERATION_VERSION,
            rng: RNG_VERSION,
            defs: DEFS_VERSION.to_string(),
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
    pub version: RuleSetVersion,
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
    if existing.iter().any(|r| r.site.overlaps(&site)) {
        return Err(GenerationError::SiteAlreadyGenerated { site });
    }
    let district = generate(seed, cfg, content)?;
    let record = DistrictRecord {
        seed,
        site,
        version: RuleSetVersion::current(),
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

    fn record(site: SiteBounds) -> DistrictRecord {
        DistrictRecord {
            seed: 1,
            site,
            version: RuleSetVersion {
                generation: 0,
                rng: 0,
                defs: "older".into(),
            },
        }
    }

    fn shifted(s: SiteBounds, dx: i32, dy: i32) -> SiteBounds {
        SiteBounds {
            x0: s.x0 + dx,
            y0: s.y0 + dy,
            x1: s.x1 + dx,
            y1: s.y1 + dy,
        }
    }

    fn allowed(existing: &[DistrictRecord], cfg: &GenerationConfig) -> bool {
        create(existing, 2, cfg, &GenerationContent::committed()).is_ok()
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
        assert_eq!(rec.version, RuleSetVersion::current());
    }

    #[test]
    fn the_returned_district_is_the_generated_one_for_the_recorded_seed() {
        let cfg = cfg();
        let content = GenerationContent::committed();
        let (rec, district) = create(&[], 7, &cfg, &content).unwrap();
        let direct = generate(7, &cfg, &content).unwrap();
        assert_eq!(rec.seed, 7);
        assert_eq!(
            district.skeleton.plots.plots(),
            direct.skeleton.plots.plots()
        );
        assert_eq!(
            district.skeleton.envelopes.outcomes(),
            direct.skeleton.envelopes.outcomes()
        );
        assert_eq!(
            district.skeleton.streets.blocks(),
            direct.skeleton.streets.blocks()
        );
    }

    #[test]
    fn a_record_over_the_site_refuses_whatever_its_versions() {
        let cfg = cfg();
        for version in [
            RuleSetVersion::current(),
            RuleSetVersion {
                generation: GENERATION_VERSION + 1,
                ..RuleSetVersion::current()
            },
            RuleSetVersion {
                generation: 0,
                rng: 0,
                defs: "older".into(),
            },
        ] {
            let existing = [DistrictRecord {
                seed: 1,
                site: cfg.site(),
                version,
            }];
            assert_eq!(
                create(&existing, 2, &cfg, &GenerationContent::committed()).unwrap_err(),
                GenerationError::SiteAlreadyGenerated { site: cfg.site() }
            );
        }
    }

    #[test]
    fn edge_and_corner_adjacent_sites_do_not_block() {
        let cfg = cfg();
        let s = cfg.site();
        let (w, h) = (s.x1 - s.x0, s.y1 - s.y0);
        for (dx, dy) in [
            (w, 0),
            (-w, 0),
            (0, h),
            (0, -h),
            (w, h),
            (w, -h),
            (-w, h),
            (-w, -h),
        ] {
            assert!(
                allowed(&[record(shifted(s, dx, dy))], &cfg),
                "shift ({dx}, {dy}) only touches the site and must not block"
            );
        }
    }

    #[test]
    fn a_one_cell_overlap_at_each_corner_and_containment_block() {
        let cfg = cfg();
        let s = cfg.site();
        let (w, h) = (s.x1 - s.x0, s.y1 - s.y0);
        for (dx, dy) in [
            (w - 1, h - 1),
            (1 - w, h - 1),
            (w - 1, 1 - h),
            (1 - w, 1 - h),
            (1, 0),
            (0, 1),
            (-1, 0),
            (0, -1),
        ] {
            assert!(
                !allowed(&[record(shifted(s, dx, dy))], &cfg),
                "shift ({dx}, {dy}) shares a cell with the site and must block"
            );
        }
        let inside = SiteBounds {
            x0: s.x0 + 1,
            y0: s.y0 + 1,
            x1: s.x0 + 2,
            y1: s.y0 + 2,
        };
        let around = SiteBounds {
            x0: s.x0 - 5,
            y0: s.y0 - 5,
            x1: s.x1 + 5,
            y1: s.y1 + 5,
        };
        assert!(!allowed(&[record(inside)], &cfg), "contained blocks");
        assert!(!allowed(&[record(around)], &cfg), "containing blocks");
    }

    #[test]
    fn a_blocking_record_anywhere_in_the_list_blocks() {
        let cfg = cfg();
        let s = cfg.site();
        let far = record(shifted(s, s.x1 - s.x0, 0));
        assert!(!allowed(&[far.clone(), record(s)], &cfg));
        assert!(!allowed(&[record(s), far.clone()], &cfg));
        assert!(allowed(&[far], &cfg));
    }
}
