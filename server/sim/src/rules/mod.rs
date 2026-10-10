//! The generic rule engine (FR111/FR112, story 2.10). One evaluator, one
//! rule table (`sim::generated::defs::RULES`), reachable only through
//! [`RuleSet`] (story 2.11): Epic 3's generator asks "is this candidate
//! legal" by calling [`evaluate`] against a hypothetical placement,
//! `sim::validation::validate` calls it against persisted output, and
//! there is never a second function that decides whether a rule holds --
//! that is how FR112's "one source" becomes a property rather than a
//! promise (Tim's direction). [`evaluate`] takes a [`RuleSet`], never a
//! bare slice: a caller can wrap the committed table
//! ([`RuleSet::committed`]) or, under test, an arbitrary one
//! ([`RuleSet::for_test`]), but nothing outside `source`'s own module can
//! construct a `RuleSet` any other way.
//!
//! The engine never sees a content key ("flying_saucer", "villa_district"): it
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
//! real geometry -- `sim::rules::testing::Site`, `world::fixture`,
//! `sim::validation::PlacedSite` (story 2.11, over a real placed-object
//! block) today, and Epic 3's generator state later, all answering the
//! same three questions over integer geometry: what tags a cell carries,
//! which areas contain it, and which subjects
//! an area (or the whole site) contains. A same-floor neighbour is never
//! asked of a `RuleSite` -- [`Direction::step`] is pure arithmetic no
//! implementation could legitimately answer differently, so it is not a
//! seam at all. No `HashMap`, no floats (NFR25): "roughly one per N,
//! evenly spread" is an integer ratio, an integer tolerance percent, an
//! integer minimum spacing and an integer maximum coverage distance, all
//! fields on the row, never constants here.

use std::collections::BTreeMap;

mod source;
#[cfg(feature = "test-fixtures")]
pub mod testing;

pub use source::RuleSet;

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
/// by [`testing::Site`], by `world::fixture`, by `sim::validation::
/// PlacedSite` (story 2.11) and, later, by Epic 3's generator state --
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
    /// The value of neighbourhood `parameter` at `cell`, `None` when this
    /// site carries none -- what a catchment row that reads a parameter
    /// averages over its `per` cells. Defaults to `None`: only a site that
    /// has authored the parameters answers.
    fn parameter_at(&self, _cell: Cell, _parameter: Parameter) -> Option<i32> {
        None
    }
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

/// A `Distribution` row's judging scope (story 3.7): the whole site, or
/// each fixed-extent, world-absolute square ([`catchment_of`]) on its own.
/// Data on the row -- `scope = "catchment"` in `defs/rules/*.toml`, with
/// `extent_cells` copied from `generation.catchment_extent_cells` by
/// `tools/defs-build` -- never a sixth kind and never a per-key branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DistributionScope {
    /// One verdict over the whole site: ratio, spacing and coverage.
    Site,
    /// One verdict per catchment of `extent_cells` x `extent_cells`
    /// world cells, anchored to world-absolute coordinates.
    Catchment { extent_cells: i32 },
}

/// The catchment `(cx, cy)` containing world-absolute `(x, y)` --
/// `div_euclid`, so every cell belongs to exactly one catchment and a
/// grown site never re-tiles an old one. The one definition: the
/// evaluator, the generator and the evidence renderer all call this.
pub fn catchment_of(x: i32, y: i32, extent_cells: i32) -> (i32, i32) {
    let extent = extent_cells.max(1);
    (x.div_euclid(extent), y.div_euclid(extent))
}

/// A neighbourhood parameter a catchment-scoped `Distribution` row may read
/// (story 3.7, FR113): the sim's own quantities, never a content key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Parameter {
    BuildingAge,
    Affluence,
}

/// A row's two-ended ratio read against one parameter: `ratio_at_min` where
/// the parameter sits at `min`, `ratio_at_max` at `max`, integer-interpolated
/// on the catchment's own mean of the parameter over its `per` cells -- the
/// idiom `block_size_min/max_cells` already uses. Data on the row: no curve,
/// no expression, no per-key branch. `min`/`max` are copied from the
/// parameter's own balance range by `tools/defs-build`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParameterRead {
    pub parameter: Parameter,
    pub ratio_at_min: u32,
    pub ratio_at_max: u32,
    pub min: i32,
    pub max: i32,
}

impl ParameterRead {
    /// The ratio at parameter value `value`, clamped to the parameter's
    /// range, never below 1.
    pub fn ratio_at(&self, value: i32) -> u32 {
        let span = (self.max - self.min).max(1) as i64;
        let v = (value.clamp(self.min, self.max) - self.min) as i64;
        let (lo, hi) = (self.ratio_at_min as i64, self.ratio_at_max as i64);
        (lo + (hi - lo) * v / span).max(1) as u32
    }
}

