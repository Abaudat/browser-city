//! The generic rule engine (FR111/FR112, story 2.10). One evaluator, one
//! rule table (`sim::generated::defs::RULES`): Epic 3's generator asks "is
//! this candidate legal" by calling [`evaluate`] against a hypothetical
//! placement, story 2.11's harness calls it against persisted output, and
//! there is never a second function that decides whether a rule holds --
//! that is how FR112's "one source" becomes a property rather than a
//! promise (Tim's direction).
//!
//! The engine never sees a content key ("cafe", "villa_district"): it
//! sees tag ids and integers. `defs/rules/*.toml` authors five closed
//! kinds (Placement, Distribution, Coherence, Adjacency, Requirement) as
//! data rows; extending the grammar within a kind is a new row, never a
//! branch here keyed on a rule's key, id or a subject's tag --
//! `scripts/ci/check-rule-engine-no-content-keys.sh` holds that
//! mechanically, failing the build if any key from `tools/defs-build/
//! goldens/defs-manifest.golden` ever appears as a literal under this
//! module. Adding a sixth kind is a deliberate decision: the `match` on
//! [`RuleKind`] has no `_ =>` arm, so it is a compile error until every
//! kind is handled on purpose.
//!
//! `RuleSite` is the one seam between this pure engine and whatever holds
//! real geometry -- `world::fixture` and `sim::rules::testing::Site`
//! today, Epic 3's generator state and story 2.11's harness (over world
//! tables) later, all answering the exact same four questions over
//! integer geometry: what tags a cell carries, which areas contain it,
//! its four neighbours on the same floor, and which subjects an area
//! contains. No `HashMap`, no floats (NFR25): "roughly one per N, evenly
//! spread" is an integer ratio, an integer tolerance percent and an
//! integer minimum spacing, all fields on the row, never constants here.

use std::collections::BTreeMap;

#[cfg(feature = "fixture")]
pub mod testing;

/// A tag's resolved numeric id (`defs/tags/*.toml`'s own append-only
/// manifest) -- the only vocabulary a rule or an object ever carries past
/// `tools/defs-build`. Never a `&str`: a content key never reaches this
/// module.
pub type TagId = u32;

/// An area's id -- today `building_area`/`room_area`'s own row id
/// (Tim's direction: "no new table is needed for this story"). Opaque to
/// this module beyond [`WORLD_AREA`].
pub type AreaId = u64;

/// The synthetic area every cell belongs to, implicitly, in addition to
/// whatever real area(s) contain it. `subjects_in_area(WORLD_AREA, tag)`
/// is how a rule with no container/within scans "the whole site" without
/// a fifth enumeration primitive on [`RuleSite`] -- a real area id is
/// never `0` (an id column starts at 1, like every other def kind's own
/// append-only manifest).
pub const WORLD_AREA: AreaId = 0;

/// `(x, y, floor)` addressing (FR117) -- the same three-axis address
/// `world` uses, but this module never depends on `world`: a `RuleSite`
/// answers every question this engine asks purely over integers a caller
/// already has, whatever shape its own geometry is stored in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Cell {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
}

impl Cell {
    pub fn new(x: i32, y: i32, floor: i8) -> Self {
        Self { x, y, floor }
    }
}

/// One of the four same-floor neighbours an adjacency rule may name.
/// North/south move along `y` (south is `y + 1` -- the south-west anchor
/// convention story 2.2 already fixed: larger `y` is further south).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    North,
    East,
    South,
    West,
}

impl Direction {
    pub const ALL: [Direction; 4] = [
        Direction::North,
        Direction::East,
        Direction::South,
        Direction::West,
    ];

    /// Steps `cell` one cell in this direction, same floor. Total over
    /// every `i32` input except at the exact numeric edge (`i32::MIN`/
    /// `i32::MAX`), which no real or fixture geometry ever reaches --
    /// `wrapping_add` keeps this a total function rather than a panic
    /// even there (the published profile runs with `overflow-checks`
    /// on).
    pub fn step(self, cell: Cell) -> Cell {
        let (dx, dy) = match self {
            Direction::North => (0, -1),
            Direction::East => (1, 0),
            Direction::South => (0, 1),
            Direction::West => (-1, 0),
        };
        Cell {
            x: cell.x.wrapping_add(dx),
            y: cell.y.wrapping_add(dy),
            floor: cell.floor,
        }
    }
}

