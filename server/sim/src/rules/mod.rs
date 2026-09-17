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
//! `scripts/ci/check-rule-engine-no-content-keys.sh` and
//! `inv_rule_verdicts_invariant_under_tag_relabelling` (`server/sim/
//! tests/invariants.rs`) both hold that: the grep guard catches a
//! hardcoded *quoted* key, the property test catches a hardcoded *id*
//! (`if subject == 7`), which no grep could ever see. Adding a sixth kind
//! is a deliberate decision: the `match` on [`RuleKind`] has no `_ =>`
//! arm, so it is a compile error until every kind is handled on purpose.
//!
//! `RuleSite` is the one seam between this pure engine and whatever holds
//! real geometry -- `sim::rules::testing::Site` today, `world::fixture`,
//! Epic 3's generator state and story 2.11's harness (over world tables)
//! later, all answering the same three questions over integer geometry:
//! what tags a cell carries, which areas contain it, and which subjects
//! an area (or the whole site) contains. A same-floor neighbour is never
//! asked of a `RuleSite` -- [`Direction::step`] is pure arithmetic no
//! implementation could legitimately answer differently, so it is not a
//! seam at all. No `HashMap`, no floats (NFR25): "roughly one per N,
//! evenly spread" is an integer ratio, an integer tolerance percent, an
//! integer minimum spacing and an integer maximum coverage distance, all
//! fields on the row, never constants here.

use std::collections::BTreeMap;

#[cfg(feature = "test-fixtures")]
pub mod testing;

/// A tag's resolved numeric id (`defs/tags/*.toml`'s own append-only
/// manifest) -- the only vocabulary a rule or an object ever carries past
/// `tools/defs-build`. Never a `&str`: a content key never reaches this
/// module.
pub type TagId = u32;

/// An area's id -- today `building_area`/`room_area`'s own row id
/// (Tim's direction: "no new table is needed for this story"). Opaque to
/// this module.
pub type AreaId = u64;

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
/// never by a second evaluator. Three questions only (Tim's direction,
/// PR #294 cycle 1): a same-floor neighbour is [`Direction::step`], never
/// a fourth trait method, since no site could legitimately answer it
/// differently.
pub trait RuleSite {
    /// Every tag `cell` carries, in no particular order.
    fn tags_at(&self, cell: Cell) -> &[TagId];
    /// Every real area that contains `cell`.
    fn areas_containing(&self, cell: Cell) -> &[AreaId];
    /// Every cell tagged `tag`, sorted and deduplicated -- within `area`
    /// when given, or the whole site when `None`. A real implementation
    /// indexes this once rather than rescanning every cell per call --
    /// `testing::SiteBuilder::build` is the worked example.
    fn subjects_in_area(&self, area: Option<AreaId>, tag: TagId) -> &[Cell];
}

/// `mode = "allow" | "forbid"` on a `[[coherence]]` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoherenceMode {
    /// `subject` may only ever appear within a real area that also
    /// contains `within` -- appearing outside every real area, or inside
    /// one that does not contain `within`, is the violation.
    Allow,
    /// `subject` may never appear within a real area that also contains
    /// `within` -- appearing inside one is the violation; appearing
    /// outside every real area never is (there is nothing to forbid
    /// against).
    Forbid,
}

/// `relation = "forbid" | "require"` on an `[[adjacency]]` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdjacencyRelation {
    Forbid,
    Require,
}

