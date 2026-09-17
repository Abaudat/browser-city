//! Story 2.11 (FR112): the validation harness -- the second of the two
//! places FR112 says must read one rule source. [`validate`] composes
//! [`crate::rules::evaluate`] (against [`crate::rules::RuleSet::
//! committed`], the only rule set this module can ever reach) with 2.4's
//! own walkability checks (`crate::world::walkability::enclosed_regions`/
//! `narrow_passages`) over the *real* placed-object shape a generator or
//! a persisted district actually has -- never a second, hand-rolled
//! evaluator and never a re-derived footprint offset.
//!
//! Not feature-gated (Tim's direction): Epic 3's generator needs this in
//! the published module, unlike `rules::testing`'s hand-authored
//! fixtures. `[`validate`]`'s own entry point takes no rule, object or
//! balance argument at all -- it reads `crate::generated::defs` itself,
//! so there is no parameter through which a second rule source, object
//! table or balance seed could ever enter.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::generated::defs;
use crate::rules::{self, AreaId, Cell, RuleSet, RuleSite, TagId};
use crate::world::walkability::{self, Placement};
use crate::world::{AreaSpec, Rect};

/// A window onto one floor: the [`Rect`] (sub-cells) `enclosed_regions`/
/// `narrow_passages` scan, and the seed cell (also sub-cells) reachability
/// is judged from -- a generator's own start position, or any cell the
/// caller already knows is meant to be walkable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FloorWindow {
    pub floor: i8,
    pub bounds: Rect,
    pub seed_x: i32,
    pub seed_y: i32,
}

/// The real shape [`validate`] checks: exactly the inputs Epic 3's
/// generator already holds in memory and a persisted district can supply
/// back -- plain slices, never hand-tagged cells (Tim's direction).
/// `defs_version` is the candidate's own stamp, checked against this
/// build's committed [`defs::DEFS_VERSION`] before anything else runs
/// (FR112's other half: the harness refuses a candidate produced against
/// a different rule source, rather than silently validating it against
/// the wrong one).
#[derive(Debug, Clone, Copy)]
pub struct Candidate<'a> {
    pub defs_version: &'a str,
    pub placements: &'a [Placement],
    pub building_areas: &'a [AreaSpec],
    pub room_areas: &'a [AreaSpec],
    pub floors: &'a [FloorWindow],
}

/// What [`validate`] refuses to do at all, as opposed to reporting a
/// [`Defect`] (a content violation, always `Ok`, never this).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    /// `candidate.defs_version` disagrees with this build's own committed
    /// [`defs::DEFS_VERSION`] -- the candidate was produced against a
    /// different rule source. Refused outright: never validated against
    /// the wrong rules, and never reported as an empty (all-clear)
    /// result standing in for "nothing to check".
    RuleSourceMismatch {
        expected: &'static str,
        actual: String,
    },
    /// The block itself could not be read -- an unknown object def id, an
    /// unusable seed, or a checked-arithmetic overflow. Never a content
    /// violation: those are always `Ok`, carried as a [`Defect`] in the
    /// result vector, and never short-circuit the other checks.
    Unreadable(String),
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ValidationError::RuleSourceMismatch { expected, actual } => write!(
                f,
                "validation: candidate defs_version '{actual}' does not match the committed '{expected}'"
            ),
            ValidationError::Unreadable(msg) => write!(f, "validation: {msg}"),
        }
    }
}

impl std::error::Error for ValidationError {}

/// One thing [`validate`] checks a block against: a rule row (by id, from
/// [`RuleSet::committed`]) or one of the two walkability checks. Closed
/// and exhaustively matched wherever this is destructured (Tim's
/// direction) -- a name is never `Finding` or `Violation`, both of which
/// already exist elsewhere in this crate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Check {
    Rule(u32),
    EnclosedRegion,
    NarrowPassage,
}