/// The one seam between this pure engine and real geometry. Implemented
/// by [`testing::Site`] here, by `world::fixture` and, later, by Epic
/// 3's generator state and story 2.11's harness over world tables --
/// never by a second evaluator.
pub trait RuleSite {
    /// Every tag `cell` carries, in no particular order.
    fn tags_at(&self, cell: Cell) -> &[TagId];
    /// Every real area (never [`WORLD_AREA`]) that contains `cell`.
    fn areas_containing(&self, cell: Cell) -> &[AreaId];
    /// `cell`'s neighbour in `dir`, same floor.
    fn neighbour(&self, cell: Cell, dir: Direction) -> Cell;
    /// Every cell tagged `tag` within `area` ([`WORLD_AREA`] means the
    /// whole site), sorted and deduplicated. A real implementation
    /// indexes this once rather than rescanning every cell per call --
    /// `testing::SiteBuilder::build` is the worked example.
    fn subjects_in_area(&self, area: AreaId, tag: TagId) -> &[Cell];
}

/// `mode = "allow" | "forbid"` on a `[[coherence]]` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoherenceMode {
    /// `subject` may only ever appear within an area also containing
    /// `within` -- appearing outside every such area is the violation.
    Allow,
    /// `subject` may never appear within an area also containing
    /// `within` -- appearing inside one is the violation.
    Forbid,
}

/// `relation = "forbid" | "require"` on an `[[adjacency]]` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdjacencyRelation {
    Forbid,
    Require,
}

/// The closed set of five constraint kinds (FR111/AC2). Exhaustively
/// matched in [`evaluate`] with no `_ =>` arm: adding a sixth variant is a
/// compile error everywhere this type is matched, until every match is
/// updated on purpose (AC3's "a deliberate decision to add a sixth
/// kind").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleKind {
    /// `subject` may only appear within `[floor_min, floor_max]`
    /// (inclusive on both ends, either end optional); if `container` is
    /// given, the range only applies to a `subject` cell that sits in a
    /// real area also containing `container` -- a `subject` cell outside
    /// every such area is not checked at all (Crew's decision: a
    /// container-scoped placement rule says nothing about `subject`
    /// appearing outside its container).
    Placement {
        subject: TagId,
        container: Option<TagId>,
        floor_min: Option<i8>,
        floor_max: Option<i8>,
    },
    /// `subject` at roughly one per `ratio` of `per`, within
    /// `tolerance_percent` (rounded up), and no two `subject` cells
    /// closer than `min_spacing` cells (Chebyshev distance) when
    /// `min_spacing > 0`. Both measured over the whole site
    /// ([`WORLD_AREA`]) -- a distribution is a global density, not a
    /// per-container one. Zero `per` cells means the ratio check is
    /// vacuously satisfied (never a division by zero).
    Distribution {
        subject: TagId,
        per: TagId,
        ratio: u32,
        tolerance_percent: u32,
        min_spacing: u32,
    },
    /// Whether `subject` may (`Allow`) or may never (`Forbid`) appear
    /// within a real area that also contains `within`.
    Coherence {
        subject: TagId,
        within: TagId,
        mode: CoherenceMode,
    },
    /// Whether `a` must (`Require`) or must never (`Forbid`) have a
    /// same-floor neighbour tagged `b`. `direction`, when given, checks
    /// only that one side; absent, checks all four.
    Adjacency {
        a: TagId,
        b: TagId,
        relation: AdjacencyRelation,
        direction: Option<Direction>,
    },
    /// Every real area containing a `container`-tagged cell must contain
    /// between `min` and `max` (inclusive, `max` optional) cells tagged
    /// `requires`. Zero `container` cells anywhere is vacuously met --
    /// there is nothing to check (Quentin's boundary case).
    Requirement {
        container: TagId,
        requires: TagId,
        min: u32,
        max: Option<u32>,
    },
}

/// One rule row, its permanent id/key (`defs/rules/*.toml`'s own
/// append-only manifest) and its closed-kind payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuleDef {
    pub id: u32,
    pub key: &'static str,
    pub kind: RuleKind,
}

/// One rejection: `rule_id` and the offending `subject` cell (Quentin's
/// direction: never a bool, never just the first violation). `evaluate`
/// returns every violation, sorted by `(rule_id, subject)` -- a strict
/// total order over two `Ord` fields -- so output never depends on rule
/// or fact input order (NFR25).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Violation {
    pub rule_id: u32,
    pub subject: Cell,
}