/// One term of an adjacency alternative (story 2.9, FR119): `direction`'s
/// same-floor neighbour of the subject cell must (`present: true`) or
/// must not (`present: false`) carry `tag`. An alternative -- a `&[
/// NeighbourTerm]` -- matches when every one of its terms holds;
/// `RuleKind::Adjacency::alternatives` is an list of such alternatives,
/// the engine's one shape for both the terse `b`(+`direction`) row and a
/// hand-authored neighbourhood pattern (a corner, a doorway) --
/// `tools/defs-build` lowers both authoring forms into this at build
/// time, so this engine never special-cases which form a row used
/// (Tim's direction).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NeighbourTerm {
    pub direction: Direction,
    pub tag: TagId,
    pub present: bool,
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
    /// every such area is not checked at all (Crew's decision, pinned by
    /// `placement_container_scoping_outside_any_matching_area_is_not_checked_by_design`:
    /// a container-scoped placement rule says nothing about `subject`
    /// appearing outside its container -- unlike Requirement, a
    /// container here is a *filter* on which cells the rule applies to,
    /// never a completeness demand).
    Placement {
        subject: TagId,
        container: Option<TagId>,
        floor_min: Option<i8>,
        floor_max: Option<i8>,
    },
    /// `subject` at roughly one per `ratio` of `per`, within
    /// `tolerance_percent` (rounded up); no two `subject` cells closer
    /// than `min_spacing` cells (Chebyshev distance) when
    /// `min_spacing > 0`; and every `per` cell within `max_distance`
    /// cells (Chebyshev) of some `subject` cell -- "evenly spread"
    /// (AC2) is the *conjunction* of the spacing floor and this coverage
    /// ceiling: `min_spacing` alone only bounds how close two subjects
    /// may sit, never how far a `per` cell may be from the nearest one,
    /// so a cluster in one corner of an otherwise-empty city can satisfy
    /// `min_spacing` while leaving most of `per` uncovered.
    /// `max_distance` is always positive (`tools/defs-build` refuses
    /// zero). Both measured over the whole site -- a distribution is a
    /// global density, not a per-container one. Zero `per` cells means
    /// the ratio check is vacuously satisfied (never a division by
    /// zero); zero `subject` cells means every `per` cell is
    /// uncovered by construction (nothing to cover it).
    Distribution {
        subject: TagId,
        per: TagId,
        ratio: u32,
        tolerance_percent: u32,
        min_spacing: u32,
        max_distance: u32,
    },
    /// Whether `subject` may (`Allow`) or may never (`Forbid`) appear
    /// within a real area that also contains `within`.
    Coherence {
        subject: TagId,
        within: TagId,
        mode: CoherenceMode,
    },
    /// Whether every `a`-tagged cell must (`Require`) or must never
    /// (`Forbid`) have a same-floor neighbourhood matching one of
    /// `alternatives` -- each alternative a conjunction of
    /// [`NeighbourTerm`]s, the whole list a disjunction ("this pattern,
    /// or this one, or..."). `Require` violates when *no* alternative
    /// matches; `Forbid` violates once per *matching* alternative (a
    /// distinct violating pair per offending neighbour -- Quentin's
    /// direction: never just the first). `tools/defs-build` refuses a
    /// `Forbid` row whose alternatives are anything but a single
    /// `present: true` term each, so a `Forbid` violation's matched
    /// neighbour is always unambiguous (`Violation::other`).
    Adjacency {
        a: TagId,
        relation: AdjacencyRelation,
        alternatives: &'static [&'static [NeighbourTerm]],
    },
    /// Every real area containing a `container`-tagged cell must contain
    /// between `min` and `max` (inclusive, `max` optional) cells tagged
    /// `requires`. Zero `container` cells anywhere is vacuously met --
    /// there is nothing to check (Quentin's boundary case). A
    /// `container` cell that sits in *no* real area at all is itself a
    /// violation, unconditionally (Quentin's decision, pinned by
    /// `requirement_container_outside_any_area_is_itself_a_violation`):
    /// vacuous truth belongs to "zero containers", never to "a container
    /// we have no area to scope `requires` against" -- unlike Placement,
    /// a container here is the thing being demanded of, so "we could not
    /// check it" reads as "it failed", not "it does not apply".
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

/// One rejection: `rule_id`, the offending `subject` cell (Quentin's
/// direction: never a bool, never just the first violation), and --
/// story 2.9 (FR119), Tim's direction -- `other`, the matched neighbour
/// cell for an `Adjacency::Forbid` violation ("the violating pair"
/// AC2 asks for), `None` for every other kind and for `Adjacency::
/// Require` (an absence has no one cell to name). `evaluate` returns
/// every *distinct* violation, sorted by `(rule_id, subject, other)` --
/// a strict total order over three `Ord` fields, deduplicated after
/// sorting -- so output never depends on rule or fact input order
/// (NFR25) and a cell that fails the same rule for two different reasons
/// (e.g. two failing containing areas under Requirement) is reported
/// once, not once per reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Violation {
    pub rule_id: u32,
    pub subject: Cell,
    pub other: Option<Cell>,
}