impl Check {
    /// The rule's own `key`, or a fixed `walkability.*` name for the two
    /// checks with no rule row behind them. Resolved through
    /// [`RuleSet::key_of`], never by reading the generated rule table
    /// directly (`check-rule-source.sh`'s own check (d)) -- a
    /// `Check::Rule` this module ever constructs always names an id
    /// [`rules::evaluate`] itself produced against [`RuleSet::committed`],
    /// so the id is always present.
    fn name(&self) -> &'static str {
        match self {
            Check::Rule(id) => RuleSet::committed()
                .key_of(*id)
                .expect("a Check::Rule always names an id from the committed RuleSet"),
            Check::EnclosedRegion => "walkability.enclosed_region",
            Check::NarrowPassage => "walkability.narrow_passage",
        }
    }
}

/// Where a [`Defect`] was found: a full `(x, y, floor)` cell (plus the
/// matched neighbour cell for an `Adjacency::Forbid` violation) for a
/// rule row, or a sub-cell rect on one floor for a walkability finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Location {
    Cell { cell: Cell, other: Option<Cell> },
    SubcellRect { floor: i8, rect: Rect },
}

impl fmt::Display for Location {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Location::Cell {
                cell,
                other: Some(other),
            } => write!(
                f,
                "({}, {}, {}) <-> ({}, {}, {})",
                cell.x, cell.y, cell.floor, other.x, other.y, other.floor
            ),
            Location::Cell { cell, other: None } => {
                write!(f, "({}, {}, {})", cell.x, cell.y, cell.floor)
            }
            Location::SubcellRect { floor, rect } => write!(
                f,
                "floor {floor} sub-cells ({}, {})-({}, {})",
                rect.x0, rect.y0, rect.x1, rect.y1
            ),
        }
    }
}

/// One reported content violation: never a bool, never just the first --
/// [`validate`] returns every one, from every check, sorted and
/// deduplicated (Quentin's direction: the harness wraps `evaluate` and
/// must not add early exits).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Defect {
    pub check: Check,
    pub location: Location,
}

impl fmt::Display for Defect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at {}", self.check.name(), self.location)
    }
}

/// `(kind, owner_id)` -> a disjoint opaque [`AreaId`] inside
/// [`PlacedSite`] -- building owner 1 and room owner 1 are different
/// areas (Tim's direction), never the same numeric id colliding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum AreaKind {
    Building,
    Room,
}

/// The first real [`RuleSite`] over placed objects: resolves each
/// placement's `def_id` through [`defs::OBJECTS`], uses
/// [`walkability::footprint_origin`] (never a re-derived offset), stamps
/// every footprint cell with every tag of the object (unioned where
/// objects stack), and builds every index once in [`Self::build`] -- no
/// per-call rescan, per [`RuleSite`]'s own contract. [`Self::build`]
/// itself is bounded by the number of placed cells and the number of
/// areas, never by cells times areas (Tim's direction): it resolves each
/// placement's object through a map built once, and walks each area's
/// own `BTreeMap::range` slice of already-placed cells rather than
/// scanning every cell against every area.
pub struct PlacedSite {
    tags: BTreeMap<Cell, Vec<TagId>>,
    areas: BTreeMap<Cell, Vec<AreaId>>,
    subjects_index: BTreeMap<(Option<AreaId>, TagId), Vec<Cell>>,
    empty_tags: Vec<TagId>,
    empty_areas: Vec<AreaId>,
    empty_cells: Vec<Cell>,
}