/// A row's ratio: one number, or a two-ended pair read against one
/// parameter. A reading row has no stand-in constant to fall back on: a site
/// that reports no value for it is a harness defect, never judged at an
/// invented number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowRatio {
    Fixed(u32),
    Read(ParameterRead),
}

impl RowRatio {
    /// The smallest ratio the row can owe by -- the ceiling's denominator.
    pub fn smallest(&self) -> u32 {
        match self {
            RowRatio::Fixed(n) => (*n).max(1),
            RowRatio::Read(r) => r.ratio_at_min.min(r.ratio_at_max).max(1),
        }
    }
}

/// What a row owes one scope (the whole site, or one catchment).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target {
    /// `per` cells in the scope.
    pub per: u64,
    /// The ratio the scope owes by (read from the scope's own mean when
    /// the row reads a parameter).
    pub ratio: u32,
    pub expected: u64,
    pub lower: u64,
    pub upper: u64,
}

/// `(expected, lower, upper)` over `basis` `per` cells. `tolerance_percent`
/// (rounded up) widens the upper bound; the lower bound sheds it only for a
/// whole-site row -- a catchment owes `expected` itself, undiscounted, so
/// the floor bites where it is owed. A catchment's ceiling is at least one
/// above `expected`: a subject that replaces a `per` member shrinks its own
/// basis by one, and the count it was allocated on the larger basis must
/// still be within bounds on the remaining one.
fn bounds(basis: u64, ratio: u32, tolerance_percent: u32, catchment: bool) -> (u64, u64, u64) {
    let expected = basis / (ratio.max(1) as u64);
    let tolerance = (expected * tolerance_percent as u64).div_ceil(100);
    if catchment {
        (expected, expected, expected + tolerance.max(1))
    } else {
        (
            expected,
            expected.saturating_sub(tolerance),
            expected + tolerance,
        )
    }
}

/// A whole-site row's `(expected, lower, upper)` over `basis` -- for the
/// callers that hold only a count (`DistributionRow::targets` is the one
/// function for everything scoped).
pub fn distribution_target(basis: u64, ratio: u32, tolerance_percent: u32) -> (u64, u64, u64) {
    bounds(basis, ratio, tolerance_percent, false)
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
    /// zero). Measured over the whole site under [`DistributionScope::
    /// Site`], or per catchment under [`DistributionScope::Catchment`]:
    /// ratio and coverage judged inside each catchment from that
    /// catchment's own cells only (coverage from a neighbouring catchment
    /// does not count; a catchment holding no subject is judged by the
    /// ratio's lower bound alone), spacing still pairwise across a
    /// catchment line,
    /// each violation reported in the later catchment's verdict
    /// (`(cx, cy)` order) so ground added later never moves an earlier
    /// catchment's verdict. Zero `per` cells means
    /// the ratio check is vacuously satisfied (never a division by
    /// zero); zero `subject` cells means every `per` cell is
    /// uncovered by construction (nothing to cover it).
    Distribution {
        subject: TagId,
        per: TagId,
        ratio: RowRatio,
        tolerance_percent: u32,
        min_spacing: u32,
        max_distance: u32,
        scope: DistributionScope,
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

/// A `Distribution` row's own fields, read-only (story 3.4) -- for the
/// one caller outside this module that legitimately needs a row's own
/// ratio/spacing/coverage numbers to place candidates constructively
/// (Epic 3's `sim::generation::building_types`, which places distributed
/// types *before* the whole-site `evaluate` verdict can run at all).
/// [`RuleDef::as_distribution`] is this module's one seam for that: it
/// narrows to the one kind and never hands back `RuleKind` itself, so
/// `RuleKind` still never has to appear in a `src/` file outside this
/// module (`check-rule-source.sh`) -- a caller reads a row's own
/// numbers, it never gets to match on the engine's closed kind enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DistributionRow {
    pub id: u32,
    pub key: &'static str,
    pub subject: TagId,
    pub per: TagId,
    pub ratio: RowRatio,
    pub tolerance_percent: u32,
    pub min_spacing: u32,
    pub max_distance: u32,
    pub scope: DistributionScope,
}

impl DistributionRow {
    /// What this row owes each scope over `per_cells` -- each `per` cell
    /// with the value of the parameter the row reads there (`None` for a
    /// row that reads none). Keyed `None` for a site row (one entry) and by
    /// catchment for a catchment row. The one function the evaluator, the
    /// generator, the evidence and the harness all call; none repeats the
    /// grouping, the mean or the arithmetic.
    ///
    /// # Panics
    /// If the row reads a parameter and a `per` cell reports none: that is
    /// a harness defect, named by the rule's key.
    pub fn targets(
        &self,
        per_cells: impl IntoIterator<Item = (Cell, Option<i32>)>,
    ) -> BTreeMap<Option<(i32, i32)>, Target> {
        let mut groups: BTreeMap<Option<(i32, i32)>, (u64, i64, u64)> = BTreeMap::new();
        for (cell, value) in per_cells {
            let key = match self.scope {
                DistributionScope::Site => None,
                DistributionScope::Catchment { extent_cells } => {
                    Some(catchment_of(cell.x, cell.y, extent_cells))
                }
            };
            let g = groups.entry(key).or_default();
            g.0 += 1;
            if let Some(v) = value {
                g.1 += v as i64;
                g.2 += 1;
            }
        }
        let catchment = matches!(self.scope, DistributionScope::Catchment { .. });
        groups
            .into_iter()
            .map(|(key, (per, sum, reported))| {
                let ratio = match self.ratio {
                    RowRatio::Fixed(n) => n,
                    RowRatio::Read(read) => {
                        assert!(
                            reported == per && per > 0,
                            "rule '{}' reads {:?} but {} of its {per} per cells report none -- a harness defect, not a stand-in ratio",
                            self.key,
                            read.parameter,
                            per - reported
                        );
                        read.ratio_at((sum / per as i64) as i32)
                    }
                };
                let (expected, lower, upper) =
                    bounds(per, ratio, self.tolerance_percent, catchment);
                (
                    key,
                    Target {
                        per,
                        ratio,
                        expected,
                        lower,
                        upper,
                    },
                )
            })
            .collect()
    }
}

/// A `Coherence` row's own fields, read-only (PR #317 cycle 3) -- the
/// same seam [`DistributionRow`] gives `sim::generation::building_types`,
/// for the one caller outside this module that legitimately needs a
/// row's own subject/within tags without ever matching on `RuleKind`
/// itself: `bounds::generation_evidence`'s own structural (never
/// tag-name-hashed) tint classes read a coherence row's two named
/// extremes the same generic way it reads a distribution row's subject.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoherenceRow {
    pub id: u32,
    pub key: &'static str,
    pub subject: TagId,
    pub within: TagId,
    pub mode: CoherenceMode,
}