/// A grid bucket key for the distribution spacing check: `min_spacing`
/// cells per bucket edge, so only a 3x3 neighbourhood of buckets (never
/// the whole cell set) can ever be within `min_spacing` of a given cell
/// -- the "spatial binning, not an all-pairs scan" Quentin's direction
/// asks for. `BTreeMap`, never `HashMap` (NFR25: deterministic
/// iteration).
fn bucket_of(cell: Cell, min_spacing: u32) -> (i8, i32, i32) {
    let s = min_spacing.max(1) as i64;
    let bx = (cell.x as i64).div_euclid(s) as i32;
    let by = (cell.y as i64).div_euclid(s) as i32;
    (cell.floor, bx, by)
}

fn chebyshev(a: Cell, b: Cell) -> i64 {
    ((a.x as i64 - b.x as i64).abs()).max((a.y as i64 - b.y as i64).abs())
}

/// The Distribution kind's spacing half: flags a `subject` cell that
/// lands within `min_spacing` cells (Chebyshev distance, same floor) of
/// an already-placed `subject` cell -- one violation per too-close cell,
/// keyed on that cell (deterministic under sorted input, since `subjects`
/// is already sorted by `RuleSite`'s own contract). `min_spacing == 0`
/// disables the check entirely (no minimum).
fn distribution_spacing_violations(
    rule_id: u32,
    subjects: &[Cell],
    min_spacing: u32,
) -> Vec<Violation> {
    if min_spacing == 0 {
        return Vec::new();
    }
    let mut violations = Vec::new();
    let mut buckets: BTreeMap<(i8, i32, i32), Vec<Cell>> = BTreeMap::new();
    for &cell in subjects {
        let (f, bx, by) = bucket_of(cell, min_spacing);
        let mut too_close = false;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(placed) = buckets.get(&(f, bx + dx, by + dy)) {
                    for &other in placed {
                        if chebyshev(cell, other) < min_spacing as i64 {
                            too_close = true;
                        }
                    }
                }
            }
        }
        if too_close {
            violations.push(Violation {
                rule_id,
                subject: cell,
            });
        }
        buckets.entry((f, bx, by)).or_default().push(cell);
    }
    violations
}