impl PlacedSite {
    /// `Err` only when the block itself is unreadable (an unknown
    /// `def_id`) -- never for a content violation, which this type does
    /// not judge at all; that is [`rules::evaluate`]'s job once this site
    /// exists.
    pub fn build(
        placements: &[Placement],
        building_areas: &[AreaSpec],
        room_areas: &[AreaSpec],
    ) -> Result<Self, String> {
        // A stable, input-order-independent numbering (NFR25): every
        // owner id is collected into a sorted set first, so the opaque
        // `AreaId` a `(kind, owner_id)` pair maps to never depends on
        // which `AreaSpec` happened to come first in the slice -- an
        // owner spanning several chunks (several `AreaSpec` rows sharing
        // one `owner_id`) merges into that single area here.
        let mut owners: BTreeSet<(AreaKind, u64)> = BTreeSet::new();
        for a in building_areas {
            owners.insert((AreaKind::Building, a.owner_id));
        }
        for a in room_areas {
            owners.insert((AreaKind::Room, a.owner_id));
        }
        let area_id_of: BTreeMap<(AreaKind, u64), AreaId> = owners
            .into_iter()
            .enumerate()
            .map(|(i, k)| (k, i as AreaId + 1))
            .collect();

        // Resolved once, never a linear `find` over `defs::OBJECTS` per
        // placement (Tim's direction): `O(objects)` here, `O(1)` per
        // placement below.
        let objects_by_id: BTreeMap<u32, &defs::ObjectDef> =
            defs::OBJECTS.iter().map(|o| (o.id, o)).collect();

        let mut tags: BTreeMap<Cell, Vec<TagId>> = BTreeMap::new();
        for p in placements {
            let def = *objects_by_id.get(&p.def_id).ok_or_else(|| {
                format!(
                    "sim::validation: placement names unknown object def id {}",
                    p.def_id
                )
            })?;
            let (origin_x, origin_y) =
                walkability::footprint_origin(p.anchor_x, p.anchor_y, def.height);
            for dy in 0..def.height as i32 {
                for dx in 0..def.width as i32 {
                    let cell = Cell::new(origin_x + dx, origin_y + dy, p.floor);
                    let entry = tags.entry(cell).or_default();
                    for &t in def.tags {
                        if !entry.contains(&t) {
                            entry.push(t);
                        }
                    }
                }
            }
        }
        for v in tags.values_mut() {
            v.sort_unstable();
        }

        // Bounded by placed cells times areas actually near them, never
        // by placed cells times every area in the block (Tim's
        // direction): for each area, `Cell`'s own `Ord` (x first, then y,
        // then floor) lets `BTreeMap::range` slice `tags` down to exactly
        // the cells whose `x` falls in the area's own span, before the
        // `floor`/`contains` check narrows that slice further -- never a
        // loop over the rect's own (potentially enormous) raw extent.
        let mut areas: BTreeMap<Cell, Vec<AreaId>> = BTreeMap::new();
        for (kind, area_list) in [
            (AreaKind::Building, building_areas),
            (AreaKind::Room, room_areas),
        ] {
            for a in area_list {
                if a.rect.x0 >= a.rect.x1 {
                    continue; // an empty or invalid rect contains nothing
                }
                let id = area_id_of[&(kind, a.owner_id)];
                let lower = Cell::new(a.rect.x0, i32::MIN, i8::MIN);
                let upper = Cell::new(a.rect.x1, i32::MIN, i8::MIN);
                for (&cell, _) in tags.range(lower..upper) {
                    if a.floor == cell.floor && a.rect.contains(cell.x, cell.y) {
                        let entry = areas.entry(cell).or_default();
                        if !entry.contains(&id) {
                            entry.push(id);
                        }
                    }
                }
            }
        }
        for v in areas.values_mut() {
            v.sort_unstable();
        }

        let mut subjects_index: BTreeMap<(Option<AreaId>, TagId), Vec<Cell>> = BTreeMap::new();
        for (&cell, cell_tags) in &tags {
            let cell_areas = areas.get(&cell).cloned().unwrap_or_default();
            for &tag in cell_tags {
                subjects_index.entry((None, tag)).or_default().push(cell);
                for &area in &cell_areas {
                    subjects_index
                        .entry((Some(area), tag))
                        .or_default()
                        .push(cell);
                }
            }
        }
        for v in subjects_index.values_mut() {
            v.sort_unstable();
            v.dedup();
        }

        Ok(PlacedSite {
            tags,
            areas,
            subjects_index,
            empty_tags: Vec::new(),
            empty_areas: Vec::new(),
            empty_cells: Vec::new(),
        })
    }
}