impl RuleDef {
    /// One stable text line carrying every field of this row, for the
    /// generation-inputs fingerprint (`bounds::generation_stamp`). Every
    /// struct and enum is destructured exhaustively (no `..`), so a new
    /// field or kind fails to compile until it is decided whether it is
    /// hashed -- and the text never depends on `Debug`'s format.
    pub fn canonical_line(&self) -> String {
        let RuleDef { id, key, kind } = *self;
        let body = match kind {
            RuleKind::Placement {
                subject,
                container,
                floor_min,
                floor_max,
            } => format!(
                "placement subject={subject} container={container:?} floor_min={floor_min:?} floor_max={floor_max:?}"
            ),
            RuleKind::Distribution {
                subject,
                per,
                ratio,
                tolerance_percent,
                min_spacing,
                max_distance,
                scope,
            } => {
                let ratio = match ratio {
                    RowRatio::Fixed(n) => format!("fixed({n})"),
                    RowRatio::Read(ParameterRead {
                        parameter,
                        ratio_at_min,
                        ratio_at_max,
                        min,
                        max,
                    }) => {
                        let parameter = match parameter {
                            Parameter::BuildingAge => "building_age",
                            Parameter::Affluence => "affluence",
                        };
                        format!("read({parameter},{ratio_at_min},{ratio_at_max},{min},{max})")
                    }
                };
                let scope = match scope {
                    DistributionScope::Site => "site".to_string(),
                    DistributionScope::Catchment { extent_cells } => {
                        format!("catchment({extent_cells})")
                    }
                };
                format!(
                    "distribution subject={subject} per={per} ratio={ratio} tolerance_percent={tolerance_percent} min_spacing={min_spacing} max_distance={max_distance} scope={scope}"
                )
            }
            RuleKind::Coherence {
                subject,
                within,
                mode,
            } => {
                let mode = match mode {
                    CoherenceMode::Allow => "allow",
                    CoherenceMode::Forbid => "forbid",
                };
                format!("coherence subject={subject} within={within} mode={mode}")
            }
            RuleKind::Adjacency {
                a,
                relation,
                alternatives,
            } => {
                let relation = match relation {
                    AdjacencyRelation::Forbid => "forbid",
                    AdjacencyRelation::Require => "require",
                };
                let alternatives: Vec<String> = alternatives
                    .iter()
                    .map(|terms| {
                        terms
                            .iter()
                            .map(
                                |&NeighbourTerm {
                                     direction,
                                     tag,
                                     present,
                                 }| {
                                    let direction = match direction {
                                        Direction::North => "n",
                                        Direction::East => "e",
                                        Direction::South => "s",
                                        Direction::West => "w",
                                    };
                                    format!("{direction}{}{tag}", if present { "+" } else { "-" })
                                },
                            )
                            .collect::<Vec<_>>()
                            .join(",")
                    })
                    .collect();
                format!(
                    "adjacency a={a} relation={relation} alternatives=[{}]",
                    alternatives.join("|")
                )
            }
            RuleKind::Requirement {
                container,
                requires,
                min,
                max,
            } => format!(
                "requirement container={container} requires={requires} min={min} max={max:?}"
            ),
        };
        format!("{id}:{key}:{body}")
    }