/// Runs every rule in `rules` against `site`, returning every violation
/// found, sorted by `(rule_id, subject)`. Never stops early (Tim's
/// direction): a rule that fails on ten cells reports all ten. `O(rules *
/// entities)`, never `O(rules * entities^2)` -- distribution's spacing
/// check uses [`distribution_spacing_violations`]'s spatial buckets, and
/// every other kind drives its scan off `site.subjects_in_area`, which a
/// real `RuleSite` indexes once rather than rescanning per rule.
pub fn evaluate(rules: &[RuleDef], site: &impl RuleSite) -> Vec<Violation> {
    let mut violations = Vec::new();
    for rule in rules {
        match rule.kind {
            RuleKind::Placement {
                subject,
                container,
                floor_min,
                floor_max,
            } => {
                for &cell in site.subjects_in_area(WORLD_AREA, subject) {
                    if let Some(container_tag) = container {
                        let scoped = site
                            .areas_containing(cell)
                            .iter()
                            .any(|&area| !site.subjects_in_area(area, container_tag).is_empty());
                        if !scoped {
                            continue;
                        }
                    }
                    let below_min = floor_min.is_some_and(|min| cell.floor < min);
                    let above_max = floor_max.is_some_and(|max| cell.floor > max);
                    if below_min || above_max {
                        violations.push(Violation {
                            rule_id: rule.id,
                            subject: cell,
                        });
                    }
                }
            }
            RuleKind::Distribution {
                subject,
                per,
                ratio,
                tolerance_percent,
                min_spacing,
            } => {
                let subjects = site.subjects_in_area(WORLD_AREA, subject);
                let per_cells = site.subjects_in_area(WORLD_AREA, per);
                let basis = per_cells.len() as u64;
                if basis > 0 {
                    let actual = subjects.len() as u64;
                    let expected = basis / (ratio.max(1) as u64);
                    let tolerance = (expected * tolerance_percent as u64).div_ceil(100);
                    let lower = expected.saturating_sub(tolerance);
                    let upper = expected + tolerance;
                    if actual < lower || actual > upper {
                        let anchor = subjects.first().copied().or(per_cells.first().copied());
                        if let Some(anchor) = anchor {
                            violations.push(Violation {
                                rule_id: rule.id,
                                subject: anchor,
                            });
                        }
                    }
                }
                violations.extend(distribution_spacing_violations(
                    rule.id,
                    subjects,
                    min_spacing,
                ));
            }
            RuleKind::Coherence {
                subject,
                within,
                mode,
            } => {
                for &cell in site.subjects_in_area(WORLD_AREA, subject) {
                    let within_present = site
                        .areas_containing(cell)
                        .iter()
                        .any(|&area| !site.subjects_in_area(area, within).is_empty());
                    let violated = match mode {
                        CoherenceMode::Forbid => within_present,
                        CoherenceMode::Allow => !within_present,
                    };
                    if violated {
                        violations.push(Violation {
                            rule_id: rule.id,
                            subject: cell,
                        });
                    }
                }
            }
            RuleKind::Adjacency {
                a,
                b,
                relation,
                direction,
            } => {
                let dirs: &[Direction] = match &direction {
                    Some(d) => std::slice::from_ref(d),
                    None => &Direction::ALL,
                };
                for &cell in site.subjects_in_area(WORLD_AREA, a) {
                    let has_b = dirs
                        .iter()
                        .any(|&d| site.tags_at(site.neighbour(cell, d)).contains(&b));
                    let violated = match relation {
                        AdjacencyRelation::Require => !has_b,
                        AdjacencyRelation::Forbid => has_b,
                    };
                    if violated {
                        violations.push(Violation {
                            rule_id: rule.id,
                            subject: cell,
                        });
                    }
                }
            }
            RuleKind::Requirement {
                container,
                requires,
                min,
                max,
            } => {
                for &cell in site.subjects_in_area(WORLD_AREA, container) {
                    for &area in site.areas_containing(cell) {
                        let count = site.subjects_in_area(area, requires).len() as u32;
                        if count < min || max.is_some_and(|m| count > m) {
                            violations.push(Violation {
                                rule_id: rule.id,
                                subject: cell,
                            });
                        }
                    }
                }
            }
        }
    }
    violations.sort();
    violations
}

#[cfg(test)]
mod tests {
    use super::testing::SiteBuilder;
    use super::*;

    const CAFE: TagId = 1;
    const SEATING: TagId = 3;
    const WASTE: TagId = 4;
    const WALL: TagId = 5;
    const ROOM: TagId = 6;
    const VILLA: TagId = 7;
    const SKYSCRAPER: TagId = 8;
    const DOOR: TagId = 9;
    const DWELLING: TagId = 10;
    const BUILDING: TagId = 11;

    const BUILDING_A: AreaId = 1;

    fn c(x: i32, y: i32, floor: i8) -> Cell {
        Cell::new(x, y, floor)
    }

    // --- placement --------------------------------------------------------

    fn no_cafe_above_floor_2() -> RuleDef {
        RuleDef {
            id: 1,
            key: "no_cafe_above_floor_2",
            kind: RuleKind::Placement {
                subject: CAFE,
                container: None,
                floor_min: None,
                floor_max: Some(2),
            },
        }
    }

    #[test]
    fn placement_satisfied_fixture_has_no_violation() {
        let site = SiteBuilder::new().cell(c(0, 0, 2), &[CAFE]).build();
        assert_eq!(evaluate(&[no_cafe_above_floor_2()], &site), vec![]);
    }

    #[test]
    fn placement_violated_fixture_names_the_rule_and_the_cell() {
        let site = SiteBuilder::new().cell(c(0, 0, 3), &[CAFE]).build();
        assert_eq!(
            evaluate(&[no_cafe_above_floor_2()], &site),
            vec![Violation {
                rule_id: 1,
                subject: c(0, 0, 3)
            }]
        );
    }

    #[test]
    fn placement_boundary_floor_equal_to_max_passes_max_plus_one_fails() {
        let at_max = SiteBuilder::new().cell(c(0, 0, 2), &[CAFE]).build();
        assert!(evaluate(&[no_cafe_above_floor_2()], &at_max).is_empty());

        let over_max = SiteBuilder::new().cell(c(0, 0, 3), &[CAFE]).build();
        assert_eq!(evaluate(&[no_cafe_above_floor_2()], &over_max).len(), 1);
    }