impl RuleSite for PlacedSite {
    fn tags_at(&self, cell: Cell) -> &[TagId] {
        self.tags.get(&cell).unwrap_or(&self.empty_tags)
    }

    fn areas_containing(&self, cell: Cell) -> &[AreaId] {
        self.areas.get(&cell).unwrap_or(&self.empty_areas)
    }

    fn subjects_in_area(&self, area: Option<AreaId>, tag: TagId) -> &[Cell] {
        self.subjects_index
            .get(&(area, tag))
            .unwrap_or(&self.empty_cells)
    }
}

/// The one harness (story 2.11, FR112): composes [`rules::evaluate`]
/// (against [`RuleSet::committed`], the only rule set reachable here) and
/// 2.4's own `enclosed_regions`/`narrow_passages` over `candidate`'s real
/// placed-object shape, returning every defect from every check, sorted
/// and deduplicated -- never stopping at the first (Quentin's direction).
/// Refuses outright (`Err`) rather than validating against the wrong
/// rules when `candidate.defs_version` disagrees with this build's own
/// [`defs::DEFS_VERSION`], and refuses (a different `Err` variant) when
/// the block itself cannot be read; a content violation is always `Ok`,
/// carried as a [`Defect`].
pub fn validate(candidate: &Candidate) -> Result<Vec<Defect>, ValidationError> {
    if candidate.defs_version != defs::DEFS_VERSION {
        return Err(ValidationError::RuleSourceMismatch {
            expected: defs::DEFS_VERSION,
            actual: candidate.defs_version.to_string(),
        });
    }

    let site = PlacedSite::build(
        candidate.placements,
        candidate.building_areas,
        candidate.room_areas,
    )
    .map_err(ValidationError::Unreadable)?;

    let mut defects: Vec<Defect> = rules::evaluate(RuleSet::committed(), &site)
        .into_iter()
        .map(|v| Defect {
            check: Check::Rule(v.rule_id),
            location: Location::Cell {
                cell: v.subject,
                other: v.other,
            },
        })
        .collect();

    let (body_w, body_h) = walkability::player_body_subcells(defs::BALANCE);
    for fw in candidate.floors {
        let grid = walkability::rasterise(fw.bounds, fw.floor, candidate.placements, defs::OBJECTS)
            .map_err(ValidationError::Unreadable)?;
        for finding in walkability::enclosed_regions(&grid, fw.seed_x, fw.seed_y)
            .map_err(ValidationError::Unreadable)?
        {
            defects.push(Defect {
                check: Check::EnclosedRegion,
                location: Location::SubcellRect {
                    floor: fw.floor,
                    rect: finding.bounds,
                },
            });
        }
        for finding in walkability::narrow_passages(&grid, fw.seed_x, fw.seed_y, body_w, body_h)
            .map_err(ValidationError::Unreadable)?
        {
            defects.push(Defect {
                check: Check::NarrowPassage,
                location: Location::SubcellRect {
                    floor: fw.floor,
                    rect: finding.bounds,
                },
            });
        }
    }

    defects.sort();
    defects.dedup();
    Ok(defects)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::chunk_key;

    #[test]
    fn rule_source_mismatch_renders_both_versions() {
        let err = ValidationError::RuleSourceMismatch {
            expected: "aaaa",
            actual: "bbbb".to_string(),
        };
        let rendered = err.to_string();
        assert!(rendered.contains("aaaa"));
        assert!(rendered.contains("bbbb"));
    }

    #[test]
    fn unreadable_renders_its_own_message() {
        let err = ValidationError::Unreadable("bad block".to_string());
        assert!(err.to_string().contains("bad block"));
    }

    #[test]
    fn a_subcell_rect_location_renders_the_floor_and_rect() {
        let location = Location::SubcellRect {
            floor: 2,
            rect: Rect {
                x0: 0,
                y0: 0,
                x1: 16,
                y1: 16,
            },
        };
        assert_eq!(location.to_string(), "floor 2 sub-cells (0, 0)-(16, 16)");
    }

    #[test]
    fn a_walkability_check_renders_its_own_fixed_name() {
        assert_eq!(Check::EnclosedRegion.name(), "walkability.enclosed_region");
        assert_eq!(Check::NarrowPassage.name(), "walkability.narrow_passage");
    }

    fn area(owner_id: u64, floor: i8, rect: Rect) -> AreaSpec {
        AreaSpec {
            owner_id,
            floor,
            rect,
            chunk_key: chunk_key(rect.x0, rect.y0, floor),
        }
    }

    fn lamppost_id() -> u32 {
        defs::OBJECTS
            .iter()
            .find(|o| o.key == "lamppost")
            .unwrap()
            .id
    }

    #[test]
    fn placed_site_stamps_every_footprint_cell_with_every_tag() {
        let bench_id = defs::OBJECTS
            .iter()
            .find(|o| o.key == "park_bench")
            .unwrap()
            .id;
        let placements = [Placement {
            def_id: bench_id,
            anchor_x: 0,
            anchor_y: 0,
            floor: 0,
        }];
        let site = PlacedSite::build(&placements, &[], &[]).unwrap();
        // width 2, height 1: both footprint cells carry the object's tags.
        assert!(!site.tags_at(Cell::new(0, 0, 0)).is_empty());
        assert!(!site.tags_at(Cell::new(1, 0, 0)).is_empty());
        assert_eq!(
            site.tags_at(Cell::new(0, 0, 0)),
            site.tags_at(Cell::new(1, 0, 0))
        );
    }

    #[test]
    fn placed_site_unions_tags_where_two_objects_stack_on_the_same_cell() {
        let placements = [
            Placement {
                def_id: lamppost_id(),
                anchor_x: 0,
                anchor_y: 0,
                floor: 0,
            },
            Placement {
                def_id: defs::OBJECTS
                    .iter()
                    .find(|o| o.key == "trash_bin")
                    .unwrap()
                    .id,
                anchor_x: 0,
                anchor_y: 0,
                floor: 0,
            },
        ];
        let site = PlacedSite::build(&placements, &[], &[]).unwrap();
        let tags = site.tags_at(Cell::new(0, 0, 0));
        assert!(tags.contains(&support_tag_id("lighting")));
        assert!(tags.contains(&support_tag_id("waste")));
    }

    #[test]
    fn placed_site_gives_building_owner_1_and_room_owner_1_distinct_area_ids() {
        let rect = Rect {
            x0: 0,
            y0: 0,
            x1: 1,
            y1: 1,
        };
        let placements = [Placement {
            def_id: lamppost_id(),
            anchor_x: 0,
            anchor_y: 0,
            floor: 0,
        }];
        let site =
            PlacedSite::build(&placements, &[area(1, 0, rect)], &[area(1, 0, rect)]).unwrap();
        let areas = site.areas_containing(Cell::new(0, 0, 0));
        assert_eq!(areas.len(), 2);
        assert_ne!(areas[0], areas[1]);
    }

    #[test]
    fn placed_site_merges_an_owners_per_chunk_rects_into_one_area() {
        let placements = [
            Placement {
                def_id: lamppost_id(),
                anchor_x: 0,
                anchor_y: 0,
                floor: 0,
            },
            Placement {
                def_id: lamppost_id(),
                anchor_x: 10,
                anchor_y: 0,
                floor: 0,
            },
        ];
        let site = PlacedSite::build(
            &placements,
            &[
                area(
                    1,
                    0,
                    Rect {
                        x0: 0,
                        y0: 0,
                        x1: 1,
                        y1: 1,
                    },
                ),
                area(
                    1,
                    0,
                    Rect {
                        x0: 10,
                        y0: 0,
                        x1: 11,
                        y1: 1,
                    },
                ),
            ],
            &[],
        )
        .unwrap();
        let a = site.areas_containing(Cell::new(0, 0, 0));
        let b = site.areas_containing(Cell::new(10, 0, 0));
        assert_eq!(a, b);
    }

    /// Tim's direction: a plain correctness test on a chunk-scale input
    /// (thousands of placements, hundreds of areas) -- proves `build`
    /// completes and answers correctly at a scale where the old
    /// cells-times-areas scan would be the dominant cost, never a timing
    /// assertion.
    #[test]
    fn placed_site_builds_correctly_over_a_chunk_scale_block() {
        const ROWS: i32 = 50;
        const COLS: i32 = 50; // 2500 placements
        const AREAS_PER_ROW: i32 = 5; // 250 areas, 10 cells wide each

        let mut placements = Vec::new();
        for y in 0..ROWS {
            for x in 0..COLS {
                placements.push(Placement {
                    def_id: lamppost_id(),
                    anchor_x: x,
                    anchor_y: y,
                    floor: 0,
                });
            }
        }

        let mut building_areas = Vec::new();
        for y in 0..ROWS {
            for band in 0..AREAS_PER_ROW {
                let owner_id = (y * AREAS_PER_ROW + band) as u64 + 1;
                building_areas.push(area(
                    owner_id,
                    0,
                    Rect {
                        x0: band * 10,
                        y0: y,
                        x1: band * 10 + 10,
                        y1: y + 1,
                    },
                ));
            }
        }

        let site = PlacedSite::build(&placements, &building_areas, &[]).unwrap();

        // Every placed cell falls in exactly one band's own area.
        for y in [0, ROWS / 2, ROWS - 1] {
            for x in [0, 15, 27, COLS - 1] {
                let areas = site.areas_containing(Cell::new(x, y, 0));
                assert_eq!(
                    areas.len(),
                    1,
                    "cell ({x}, {y}) should sit in exactly one area, got {areas:?}"
                );
            }
        }
        // A cell no placement ever touched carries no area.
        assert!(site.areas_containing(Cell::new(-1, -1, 0)).is_empty());
    }

    #[test]
    fn validate_refuses_a_defs_version_mismatch_rather_than_an_empty_report() {
        let candidate = Candidate {
            defs_version: "not-the-real-version",
            placements: &[],
            building_areas: &[],
            room_areas: &[],
            floors: &[],
        };
        let err = validate(&candidate).unwrap_err();
        assert!(matches!(err, ValidationError::RuleSourceMismatch { .. }));
    }

    #[test]
    fn validate_accepts_the_committed_defs_version_and_reports_no_defects_for_an_empty_block() {
        let candidate = Candidate {
            defs_version: defs::DEFS_VERSION,
            placements: &[],
            building_areas: &[],
            room_areas: &[],
            floors: &[],
        };
        assert_eq!(validate(&candidate).unwrap(), vec![]);
    }

    #[test]
    fn validate_errors_rather_than_panics_on_an_unknown_object_def_id() {
        let candidate = Candidate {
            defs_version: defs::DEFS_VERSION,
            placements: &[Placement {
                def_id: 999_999,
                anchor_x: 0,
                anchor_y: 0,
                floor: 0,
            }],
            building_areas: &[],
            room_areas: &[],
            floors: &[],
        };
        assert!(matches!(
            validate(&candidate),
            Err(ValidationError::Unreadable(_))
        ));
    }

    fn support_tag_id(key: &str) -> TagId {
        defs::TAGS.iter().find(|t| t.key == key).unwrap().id
    }
}