    /// `Some` iff this row is a `Distribution` row; `None` for every
    /// other kind. The one place outside `evaluate` itself that reads
    /// into `RuleKind`.
    pub fn as_distribution(&self) -> Option<DistributionRow> {
        match self.kind {
            RuleKind::Distribution {
                subject,
                per,
                ratio,
                tolerance_percent,
                min_spacing,
                max_distance,
                scope,
            } => Some(DistributionRow {
                id: self.id,
                key: self.key,
                subject,
                per,
                ratio,
                tolerance_percent,
                min_spacing,
                max_distance,
                scope,
            }),
            RuleKind::Placement { .. }
            | RuleKind::Coherence { .. }
            | RuleKind::Adjacency { .. }
            | RuleKind::Requirement { .. } => None,
        }
    }

    /// `Some` iff this row is a `Coherence` row; `None` for every other
    /// kind -- [`CoherenceRow`]'s own doc comment.
    pub fn as_coherence(&self) -> Option<CoherenceRow> {
        match self.kind {
            RuleKind::Coherence {
                subject,
                within,
                mode,
            } => Some(CoherenceRow {
                id: self.id,
                key: self.key,
                subject,
                within,
                mode,
            }),
            RuleKind::Placement { .. }
            | RuleKind::Distribution { .. }
            | RuleKind::Adjacency { .. }
            | RuleKind::Requirement { .. } => None,
        }
    }
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
    /// The catchment a [`DistributionScope::Catchment`] row judged this
    /// violation in; `None` for every other row, so their output is
    /// exactly what it was before scoping existed. Last field: it sorts
    /// after the three above, never reordering an unscoped row's output.
    pub catchment: Option<(i32, i32)>,
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
    scope: DistributionScope,
) -> Vec<Violation> {
    if min_spacing == 0 {
        return Vec::new();
    }
    // Site scope blames the later cell of a too-close pair (one violation
    // per such cell, once deduplicated). Catchment scope judges only pairs
    // inside one catchment -- ground added beside a catchment, on any side,
    // never moves its verdict -- and blames the later cell, naming the
    // catchment. (The generator keeps clear of subjects across the line too,
    // which is stricter than this check.)
    let blame = |cell: Cell, other: Cell| -> Option<Violation> {
        match scope {
            DistributionScope::Site => Some(Violation {
                rule_id,
                subject: cell,
                other: None,
                catchment: None,
            }),
            DistributionScope::Catchment { extent_cells } => {
                let c = catchment_of(cell.x, cell.y, extent_cells);
                (c == catchment_of(other.x, other.y, extent_cells)).then_some(Violation {
                    rule_id,
                    subject: cell,
                    other: None,
                    catchment: Some(c),
                })
            }
        }
    };
    let mut violations = Vec::new();
    let mut buckets: BTreeMap<(i8, i32, i32), Vec<Cell>> = BTreeMap::new();
    for &cell in subjects {
        let (f, bx, by) = bucket_of(cell, min_spacing);
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(placed) = buckets.get(&(f, bx + dx, by + dy)) {
                    for &other in placed {
                        if chebyshev(cell, other) < min_spacing as i64 {
                            violations.extend(blame(cell, other));
                        }
                    }
                }
            }
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
                catchment: None,
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
                catchment: None,
            });
        }
    }
    violations
}

/// The ratio and coverage halves of one Distribution verdict over
/// `subjects` and `per_cells` -- the whole site, or one catchment's own
/// cells (`catchment` names it on every violation reported).
fn distribution_judge(
    rule_id: u32,
    subjects: &[Cell],
    per_cells: &[Cell],
    (lower, upper, max_distance): (u64, u64, u32),
    catchment: Option<(i32, i32)>,
) -> Vec<Violation> {
    let mut violations = Vec::new();
    let basis = per_cells.len() as u64;
    if basis > 0 {
        let actual = subjects.len() as u64;
        if actual < lower || actual > upper {
            let anchor = subjects.first().copied().or(per_cells.first().copied());
            if let Some(anchor) = anchor {
                violations.push(Violation {
                    rule_id,
                    subject: anchor,
                    other: None,
                    catchment,
                });
            }
        }
    }
    // A catchment holding no subject is judged by the ratio's lower bound
    // alone -- a row that tolerates it (`lower == 0`) does not also have
    // every dwelling reported uncovered; one that does not is already
    // reported above. The whole site is never exempt.
    if catchment.is_none() || !subjects.is_empty() {
        violations.extend(distribution_coverage_violations(
            rule_id,
            subjects,
            per_cells,
            max_distance,
        ));
    }
    for v in &mut violations {
        v.catchment = catchment;
    }
    violations
}