/// A grid bucket key for a spatial-binning check: `radius` cells per
/// bucket edge, so only a 3x3 neighbourhood of buckets (never the whole
/// cell set) can ever be within `radius` of a given cell -- the "spatial
/// binning, not an all-pairs scan" Quentin's direction asks for, shared
/// by both the spacing and the coverage half of Distribution. `BTreeMap`,
/// never `HashMap` (NFR25: deterministic iteration).
fn bucket_of(cell: Cell, radius: u32) -> (i8, i32, i32) {
    let s = radius.max(1) as i64;
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
                other: None,
            });
        }
        buckets.entry((f, bx, by)).or_default().push(cell);
    }
    violations
}

/// The Distribution kind's coverage half (AC2's "evenly spread", Quentin's
/// direction, PR #294 cycle 1): flags a `per` cell with no `subject` cell
/// within `max_distance` (Chebyshev, same floor) -- catches a
/// clustered-in-one-corner layout `min_spacing` alone cannot, since
/// `min_spacing` only bounds how close two subjects may sit, never how
/// far a `per` cell may be from the nearest one. Bucketed exactly like
/// spacing: only a 3x3 neighbourhood of `max_distance`-sized buckets can
/// ever be close enough, never an all-pairs scan. `subjects` empty means
/// every `per` cell is uncovered by construction (there is nothing to
/// cover it) -- `max_distance == 0` never reaches here (`tools/
/// defs-build` refuses it at build time), but is handled the same total
/// way rather than assumed away.
fn distribution_coverage_violations(
    rule_id: u32,
    subjects: &[Cell],
    per_cells: &[Cell],
    max_distance: u32,
) -> Vec<Violation> {
    if subjects.is_empty() {
        return per_cells
            .iter()
            .map(|&cell| Violation {
                rule_id,
                subject: cell,
                other: None,
            })
            .collect();
    }
    let mut buckets: BTreeMap<(i8, i32, i32), Vec<Cell>> = BTreeMap::new();
    for &s in subjects {
        let key = bucket_of(s, max_distance);
        buckets.entry(key).or_default().push(s);
    }
    let mut violations = Vec::new();
    for &p in per_cells {
        let (f, bx, by) = bucket_of(p, max_distance);
        let mut covered = false;
        'search: for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(nearby) = buckets.get(&(f, bx + dx, by + dy)) {
                    for &s in nearby {
                        if chebyshev(p, s) <= max_distance as i64 {
                            covered = true;
                            break 'search;
                        }
                    }
                }
            }
        }
        if !covered {
            violations.push(Violation {
                rule_id,
                subject: p,
                other: None,
            });
        }
    }
    violations
}