    #[test]
    fn placement_container_scopes_the_floor_check_to_cells_inside_it() {
        let rule = RuleDef {
            id: 2,
            key: "no_cafe_above_floor_2_downtown",
            kind: RuleKind::Placement {
                subject: CAFE,
                container: Some(BUILDING),
                floor_min: None,
                floor_max: Some(2),
            },
        };
        // Outside any building area at all: the container-scoped rule
        // says nothing about it.
        let outside = SiteBuilder::new().cell(c(0, 0, 5), &[CAFE]).build();
        assert!(evaluate(&[rule], &outside).is_empty());

        // Inside a building area tagged BUILDING, above floor 2: violates.
        let inside = SiteBuilder::new()
            .cell(c(1, 1, 5), &[CAFE])
            .cell(c(1, 1, 5), &[])
            .area(c(1, 1, 5), BUILDING_A)
            .cell(c(9, 9, 0), &[BUILDING])
            .area(c(9, 9, 0), BUILDING_A)
            .build();
        assert_eq!(
            evaluate(&[rule], &inside),
            vec![Violation {
                rule_id: 2,
                subject: c(1, 1, 5)
            }]
        );
    }

    // --- distribution -------------------------------------------------------

    fn one_waste_per_2_seating() -> RuleDef {
        RuleDef {
            id: 3,
            key: "waste_per_2_seating",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 2,
                tolerance_percent: 0,
                min_spacing: 3,
            },
        }
    }

    #[test]
    fn distribution_satisfied_fixture_has_no_violation() {
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(10, 0, 0), &[SEATING])
            .cell(c(5, 0, 0), &[WASTE])
            .build();
        assert_eq!(evaluate(&[one_waste_per_2_seating()], &site), vec![]);
    }

    #[test]
    fn distribution_violated_fixture_names_the_rule_and_a_subject() {
        // 4 seating -> expected 2 waste, 0% tolerance; only 0 waste present.
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(10, 0, 0), &[SEATING])
            .cell(c(20, 0, 0), &[SEATING])
            .cell(c(30, 0, 0), &[SEATING])
            .build();
        let rule = RuleDef {
            id: 3,
            key: "waste_per_2_seating",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 2,
                tolerance_percent: 0,
                min_spacing: 0,
            },
        };
        let violations = evaluate(&[rule], &site);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].rule_id, 3);
        assert_eq!(violations[0].subject, c(0, 0, 0));
    }

    #[test]
    fn distribution_boundary_zero_per_cells_never_divides_by_zero() {
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[WASTE]).build();
        assert_eq!(evaluate(&[one_waste_per_2_seating()], &site), vec![]);
    }

    #[test]
    fn distribution_boundary_exactly_at_tolerance_passes_one_past_fails() {
        // 4 seating, ratio 2 -> expected 2, tolerance 50% -> ceil(1) = 1, so [1, 3] passes.
        let rule = RuleDef {
            id: 4,
            key: "waste_per_2_seating_tolerant",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 2,
                tolerance_percent: 50,
                min_spacing: 0,
            },
        };
        let at_tolerance = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(1, 0, 0), &[SEATING])
            .cell(c(2, 0, 0), &[SEATING])
            .cell(c(3, 0, 0), &[SEATING])
            .cell(c(100, 0, 0), &[WASTE])
            .cell(c(101, 0, 0), &[WASTE])
            .cell(c(102, 0, 0), &[WASTE])
            .build();
        assert!(evaluate(&[rule], &at_tolerance).is_empty());

        let past_tolerance = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(1, 0, 0), &[SEATING])
            .cell(c(2, 0, 0), &[SEATING])
            .cell(c(3, 0, 0), &[SEATING])
            .cell(c(100, 0, 0), &[WASTE])
            .cell(c(101, 0, 0), &[WASTE])
            .cell(c(102, 0, 0), &[WASTE])
            .cell(c(103, 0, 0), &[WASTE])
            .build();
        assert_eq!(evaluate(&[rule], &past_tolerance).len(), 1);
    }

    #[test]
    fn distribution_spacing_violates_when_two_subjects_land_too_close() {
        let rule = RuleDef {
            id: 5,
            key: "waste_spread",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 1,
                tolerance_percent: 100,
                min_spacing: 5,
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SEATING, WASTE])
            .cell(c(1, 0, 0), &[WASTE])
            .build();
        let violations = evaluate(&[rule], &site);
        assert_eq!(
            violations,
            vec![Violation {
                rule_id: 5,
                subject: c(1, 0, 0)
            }]
        );
    }

    #[test]
    fn distribution_even_layout_of_waste_never_violates_spacing() {
        let rule = RuleDef {
            id: 6,
            key: "waste_spread_even",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 1,
                tolerance_percent: 0,
                min_spacing: 4,
            },
        };
        let mut builder = SiteBuilder::new();
        for i in 0..5 {
            builder = builder
                .cell(c(i * 10, 0, 0), &[WASTE])
                .cell(c(i * 10, 0, 0), &[SEATING]);
        }
        let site = builder.build();
        assert!(evaluate(&[rule], &site).is_empty());
    }

    // --- coherence ----------------------------------------------------------

    fn no_skyscraper_in_villa_district() -> RuleDef {
        RuleDef {
            id: 7,
            key: "no_skyscraper_in_villa_district",
            kind: RuleKind::Coherence {
                subject: SKYSCRAPER,
                within: VILLA,
                mode: CoherenceMode::Forbid,
            },
        }
    }

    #[test]
    fn coherence_satisfied_fixture_has_no_violation() {
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[SKYSCRAPER]).build();
        assert_eq!(
            evaluate(&[no_skyscraper_in_villa_district()], &site),
            vec![]
        );
    }

    #[test]
    fn coherence_violated_fixture_names_the_rule_and_the_cell() {
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SKYSCRAPER])
            .area(c(0, 0, 0), BUILDING_A)
            .cell(c(5, 5, 0), &[VILLA])
            .area(c(5, 5, 0), BUILDING_A)
            .build();
        assert_eq!(
            evaluate(&[no_skyscraper_in_villa_district()], &site),
            vec![Violation {
                rule_id: 7,
                subject: c(0, 0, 0)
            }]
        );
    }

    #[test]
    fn coherence_boundary_outside_any_area_never_forbidden() {
        // No real area at all -- forbid can never trigger with nothing to
        // be "within".
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[SKYSCRAPER]).build();
        assert!(evaluate(&[no_skyscraper_in_villa_district()], &site).is_empty());
    }

    #[test]
    fn coherence_allow_mode_violates_when_outside_every_matching_area() {
        let rule = RuleDef {
            id: 8,
            key: "wall_only_in_room",
            kind: RuleKind::Coherence {
                subject: WALL,
                within: ROOM,
                mode: CoherenceMode::Allow,
            },
        };
        let outside = SiteBuilder::new().cell(c(0, 0, 0), &[WALL]).build();
        assert_eq!(evaluate(&[rule], &outside).len(), 1);

        let inside = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WALL])
            .area(c(0, 0, 0), BUILDING_A)
            .cell(c(1, 1, 0), &[ROOM])
            .area(c(1, 1, 0), BUILDING_A)
            .build();
        assert!(evaluate(&[rule], &inside).is_empty());
    }

    // --- adjacency ------------------------------------------------------------

    fn door_requires_wall_to_the_north() -> RuleDef {
        RuleDef {
            id: 9,
            key: "door_requires_wall_north",
            kind: RuleKind::Adjacency {
                a: DOOR,
                b: WALL,
                relation: AdjacencyRelation::Require,
                direction: Some(Direction::North),
            },
        }
    }

    #[test]
    fn adjacency_satisfied_fixture_has_no_violation() {
        let site = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 0, 0), &[WALL])
            .build();
        assert_eq!(
            evaluate(&[door_requires_wall_to_the_north()], &site),
            vec![]
        );
    }

    #[test]
    fn adjacency_violated_fixture_names_the_rule_and_the_cell() {
        let site = SiteBuilder::new().cell(c(0, 1, 0), &[DOOR]).build();
        assert_eq!(
            evaluate(&[door_requires_wall_to_the_north()], &site),
            vec![Violation {
                rule_id: 9,
                subject: c(0, 1, 0)
            }]
        );
    }

    #[test]
    fn adjacency_is_directional_a_next_to_b_differs_from_b_next_to_a() {
        // DOOR at (0,1) has WALL to its south (0,2), not its north -- the
        // north-specific rule must still violate.
        let site = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 2, 0), &[WALL])
            .build();
        assert_eq!(
            evaluate(&[door_requires_wall_to_the_north()], &site).len(),
            1
        );
    }

    #[test]
    fn adjacency_forbid_violates_only_when_present_in_the_named_direction() {
        let rule = RuleDef {
            id: 10,
            key: "door_never_faces_wall_north",
            kind: RuleKind::Adjacency {
                a: DOOR,
                b: WALL,
                relation: AdjacencyRelation::Forbid,
                direction: Some(Direction::North),
            },
        };
        let wall_to_south = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 2, 0), &[WALL])
            .build();
        assert!(evaluate(&[rule], &wall_to_south).is_empty());

        let wall_to_north = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 0, 0), &[WALL])
            .build();
        assert_eq!(evaluate(&[rule], &wall_to_north).len(), 1);
    }

    #[test]
    fn adjacency_without_a_direction_checks_all_four_neighbours() {
        let rule = RuleDef {
            id: 11,
            key: "door_requires_wall_any_side",
            kind: RuleKind::Adjacency {
                a: DOOR,
                b: WALL,
                relation: AdjacencyRelation::Require,
                direction: None,
            },
        };
        let wall_to_east = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DOOR])
            .cell(c(1, 0, 0), &[WALL])
            .build();
        assert!(evaluate(&[rule], &wall_to_east).is_empty());
    }

    // --- requirement ----------------------------------------------------------

    fn every_dwelling_has_a_door() -> RuleDef {
        RuleDef {
            id: 12,
            key: "every_dwelling_has_a_door",
            kind: RuleKind::Requirement {
                container: DWELLING,
                requires: DOOR,
                min: 1,
                max: None,
            },
        }
    }

    #[test]
    fn requirement_satisfied_fixture_has_no_violation() {
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DWELLING])
            .area(c(0, 0, 0), BUILDING_A)
            .cell(c(1, 0, 0), &[DOOR])
            .area(c(1, 0, 0), BUILDING_A)
            .build();
        assert_eq!(evaluate(&[every_dwelling_has_a_door()], &site), vec![]);
    }

    #[test]
    fn requirement_violated_fixture_names_the_rule_and_the_cell() {
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DWELLING])
            .area(c(0, 0, 0), BUILDING_A)
            .build();
        assert_eq!(
            evaluate(&[every_dwelling_has_a_door()], &site),
            vec![Violation {
                rule_id: 12,
                subject: c(0, 0, 0)
            }]
        );
    }

    #[test]
    fn requirement_boundary_zero_dwellings_is_vacuously_met() {
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[DOOR]).build();
        assert_eq!(evaluate(&[every_dwelling_has_a_door()], &site), vec![]);
    }

    #[test]
    fn requirement_max_rejects_too_many() {
        let rule = RuleDef {
            id: 13,
            key: "at_most_one_door",
            kind: RuleKind::Requirement {
                container: DWELLING,
                requires: DOOR,
                min: 0,
                max: Some(1),
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DWELLING])
            .area(c(0, 0, 0), BUILDING_A)
            .cell(c(1, 0, 0), &[DOOR])
            .area(c(1, 0, 0), BUILDING_A)
            .cell(c(2, 0, 0), &[DOOR])
            .area(c(2, 0, 0), BUILDING_A)
            .build();
        assert_eq!(evaluate(&[rule], &site).len(), 1);
    }

    // --- cross-cutting ----------------------------------------------------------

    #[test]
    fn evaluate_returns_every_violation_sorted_by_rule_id_then_subject_never_stopping_early() {
        let site = SiteBuilder::new()
            .cell(c(5, 0, 3), &[CAFE])
            .cell(c(1, 0, 3), &[CAFE])
            .build();
        let low_id = RuleDef {
            id: 1,
            key: "a",
            kind: RuleKind::Placement {
                subject: CAFE,
                container: None,
                floor_min: None,
                floor_max: Some(2),
            },
        };
        let high_id = RuleDef {
            id: 2,
            key: "b",
            kind: RuleKind::Placement {
                subject: CAFE,
                container: None,
                floor_min: None,
                floor_max: Some(2),
            },
        };
        let violations = evaluate(&[high_id, low_id], &site);
        assert_eq!(
            violations,
            vec![
                Violation {
                    rule_id: 1,
                    subject: c(1, 0, 3)
                },
                Violation {
                    rule_id: 1,
                    subject: c(5, 0, 3)
                },
                Violation {
                    rule_id: 2,
                    subject: c(1, 0, 3)
                },
                Violation {
                    rule_id: 2,
                    subject: c(5, 0, 3)
                },
            ]
        );
    }
}