/// Runs every rule in `rules` against `site`, returning every distinct
/// violation found, sorted by `(rule_id, subject)`. Never stops early
/// (Tim's direction): a rule that fails on ten cells reports all ten.
/// `O(rules * entities)`, never `O(rules * entities^2)` -- distribution's
/// spacing and coverage checks use spatial buckets, and every other kind
/// drives its scan off `site.subjects_in_area`, which a real `RuleSite`
/// indexes once rather than rescanning per rule. `rules` is a
/// [`RuleSet`], never a bare slice (FR112, story 2.11): the only two ways
/// to build one are [`RuleSet::committed`] and, under test,
/// [`RuleSet::for_test`].
pub fn evaluate(rules: RuleSet<'_>, site: &impl RuleSite) -> Vec<Violation> {
    let mut violations = Vec::new();
    for rule in rules.rules() {
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
                            catchment: None,
                        });
                    }
                }
            }
            RuleKind::Distribution {
                subject,
                per,
                min_spacing,
                max_distance,
                scope,
                ..
            } => {
                let row = rule
                    .as_distribution()
                    .expect("a Distribution rule is a distribution row");
                let subjects = site.subjects_in_area(None, subject);
                let per_cells = site.subjects_in_area(None, per);
                let read = match row.ratio {
                    RowRatio::Read(r) => Some(r.parameter),
                    RowRatio::Fixed(_) => None,
                };
                let targets = row.targets(
                    per_cells
                        .iter()
                        .map(|&c| (c, read.and_then(|p| site.parameter_at(c, p)))),
                );
                let group = |cells: &[Cell]| {
                    let mut by: BTreeMap<Option<(i32, i32)>, Vec<Cell>> = BTreeMap::new();
                    for &c in cells {
                        let key = match scope {
                            DistributionScope::Site => None,
                            DistributionScope::Catchment { extent_cells } => {
                                Some(catchment_of(c.x, c.y, extent_cells))
                            }
                        };
                        by.entry(key).or_default().push(c);
                    }
                    by
                };
                let subjects_by = group(subjects);
                let per_by = group(per_cells);
                // A site row with no `per` cell is vacuously satisfied.
                for (key, per_in) in &per_by {
                    let t = targets[key];
                    let subjects_in = subjects_by.get(key).map(Vec::as_slice).unwrap_or(&[]);
                    violations.extend(distribution_judge(
                        rule.id,
                        subjects_in,
                        per_in,
                        (t.lower, t.upper, max_distance),
                        *key,
                    ));
                }
                violations.extend(distribution_spacing_violations(
                    rule.id,
                    subjects,
                    min_spacing,
                    scope,
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
                            catchment: None,
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
                                    catchment: None,
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
                                        catchment: None,
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
                            catchment: None,
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
                                catchment: None,
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

    fn line(kind: RuleKind) -> String {
        RuleDef {
            id: 1,
            key: "r",
            kind,
        }
        .canonical_line()
    }

    #[test]
    fn canonical_line_changes_with_every_field_of_a_placement_row() {
        let base = |c, a, b| RuleKind::Placement {
            subject: 1,
            container: c,
            floor_min: a,
            floor_max: b,
        };
        let l = line(base(None, None, None));
        assert_ne!(l, line(base(Some(2), None, None)));
        assert_ne!(l, line(base(None, Some(0), None)));
        assert_ne!(l, line(base(None, None, Some(3))));
    }

    fn dist(
        ratio: RowRatio,
        tolerance_percent: u32,
        min_spacing: u32,
        max_distance: u32,
        scope: DistributionScope,
    ) -> RuleKind {
        RuleKind::Distribution {
            subject: 1,
            per: 2,
            ratio,
            tolerance_percent,
            min_spacing,
            max_distance,
            scope,
        }
    }

    #[test]
    fn canonical_line_changes_with_every_field_of_a_distribution_row() {
        let site = DistributionScope::Site;
        let l = line(dist(RowRatio::Fixed(10), 25, 0, 0, site));
        let read = |max| {
            RowRatio::Read(ParameterRead {
                parameter: Parameter::Affluence,
                ratio_at_min: 5,
                ratio_at_max: 10,
                min: 0,
                max,
            })
        };
        for other in [
            dist(RowRatio::Fixed(11), 25, 0, 0, site),
            dist(RowRatio::Fixed(10), 26, 0, 0, site),
            dist(RowRatio::Fixed(10), 25, 1, 0, site),
            dist(RowRatio::Fixed(10), 25, 0, 1, site),
            dist(
                RowRatio::Fixed(10),
                25,
                0,
                0,
                DistributionScope::Catchment { extent_cells: 8 },
            ),
            dist(read(100), 25, 0, 0, site),
        ] {
            assert_ne!(l, line(other));
        }
        assert_ne!(
            line(dist(read(100), 25, 0, 0, site)),
            line(dist(read(101), 25, 0, 0, site))
        );
    }

    #[test]
    fn canonical_line_changes_with_every_field_of_the_other_kinds() {
        let coherence = |mode| RuleKind::Coherence {
            subject: 1,
            within: 2,
            mode,
        };
        assert_ne!(
            line(coherence(CoherenceMode::Allow)),
            line(coherence(CoherenceMode::Forbid))
        );
        static TERMS: [NeighbourTerm; 1] = [NeighbourTerm {
            direction: Direction::North,
            tag: 3,
            present: true,
        }];
        static OTHER: [NeighbourTerm; 1] = [NeighbourTerm {
            direction: Direction::North,
            tag: 3,
            present: false,
        }];
        static ALTS: [&[NeighbourTerm]; 1] = [&TERMS];
        static OTHER_ALTS: [&[NeighbourTerm]; 1] = [&OTHER];
        let adjacency = |relation, alternatives| RuleKind::Adjacency {
            a: 1,
            relation,
            alternatives,
        };
        let l = line(adjacency(AdjacencyRelation::Forbid, &ALTS));
        assert_ne!(l, line(adjacency(AdjacencyRelation::Require, &ALTS)));
        assert_ne!(l, line(adjacency(AdjacencyRelation::Forbid, &OTHER_ALTS)));
        let requirement = |min, max| RuleKind::Requirement {
            container: 1,
            requires: 2,
            min,
            max,
        };
        let l = line(requirement(1, None));
        assert_ne!(l, line(requirement(2, None)));
        assert_ne!(l, line(requirement(1, Some(3))));
    }

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
        assert_eq!(
            evaluate(RuleSet::for_test(&[no_cafe_above_floor_2()]), &site),
            vec![]
        );
    }

    #[test]
    fn placement_violated_fixture_names_the_rule_and_the_cell() {
        let site = SiteBuilder::new().cell(c(0, 0, 3), &[CAFE]).build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[no_cafe_above_floor_2()]), &site),
            vec![Violation {
                rule_id: 1,
                subject: c(0, 0, 3),
                other: None,
                catchment: None
            }]
        );
    }

    #[test]
    fn placement_boundary_floor_equal_to_max_passes_max_plus_one_fails() {
        let at_max = SiteBuilder::new().cell(c(0, 0, 2), &[CAFE]).build();
        assert!(evaluate(RuleSet::for_test(&[no_cafe_above_floor_2()]), &at_max).is_empty());

        let over_max = SiteBuilder::new().cell(c(0, 0, 3), &[CAFE]).build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[no_cafe_above_floor_2()]), &over_max).len(),
            1
        );
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
        assert!(evaluate(RuleSet::for_test(&[rule]), &outside).is_empty());

        // Inside a building area tagged BUILDING, above floor 2: violates.
        let inside = SiteBuilder::new()
            .cell(c(1, 1, 5), &[CAFE])
            .area(c(1, 1, 5), BUILDING_A)
            .cell(c(9, 9, 0), &[BUILDING])
            .area(c(9, 9, 0), BUILDING_A)
            .build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[rule]), &inside),
            vec![Violation {
                rule_id: 2,
                subject: c(1, 1, 5),
                other: None,
                catchment: None
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
                ratio: RowRatio::Fixed(2),
                tolerance_percent: 0,
                min_spacing: 3,
                max_distance: 50,
                scope: DistributionScope::Site,
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
        assert_eq!(
            evaluate(RuleSet::for_test(&[one_waste_per_2_seating()]), &site),
            vec![]
        );
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
                ratio: RowRatio::Fixed(2),
                tolerance_percent: 0,
                min_spacing: 0,
                max_distance: 50,
                scope: DistributionScope::Site,
            },
        };
        let violations = evaluate(RuleSet::for_test(&[rule]), &site);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].rule_id, 3);
        assert_eq!(violations[0].subject, c(15, 0, 0));
    }

    #[test]
    fn distribution_boundary_zero_per_cells_never_divides_by_zero() {
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[WASTE]).build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[one_waste_per_2_seating()]), &site),
            vec![]
        );
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
                ratio: RowRatio::Fixed(2),
                tolerance_percent: 50,
                min_spacing: 0,
                max_distance: 200,
                scope: DistributionScope::Site,
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
        assert!(evaluate(RuleSet::for_test(&[rule]), &at_tolerance).is_empty());

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
        assert_eq!(
            evaluate(RuleSet::for_test(&[rule]), &past_tolerance).len(),
            1
        );
    }

    #[test]
    fn distribution_spacing_violates_when_two_subjects_land_too_close() {
        let rule = RuleDef {
            id: 5,
            key: "waste_spread",
            kind: RuleKind::Distribution {
                subject: WASTE,
                per: SEATING,
                ratio: RowRatio::Fixed(1),
                tolerance_percent: 100,
                min_spacing: 5,
                max_distance: 50,
                scope: DistributionScope::Site,
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[SEATING, WASTE])
            .cell(c(1, 0, 0), &[WASTE])
            .build();
        let violations = evaluate(RuleSet::for_test(&[rule]), &site);
        assert_eq!(
            violations,
            vec![Violation {
                rule_id: 5,
                subject: c(1, 0, 0),
                other: None,
                catchment: None
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
                ratio: RowRatio::Fixed(1),
                tolerance_percent: 0,
                min_spacing: 4,
                max_distance: 50,
                scope: DistributionScope::Site,
            },
        };
        let mut builder = SiteBuilder::new();
        for i in 0..5 {
            builder = builder
                .cell(c(i * 10, 0, 0), &[WASTE])
                .cell(c(i * 10, 0, 0), &[SEATING]);
        }
        let site = builder.build();
        assert!(evaluate(RuleSet::for_test(&[rule]), &site).is_empty());
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
                ratio: RowRatio::Fixed(1),
                tolerance_percent: 100,
                min_spacing: 3,
                max_distance: 5,
                scope: DistributionScope::Site,
            },
        };
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WASTE])
            .cell(c(6, 0, 0), &[WASTE])
            .cell(c(0, 0, 0), &[SEATING])
            .cell(c(6, 0, 0), &[SEATING])
            .cell(c(100, 0, 0), &[SEATING])
            .build();
        let violations = evaluate(RuleSet::for_test(&[rule]), &site);
        assert_eq!(
            violations,
            vec![Violation {
                rule_id: 14,
                subject: c(100, 0, 0),
                other: None,
                catchment: None
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
                ratio: RowRatio::Fixed(1),
                tolerance_percent: 100,
                min_spacing: 0,
                max_distance: 5,
                scope: DistributionScope::Site,
            },
        };
        let at_bound = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WASTE])
            .cell(c(5, 0, 0), &[SEATING])
            .build();
        assert!(evaluate(RuleSet::for_test(&[rule]), &at_bound).is_empty());

        let one_past = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WASTE])
            .cell(c(6, 0, 0), &[SEATING])
            .build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[rule]), &one_past),
            vec![Violation {
                rule_id: 15,
                subject: c(6, 0, 0),
                other: None,
                catchment: None
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
                ratio: RowRatio::Fixed(1),
                tolerance_percent: 100,
                min_spacing: 0,
                max_distance: 5,
                scope: DistributionScope::Site,
            },
        };
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[SEATING]).build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[rule]), &site),
            vec![Violation {
                rule_id: 16,
                subject: c(0, 0, 0),
                other: None,
                catchment: None
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
                ratio: RowRatio::Fixed(1),
                tolerance_percent: 1000,
                min_spacing: 3,
                max_distance: 20,
                scope: DistributionScope::Site,
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

        let violations = evaluate(RuleSet::for_test(&[rule]), &site);
        assert_eq!(
            violations,
            vec![Violation {
                rule_id: 17,
                subject: c(490, 0, 0),
                other: None,
                catchment: None
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
            evaluate(
                RuleSet::for_test(&[no_skyscraper_in_villa_district()]),
                &site
            ),
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
            evaluate(
                RuleSet::for_test(&[no_skyscraper_in_villa_district()]),
                &site
            ),
            vec![Violation {
                rule_id: 7,
                subject: c(0, 0, 0),
                other: None,
                catchment: None
            }]
        );
    }

    /// Decision (see `CoherenceMode::Forbid`'s own doc comment): a
    /// subject outside every real area has nothing to forbid against.
    #[test]
    fn coherence_forbid_mode_cell_outside_any_area_is_never_a_violation() {
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[SKYSCRAPER]).build();
        assert!(
            evaluate(
                RuleSet::for_test(&[no_skyscraper_in_villa_district()]),
                &site
            )
            .is_empty()
        );
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
        assert_eq!(evaluate(RuleSet::for_test(&[rule]), &outside).len(), 1);

        let inside = SiteBuilder::new()
            .cell(c(0, 0, 0), &[WALL])
            .area(c(0, 0, 0), BUILDING_A)
            .cell(c(1, 1, 0), &[ROOM])
            .area(c(1, 1, 0), BUILDING_A)
            .build();
        assert!(evaluate(RuleSet::for_test(&[rule]), &inside).is_empty());
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
            evaluate(
                RuleSet::for_test(&[door_requires_wall_to_the_north()]),
                &site
            ),
            vec![]
        );
    }

    #[test]
    fn adjacency_violated_fixture_names_the_rule_and_the_cell() {
        let site = SiteBuilder::new().cell(c(0, 1, 0), &[DOOR]).build();
        assert_eq!(
            evaluate(
                RuleSet::for_test(&[door_requires_wall_to_the_north()]),
                &site
            ),
            vec![Violation {
                rule_id: 9,
                subject: c(0, 1, 0),
                other: None,
                catchment: None
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
            evaluate(
                RuleSet::for_test(&[door_requires_wall_to_the_north()]),
                &site
            )
            .len(),
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
        assert!(evaluate(RuleSet::for_test(&[rule]), &wall_to_south).is_empty());

        let wall_to_north = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 0, 0), &[WALL])
            .build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[rule]), &wall_to_north).len(),
            1
        );
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
            evaluate(RuleSet::for_test(&[rule]), &site),
            vec![Violation {
                rule_id: 10,
                subject: c(0, 1, 0),
                other: Some(c(0, 0, 0)),
                catchment: None,
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
            evaluate(RuleSet::for_test(&[rule]), &site),
            vec![
                Violation {
                    rule_id: 10,
                    subject: c(0, 0, 0),
                    other: Some(c(0, -1, 0)),
                    catchment: None,
                },
                Violation {
                    rule_id: 10,
                    subject: c(0, 0, 0),
                    other: Some(c(1, 0, 0)),
                    catchment: None,
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
        assert!(evaluate(RuleSet::for_test(&[rule]), &wall_to_east).is_empty());
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
        assert_eq!(evaluate(RuleSet::for_test(&[rule]), &only_north).len(), 1);

        let both_sides = SiteBuilder::new()
            .cell(c(0, 1, 0), &[DOOR])
            .cell(c(0, 0, 0), &[WALL])
            .cell(c(0, 2, 0), &[WALL])
            .build();
        assert!(evaluate(RuleSet::for_test(&[rule]), &both_sides).is_empty());
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
        assert_eq!(evaluate(RuleSet::for_test(&[rule]), &wall_present).len(), 1);

        let wall_absent = SiteBuilder::new().cell(c(0, 0, 0), &[DOOR]).build();
        assert!(evaluate(RuleSet::for_test(&[rule]), &wall_absent).is_empty());
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
        assert_eq!(
            evaluate(RuleSet::for_test(&[every_dwelling_has_a_door()]), &site),
            vec![]
        );
    }

    #[test]
    fn requirement_violated_fixture_names_the_rule_and_the_cell() {
        let site = SiteBuilder::new()
            .cell(c(0, 0, 0), &[DWELLING])
            .area(c(0, 0, 0), BUILDING_A)
            .build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[every_dwelling_has_a_door()]), &site),
            vec![Violation {
                rule_id: 12,
                subject: c(0, 0, 0),
                other: None,
                catchment: None
            }]
        );
    }

    #[test]
    fn requirement_boundary_zero_dwellings_is_vacuously_met() {
        let site = SiteBuilder::new().cell(c(0, 0, 0), &[DOOR]).build();
        assert_eq!(
            evaluate(RuleSet::for_test(&[every_dwelling_has_a_door()]), &site),
            vec![]
        );
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
        assert_eq!(evaluate(RuleSet::for_test(&[rule]), &site).len(), 1);
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
            evaluate(RuleSet::for_test(&[rule]), &site),
            vec![Violation {
                rule_id: 18,
                subject: c(0, 0, 0),
                other: None,
                catchment: None
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
            evaluate(RuleSet::for_test(&[rule]), &site),
            vec![Violation {
                rule_id: 19,
                subject: c(0, 0, 0),
                other: None,
                catchment: None
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
        let violations = evaluate(RuleSet::for_test(&[high_id, low_id]), &site);
        assert_eq!(
            violations,
            vec![
                Violation {
                    rule_id: 1,
                    subject: c(1, 0, 3),
                    other: None,
                    catchment: None
                },
                Violation {
                    rule_id: 1,
                    subject: c(5, 0, 3),
                    other: None,
                    catchment: None
                },
                Violation {
                    rule_id: 2,
                    subject: c(1, 0, 3),
                    other: None,
                    catchment: None
                },
                Violation {
                    rule_id: 2,
                    subject: c(5, 0, 3),
                    other: None,
                    catchment: None
                },
            ]
        );
    }
}