/// Runs every rule in `rules` against `site`, returning every distinct
/// violation found, sorted by `(rule_id, subject)`. Never stops early
/// (Tim's direction): a rule that fails on ten cells reports all ten.
/// `O(rules * entities)`, never `O(rules * entities^2)` -- distribution's
/// spacing and coverage checks use spatial buckets, and every other kind
/// drives its scan off `site.subjects_in_area`, which a real `RuleSite`
/// indexes once rather than rescanning per rule.
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
                for &cell in site.subjects_in_area(None, subject) {
                    if let Some(container_tag) = container {
                        let scoped = site.areas_containing(cell).iter().any(|&area| {
                            !site.subjects_in_area(Some(area), container_tag).is_empty()
                        });
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
                            other: None,
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
                max_distance,
            } => {
                let subjects = site.subjects_in_area(None, subject);
                let per_cells = site.subjects_in_area(None, per);
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
                                other: None,
                            });
                        }
                    }
                }
                violations.extend(distribution_spacing_violations(
                    rule.id,
                    subjects,
                    min_spacing,
                ));
                violations.extend(distribution_coverage_violations(
                    rule.id,
                    subjects,
                    per_cells,
                    max_distance,
                ));
            }
            RuleKind::Coherence {
                subject,
                within,
                mode,
            } => {
                for &cell in site.subjects_in_area(None, subject) {
                    let within_present = site
                        .areas_containing(cell)
                        .iter()
                        .any(|&area| !site.subjects_in_area(Some(area), within).is_empty());
                    let violated = match mode {
                        CoherenceMode::Forbid => within_present,
                        CoherenceMode::Allow => !within_present,
                    };
                    if violated {
                        violations.push(Violation {
                            rule_id: rule.id,
                            subject: cell,
                            other: None,
                        });
                    }
                }
            }
            RuleKind::Adjacency {
                a,
                relation,
                alternatives,
            } => {
                fn alt_matches(site: &impl RuleSite, alt: &[NeighbourTerm], cell: Cell) -> bool {
                    alt.iter().all(|term| {
                        site.tags_at(term.direction.step(cell)).contains(&term.tag) == term.present
                    })
                }
                for &cell in site.subjects_in_area(None, a) {
                    match relation {
                        // No alternative matches this cell's neighbourhood
                        // -- one violation, no single neighbour to name
                        // (`other: None`): an absence is not a pair.
                        AdjacencyRelation::Require => {
                            let satisfied =
                                alternatives.iter().any(|alt| alt_matches(site, alt, cell));
                            if !satisfied {
                                violations.push(Violation {
                                    rule_id: rule.id,
                                    subject: cell,
                                    other: None,
                                });
                            }
                        }
                        // One violation per *matching* alternative --
                        // `tools/defs-build` only ever lowers a `Forbid`
                        // row's alternatives to single `present: true`
                        // terms, so `alt[0]`'s own neighbour is always
                        // the unambiguous violating pair (Tim's
                        // direction).
                        AdjacencyRelation::Forbid => {
                            for alt in alternatives {
                                if alt_matches(site, alt, cell) {
                                    let other = alt.first().map(|t| t.direction.step(cell));
                                    violations.push(Violation {
                                        rule_id: rule.id,
                                        subject: cell,
                                        other,
                                    });
                                }
                            }
                        }
                    }
                }
            }
            RuleKind::Requirement {
                container,
                requires,
                min,
                max,
            } => {
                for &cell in site.subjects_in_area(None, container) {
                    let areas = site.areas_containing(cell);
                    if areas.is_empty() {
                        violations.push(Violation {
                            rule_id: rule.id,
                            subject: cell,
                            other: None,
                        });
                        continue;
                    }
                    for &area in areas {
                        let count = site.subjects_in_area(Some(area), requires).len() as u32;
                        if count < min || max.is_some_and(|m| count > m) {
                            violations.push(Violation {
                                rule_id: rule.id,
                                subject: cell,
                                other: None,
                            });
                        }
                    }
                }
            }
        }
    }
    violations.sort();
    violations.dedup();
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
                subject: c(0, 0, 3),
                other: None
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

    /// Decision (Crew, PR #294 cycle 1, see `RuleKind::Placement`'s own
    /// doc comment): a container-scoped placement rule says nothing
    /// about a `subject` cell outside every area matching `container` --
    /// it is not checked at all, neither pass nor fail.
    #[test]
    fn placement_container_scoping_outside_any_matching_area_is_not_checked_by_design() {
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
            .area(c(1, 1, 5), BUILDING_A)
            .cell(c(9, 9, 0), &[BUILDING])
            .area(c(9, 9, 0), BUILDING_A)
            .build();
        assert_eq!(
            evaluate(&[rule], &inside),
            vec![Violation {
                rule_id: 2,
                subject: c(1, 1, 5),
                other: None
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
                max_distance: 50,
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
        // 4 seating -> expected 2 waste, 0% tolerance; only 1 waste present
        // (placed centrally so it covers every seating cell within
        // max_distance, isolating this fixture to the ratio check alone).
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(10, 0, 0), &[SEATING])
            .cell(c(20, 0, 0), &[SEATING])
            .cell(c(30, 0, 0), &[SEATING])
            .cell(c(15, 0, 0), &[WASTE])
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
                max_distance: 50,
            },
        };
        let violations = evaluate(&[rule], &site);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].rule_id, 3);
        assert_eq!(violations[0].subject, c(15, 0, 0));
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
                max_distance: 200,
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
                max_distance: 50,
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
                subject: c(1, 0, 0),
                other: None
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
                max_distance: 50,
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

    /// AC2's "evenly spread" (Quentin's direction, PR #294 cycle 1):
    /// every `per` cell must be covered by some `subject` cell within
    /// `max_distance`, not merely far enough from its *nearest* sibling
    /// -- `min_spacing` alone would pass this exact layout (the two
    /// subjects are 6 apart, well past a spacing floor of 3), yet the
    /// far corner of `per` cells is left uncovered.
    #[test]
    fn distribution_coverage_violates_when_a_per_cell_has_no_nearby_subject() {
        let rule = RuleDef {
            id: 14,
            key: "waste_covers_seating",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 1,
                tolerance_percent: 100,
                min_spacing: 3,
                max_distance: 5,
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WASTE])
            .cell(c(6, 0, 0), &[WASTE])
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(6, 0, 0), &[SEATING])
            .cell(c(100, 0, 0), &[SEATING])
            .build();
        let violations = evaluate(&[rule], &site);
        assert_eq!(
            violations,
            vec![Violation {
                rule_id: 14,
                subject: c(100, 0, 0),
                other: None
            }]
        );
    }

    #[test]
    fn distribution_coverage_boundary_exactly_at_max_distance_passes_one_past_fails() {
        let rule = RuleDef {
            id: 15,
            key: "waste_covers_seating_boundary",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 1,
                tolerance_percent: 100,
                min_spacing: 0,
                max_distance: 5,
            },
        };
        let at_bound = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WASTE])
            .cell(c(5, 0, 0), &[SEATING])
            .build();
        assert!(evaluate(&[rule], &at_bound).is_empty());

        let one_past = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WASTE])
            .cell(c(6, 0, 0), &[SEATING])
            .build();
        assert_eq!(
            evaluate(&[rule], &one_past),
            vec![Violation {
                rule_id: 15,
                subject: c(6, 0, 0),
                other: None
            }]
        );
    }

    #[test]
    fn distribution_coverage_zero_subjects_leaves_every_per_cell_uncovered() {
        let rule = RuleDef {
            id: 16,
            key: "waste_covers_seating_none_placed",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 1,
                tolerance_percent: 100,
                min_spacing: 0,
                max_distance: 5,
            },
        };
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[SEATING]).build();
        assert_eq!(
            evaluate(&[rule], &site),
            vec![Violation {
                rule_id: 16,
                subject: c(0, 0, 0),
                other: None
            }]
        );
    }

    #[test]
    fn distribution_clustered_in_one_corner_fails_coverage_even_though_spacing_is_satisfied() {
        // Ten subjects, four cells apart (comfortably past a spacing
        // floor of 3), but all packed into one corner of a much larger
        // city -- exactly the "evenly spread" failure AC2 names.
        let rule = RuleDef {
            id: 17,
            key: "waste_spread_corner",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: 1,
                tolerance_percent: 1000,
                min_spacing: 3,
                max_distance: 20,
            },
        };
        let mut builder = SiteBuilder::new();
        for i in 0..10 {
            builder = builder.cell(c(i * 4, 0, 0), &[WASTE]);
        }
        builder = builder
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(490, 0, 0), &[SEATING]);
        let site = builder.build();

        let violations = evaluate(&[rule], &site);
        assert_eq!(
            violations,
            vec![Violation {
                rule_id: 17,
                subject: c(490, 0, 0),
                other: None
            }]
        );
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
                subject: c(0, 0, 0),
                other: None
            }]
        );
    }

    /// Decision (see `CoherenceMode::Forbid`'s own doc comment): a
    /// subject outside every real area has nothing to forbid against.
    #[test]
    fn coherence_forbid_mode_cell_outside_any_area_is_never_a_violation() {
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[SKYSCRAPER]).build();
        assert!(evaluate(&[no_skyscraper_in_villa_district()], &site).is_empty());
    }

    /// Decision (see `CoherenceMode::Allow`'s own doc comment): a
    /// subject outside every real area -- symmetrically -- *is* a
    /// violation under `Allow`, since it can never be "only within" an
    /// area it is not in at all.
    #[test]
    fn coherence_allow_mode_cell_outside_any_area_is_a_violation() {
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
                relation: AdjacencyRelation::Require,
                alternatives: &[&[NeighbourTerm {
                    direction: Direction::North,
                    tag: WALL,
                    present: true,
                }]],
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
                subject: c(0, 1, 0),
                other: None
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
                relation: AdjacencyRelation::Forbid,
                alternatives: &[&[NeighbourTerm {
                    direction: Direction::North,
                    tag: WALL,
                    present: true,
                }]],
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

    /// Story 2.9's own strengthening of AC2: a `Forbid` violation names
    /// `other`, the exact matched neighbour cell -- "the violating pair",
    /// not merely the subject.
    #[test]
    fn adjacency_forbid_violation_names_the_matched_neighbour_as_other() {
        let rule = RuleDef {
            id: 10,
            key: "door_never_faces_wall_north",
            kind: RuleKind::Adjacency {
                a: DOOR,
                relation: AdjacencyRelation::Forbid,
                alternatives: &[&[NeighbourTerm {
                    direction: Direction::North,
                    tag: WALL,
                    present: true,
                }]],
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 0, 0), &[WALL])
            .build();
        assert_eq!(
            evaluate(&[rule], &site),
            vec![Violation {
                rule_id: 10,
                subject: c(0, 1, 0),
                other: Some(c(0, 0, 0)),
            }]
        );
    }

    /// A `Forbid` row with one alternative per direction (the any-side
    /// lowering of a direction-less `b`) reports one violation per
    /// offending side, never just the first -- distinct `other` cells
    /// keep them distinct violations.
    #[test]
    fn adjacency_forbid_reports_one_violation_per_matching_alternative() {
        let rule = RuleDef {
            id: 10,
            key: "no_wall_adjacent",
            kind: RuleKind::Adjacency {
                a: DOOR,
                relation: AdjacencyRelation::Forbid,
                alternatives: &[
                    &[NeighbourTerm {
                        direction: Direction::North,
                        tag: WALL,
                        present: true,
                    }],
                    &[NeighbourTerm {
                        direction: Direction::East,
                        tag: WALL,
                        present: true,
                    }],
                    &[NeighbourTerm {
                        direction: Direction::South,
                        tag: WALL,
                        present: true,
                    }],
                    &[NeighbourTerm {
                        direction: Direction::West,
                        tag: WALL,
                        present: true,
                    }],
                ],
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DOOR])
            .cell(c(0, -1, 0), &[WALL])
            .cell(c(1, 0, 0), &[WALL])
            .build();
        assert_eq!(
            evaluate(&[rule], &site),
            vec![
                Violation {
                    rule_id: 10,
                    subject: c(0, 0, 0),
                    other: Some(c(0, -1, 0)),
                },
                Violation {
                    rule_id: 10,
                    subject: c(0, 0, 0),
                    other: Some(c(1, 0, 0)),
                },
            ]
        );
    }

    #[test]
    fn adjacency_without_a_direction_checks_all_four_neighbours() {
        let rule = RuleDef {
            id: 11,
            key: "door_requires_wall_any_side",
            kind: RuleKind::Adjacency {
                a: DOOR,
                relation: AdjacencyRelation::Require,
                alternatives: &[
                    &[NeighbourTerm {
                        direction: Direction::North,
                        tag: WALL,
                        present: true,
                    }],
                    &[NeighbourTerm {
                        direction: Direction::East,
                        tag: WALL,
                        present: true,
                    }],
                    &[NeighbourTerm {
                        direction: Direction::South,
                        tag: WALL,
                        present: true,
                    }],
                    &[NeighbourTerm {
                        direction: Direction::West,
                        tag: WALL,
                        present: true,
                    }],
                ],
            },
        };
        let wall_to_east = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DOOR])
            .cell(c(1, 0, 0), &[WALL])
            .build();
        assert!(evaluate(&[rule], &wall_to_east).is_empty());
    }

    /// A multi-term alternative (a neighbourhood pattern -- e.g. "wall to
    /// the north AND wall to the south", the shape a corner or doorway
    /// primitive needs) matches only when every one of its terms holds
    /// (story 2.9, AC3).
    #[test]
    fn adjacency_multi_term_alternative_requires_every_term() {
        let rule = RuleDef {
            id: 11,
            key: "door_between_two_walls",
            kind: RuleKind::Adjacency {
                a: DOOR,
                relation: AdjacencyRelation::Require,
                alternatives: &[&[
                    NeighbourTerm {
                        direction: Direction::North,
                        tag: WALL,
                        present: true,
                    },
                    NeighbourTerm {
                        direction: Direction::South,
                        tag: WALL,
                        present: true,
                    },
                ]],
            },
        };
        let only_north = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 0, 0), &[WALL])
            .build();
        assert_eq!(evaluate(&[rule], &only_north).len(), 1);

        let both_sides = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 0, 0), &[WALL])
            .cell(c(0, 2, 0), &[WALL])
            .build();
        assert!(evaluate(&[rule], &both_sides).is_empty());
    }

    /// A `present: false` term matches an *absent* tag -- the shape a
    /// corner primitive needs ("wall to the north, no wall to the
    /// east").
    #[test]
    fn adjacency_present_false_term_matches_an_absent_tag() {
        let rule = RuleDef {
            id: 11,
            key: "door_requires_no_wall_east",
            kind: RuleKind::Adjacency {
                a: DOOR,
                relation: AdjacencyRelation::Require,
                alternatives: &[&[NeighbourTerm {
                    direction: Direction::East,
                    tag: WALL,
                    present: false,
                }]],
            },
        };
        let wall_present = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DOOR])
            .cell(c(1, 0, 0), &[WALL])
            .build();
        assert_eq!(evaluate(&[rule], &wall_present).len(), 1);

        let wall_absent = SiteBuilder::new().cell(c(0, 0, 0), &[DOOR]).build();
        assert!(evaluate(&[rule], &wall_absent).is_empty());
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
                subject: c(0, 0, 0),
                other: None
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

    /// Decision (see `RuleKind::Requirement`'s own doc comment,
    /// Quentin's direction PR #294 cycle 1): a container cell in *no*
    /// real area at all is itself a violation, unconditionally --
    /// including when `min == 0`, where "just count what's in scope"
    /// would otherwise (wrongly) call it satisfied. Vacuous truth belongs
    /// only to "zero container cells exist", never to "we found one but
    /// could not scope it".
    #[test]
    fn requirement_container_outside_any_area_is_itself_a_violation() {
        let rule = RuleDef {
            id: 18,
            key: "dwelling_needs_no_doors_but_needs_an_area",
            kind: RuleKind::Requirement {
                container: DWELLING,
                requires: DOOR,
                min: 0,
                max: None,
            },
        };
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[DWELLING]).build();
        assert_eq!(
            evaluate(&[rule], &site),
            vec![Violation {
                rule_id: 18,
                subject: c(0, 0, 0),
                other: None
            }]
        );
    }

    /// A container cell inside two failing areas (e.g. a room nested in
    /// a building, both scoped as real areas containing it) must be
    /// reported once, not once per failing area (Tim's direction, PR
    /// #294 cycle 1).
    #[test]
    fn requirement_deduplicates_a_container_cell_failing_in_two_areas_at_once() {
        const ROOM_AREA: AreaId = 2;
        let rule = RuleDef {
            id: 19,
            key: "dwelling_needs_a_door_in_every_area",
            kind: RuleKind::Requirement {
                container: DWELLING,
                requires: DOOR,
                min: 1,
                max: None,
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DWELLING])
            .area(c(0, 0, 0), BUILDING_A)
            .area(c(0, 0, 0), ROOM_AREA)
            .build();
        assert_eq!(
            evaluate(&[rule], &site),
            vec![Violation {
                rule_id: 19,
                subject: c(0, 0, 0),
                other: None
            }]
        );
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
                    subject: c(1, 0, 3),
                    other: None
                },
                Violation {
                    rule_id: 1,
                    subject: c(5, 0, 3),
                    other: None
                },
                Violation {
                    rule_id: 2,
                    subject: c(1, 0, 3),
                    other: None
                },
                Violation {
                    rule_id: 2,
                    subject: c(5, 0, 3),
                    other: None
                },
            ]
        );
    }
}
