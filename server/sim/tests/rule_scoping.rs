//! Story 3.7 (FR111/FR112, the scoping amendment): a `Distribution` row
//! may declare `scope = catchment` and is then judged inside each
//! fixed-extent, world-absolute catchment, through the one evaluator.
//! These are rules-layer tests over hand-built sites: a `.grid` case
//! cannot span two 256-cell catchments, so the sites here use a small
//! extent via `RuleSet::for_test`. Unscoped rows evaluating exactly as
//! before is held by the existing `rule-examples/` corpus and every
//! golden staying byte-identical, not by anything here.

mod support;

use proptest::prelude::*;
use sim::rules::testing::{Site, SiteBuilder};
use sim::rules::{
    Cell, DistributionScope, Parameter, ParameterRead, RuleDef, RuleKind, RuleSet, RuleSite, TagId,
    Violation, catchment_of,
};
use sim::validation::{Check, Defect, Location};
use support::eval;

const SUBJECT: TagId = 1;
const PER: TagId = 2;
const EXTENT: i32 = 10;
const RULE_ID: u32 = 7;
const RULE_KEY: &str = "service_present";

fn row(scope: DistributionScope) -> RuleDef {
    RuleDef {
        id: RULE_ID,
        key: RULE_KEY,
        kind: RuleKind::Distribution {
            subject: SUBJECT,
            per: PER,
            // Ten `per` cells owe 2, tolerance 10% rounds up to 1: [1, 3]
            // inside a catchment, [3, 5] over two.
            ratio: 5,
            tolerance_percent: 10,
            min_spacing: 3,
            max_distance: 1000,
            scope,
            reads: None,
        },
    }
}

fn catchment_scope() -> DistributionScope {
    DistributionScope::Catchment {
        extent_cells: EXTENT,
    }
}

fn c(x: i32, y: i32) -> Cell {
    Cell::new(x, y, 0)
}

/// Ten dwellings along the bottom row of the catchment whose west edge
/// is `x0`, plus `subjects` services at the given `(x, y)` offsets.
fn catchment_cells(b: SiteBuilder, x0: i32, subjects: &[(i32, i32)]) -> SiteBuilder {
    let mut b = b;
    for dx in 0..EXTENT {
        b = b.cell(c(x0 + dx, 9), &[PER]);
    }
    for &(dx, dy) in subjects {
        b = b.cell(c(x0 + dx, dy), &[SUBJECT]);
    }
    b
}

/// Catchment (0,0) owes and has two services; catchment (1,0) has ten
/// dwellings and, depending on `east`, some services.
fn two_catchments(east: &[(i32, i32)]) -> Site {
    let b = catchment_cells(SiteBuilder::new(), 0, &[(1, 2), (5, 2), (8, 2)]);
    catchment_cells(b, 10, east).build()
}

/// (a) One catchment short of its floor while the site-wide ratio still
/// holds: the report carries both the rule and the catchment.
#[test]
fn a_catchment_short_of_its_floor_is_reported_by_rule_and_catchment() {
    let site = two_catchments(&[]);
    // Site-wide: 3 services over 20 dwellings, inside [3, 5].
    let unscoped = eval(&[row(DistributionScope::Site)], &site);
    assert!(
        unscoped.is_empty(),
        "the layout must satisfy the site-wide ratio: {unscoped:?}"
    );

    let violations = eval(&[row(catchment_scope())], &site);
    assert!(!violations.is_empty(), "the short catchment must be caught");
    for v in &violations {
        assert_eq!(v.rule_id, RULE_ID, "every violation names the rule");
        assert_eq!(
            v.catchment,
            Some((1, 0)),
            "every violation names the short catchment, never the full one"
        );
    }
    // The ratio verdict itself: anchored on a dwelling of the short
    // catchment (it has no service to anchor on).
    assert!(
        violations.contains(&Violation {
            rule_id: RULE_ID,
            subject: c(10, 9),
            other: None,
            catchment: Some((1, 0)),
        }),
        "the ratio violation is anchored in the short catchment: {violations:?}"
    );
}

/// (b) The same layout with every catchment at its floor passes.
#[test]
fn every_catchment_at_its_floor_passes() {
    let site = two_catchments(&[(2, 2), (6, 2)]);
    assert_eq!(eval(&[row(catchment_scope())], &site), vec![]);
}

/// (c) The same short layout, row unscoped, passes -- so the scope, and
/// nothing else, is what catches it. An unscoped row reports no
/// catchment on anything it does report.
#[test]
fn the_same_layout_unscoped_passes_and_unscoped_violations_carry_no_catchment() {
    let short = two_catchments(&[]);
    assert!(eval(&[row(DistributionScope::Site)], &short).is_empty());

    // An unscoped row that does fail (no service at all) names no catchment.
    let none = catchment_cells(SiteBuilder::new(), 0, &[]).build();
    let violations = eval(&[row(DistributionScope::Site)], &none);
    assert!(!violations.is_empty());
    assert!(violations.iter().all(|v| v.catchment.is_none()));
}

/// A catchment holding no service is judged by the ratio's lower bound
/// alone: a row that tolerates it (lower bound 0) is not also reported
/// for every dwelling being uncovered.
#[test]
fn a_tolerated_empty_catchment_is_not_also_reported_uncovered() {
    // Four dwellings under ratio 5: expected 0, lower 0.
    let mut b = catchment_cells(SiteBuilder::new(), 0, &[(1, 2), (5, 2), (8, 2)]);
    for dx in 0..4 {
        b = b.cell(c(10 + dx, 9), &[PER]);
    }
    assert_eq!(eval(&[row(catchment_scope())], &b.build()), vec![]);
}

/// Coverage from a neighbouring catchment does not count: a service
/// within `max_distance` of a dwelling still leaves that dwelling's own
/// catchment uncovered.
#[test]
fn coverage_is_judged_from_the_catchments_own_services_only() {
    // The east catchment's one service is a long way from its far
    // dwellings; the west catchment's services are not a substitute.
    let mut tight = row(catchment_scope());
    if let RuleKind::Distribution { max_distance, .. } = &mut tight.kind {
        *max_distance = 3;
    }
    let site = two_catchments(&[(5, 9)]);
    let uncovered: Vec<i32> = eval(&[tight], &site)
        .into_iter()
        .filter(|v| v.catchment == Some((1, 0)) && v.subject.y == 9)
        .map(|v| v.subject.x)
        .collect();
    assert_eq!(
        uncovered,
        vec![10, 11, 19],
        "east dwellings further than 3 from the east service are uncovered, whatever stands in the west"
    );
}

/// Two services closer than `min_spacing` across a catchment line are
/// still a violation, reported once, in the later catchment's verdict.
#[test]
fn spacing_across_a_catchment_line_is_a_violation_in_the_later_catchment() {
    let site = two_catchments(&[(0, 2), (6, 2)]);
    // (8,2) and (10,2) are two apart, under min_spacing 3.
    let violations = eval(&[row(catchment_scope())], &site);
    let spacing = Violation {
        rule_id: RULE_ID,
        subject: c(10, 2),
        other: None,
        catchment: Some((1, 0)),
    };
    assert!(violations.contains(&spacing), "{violations:?}");
    assert!(
        violations.iter().all(|v| v.catchment == Some((1, 0))),
        "the earlier catchment's verdict stands: {violations:?}"
    );
}

fn verdict_of(site: &Site, catchment: (i32, i32)) -> Vec<Violation> {
    eval(&[row(catchment_scope())], site)
        .into_iter()
        .filter(|v| v.catchment == Some(catchment))
        .collect()
}

fn cells_strategy(max: usize) -> impl Strategy<Value = Vec<(i32, i32)>> {
    proptest::collection::vec((0..EXTENT, 0..EXTENT), 0..max)
}

/// One catchment's content: its `(cx, cy)`, then `per` and subject offsets.
type CatchmentContent = ((i32, i32), Vec<(i32, i32)>, Vec<(i32, i32)>);

fn site_of(contents: &[CatchmentContent]) -> Site {
    let mut b = SiteBuilder::new();
    for ((cx, cy), per, subjects) in contents {
        for &(dx, dy) in per {
            b = b.cell(c(cx * EXTENT + dx, cy * EXTENT + dy), &[PER]);
        }
        for &(dx, dy) in subjects {
            b = b.cell(c(cx * EXTENT + dx, cy * EXTENT + dy), &[SUBJECT]);
        }
    }
    b.build()
}

proptest! {
    #![proptest_config(ProptestConfig { failure_persistence: None, ..ProptestConfig::default() })]

    /// The city grows by whole catchments: appending ground in later
    /// catchments, with arbitrary content, never moves catchment (0, 0)'s
    /// verdict -- its violation list included, element for element.
    #[test]
    fn appending_whole_catchments_never_changes_an_existing_catchments_verdict(
        base_per in cells_strategy(14),
        base_subjects in cells_strategy(6),
        added in proptest::collection::vec(
            ((0i32..4, 0i32..3), cells_strategy(14), cells_strategy(6)),
            0..6,
        ),
    ) {
        let base = vec![((0, 0), base_per, base_subjects)];
        let before = verdict_of(&site_of(&base), (0, 0));

        let mut grown = base.clone();
        for ((cx, cy), per, subjects) in added {
            // Strictly later than (0, 0) in catchment order.
            if (cx, cy) > (0, 0) {
                grown.push(((cx, cy), per, subjects));
            }
        }
        let after = verdict_of(&site_of(&grown), (0, 0));
        prop_assert_eq!(before, after);
    }

    /// `catchment_of` tiles by world-absolute division: shifting the
    /// origin of what is *evaluated* (a site whose cells start far from
    /// zero) never re-tiles a cell.
    #[test]
    fn catchment_of_is_world_absolute(x in -5000i32..5000, y in -5000i32..5000) {
        let (cx, cy) = catchment_of(x, y, EXTENT);
        prop_assert!(cx * EXTENT <= x && x < (cx + 1) * EXTENT);
        prop_assert!(cy * EXTENT <= y && y < (cy + 1) * EXTENT);
    }
}

/// A defect found in a catchment renders the rule key and the catchment.
#[test]
fn a_defect_in_a_catchment_renders_both_the_rule_key_and_the_catchment() {
    let defect = Defect {
        check: Check::Rule {
            id: RULE_ID,
            key: RULE_KEY,
        },
        location: Location::Cell {
            cell: c(10, 9),
            other: None,
            catchment: Some((1, 0)),
        },
    };
    assert_eq!(
        defect.to_string(),
        "service_present at (10, 9, 0) in catchment (1, 0)"
    );
}

// --- a catchment row may read one neighbourhood parameter ----------------

/// A [`Site`] that also answers one parameter per cell.
struct WithParameter {
    site: Site,
    affluence: std::collections::BTreeMap<Cell, i32>,
}

impl RuleSite for WithParameter {
    fn tags_at(&self, cell: Cell) -> &[TagId] {
        self.site.tags_at(cell)
    }
    fn areas_containing(&self, cell: Cell) -> &[sim::rules::AreaId] {
        self.site.areas_containing(cell)
    }
    fn subjects_in_area(&self, area: Option<sim::rules::AreaId>, tag: TagId) -> &[Cell] {
        self.site.subjects_in_area(area, tag)
    }
    fn parameter_at(&self, cell: Cell, parameter: Parameter) -> Option<i32> {
        match parameter {
            Parameter::Affluence => self.affluence.get(&cell).copied(),
            Parameter::BuildingAge => None,
        }
    }
}

fn reading_row() -> RuleDef {
    let mut r = row(catchment_scope());
    if let RuleKind::Distribution { ratio, reads, .. } = &mut r.kind {
        *ratio = 5;
        *reads = Some(ParameterRead {
            parameter: Parameter::Affluence,
            ratio_at_min: 5,
            ratio_at_max: 20,
            min: 0,
            max: 100,
        });
    }
    r
}

/// Ten dwellings and two services in each of two catchments; the west
/// catchment's dwellings sit at affluence `west`, the east's at `east`.
fn two_catchments_at(west: i32, east: i32) -> WithParameter {
    let site = catchment_cells(
        catchment_cells(SiteBuilder::new(), 0, &[(1, 2), (6, 2)]),
        10,
        &[(1, 2), (6, 2)],
    )
    .build();
    let mut affluence = std::collections::BTreeMap::new();
    for dx in 0..EXTENT {
        affluence.insert(c(dx, 9), west);
        affluence.insert(c(10 + dx, 9), east);
    }
    WithParameter { site, affluence }
}

#[test]
fn a_row_that_reads_a_parameter_owes_each_catchment_by_its_own_mean() {
    let rules = [reading_row()];
    let run = |site: &WithParameter| sim::rules::evaluate(RuleSet::for_test(&rules), site);
    // Poor west owes ratio 5 (ten dwellings -> 2); rich east owes ratio 20
    // (ten dwellings -> 0), so its two services are over the upper bound.
    let violations = run(&two_catchments_at(0, 100));
    assert!(!violations.is_empty());
    assert!(
        violations.iter().all(|v| v.catchment == Some((1, 0))),
        "{violations:?}"
    );
    // Swap the dwellings' affluence and the verdict moves with it.
    let swapped = run(&two_catchments_at(100, 0));
    assert!(
        swapped.iter().all(|v| v.catchment == Some((0, 0))),
        "{swapped:?}"
    );
    assert!(!swapped.is_empty());
    // Equal means owe equally: both pass.
    assert_eq!(run(&two_catchments_at(0, 0)), vec![]);
}

#[test]
fn ratio_at_interpolates_between_the_two_ends_and_clamps() {
    let read = ParameterRead {
        parameter: Parameter::Affluence,
        ratio_at_min: 20,
        ratio_at_max: 60,
        min: 0,
        max: 100,
    };
    assert_eq!(read.ratio_at(0), 20);
    assert_eq!(read.ratio_at(50), 40);
    assert_eq!(read.ratio_at(100), 60);
    assert_eq!(read.ratio_at(-30), 20);
    assert_eq!(read.ratio_at(500), 60);
    // A thinning-to-thickening row runs the other way.
    let down = ParameterRead {
        ratio_at_min: 60,
        ratio_at_max: 20,
        ..read
    };
    assert_eq!(down.ratio_at(50), 40);
    assert!(down.ratio_at(100) < down.ratio_at(0));
}

/// The committed rows read affluence the way the design states: welfare
/// offices and shelters thin as it rises.
#[test]
fn welfare_offices_and_shelters_thin_as_affluence_rises() {
    let committed: Vec<_> = RuleSet::committed()
        .iter()
        .filter_map(|r| r.as_distribution())
        .collect();
    let by_key = |key: &str| {
        *committed
            .iter()
            .find(|r| r.key == key)
            .unwrap_or_else(|| panic!("committed rows carry '{key}'"))
    };
    let (poor, rich) = (0, 100);
    for key in ["welfare_office_present", "shelter_present"] {
        let r = by_key(key);
        assert!(
            r.ratio_for(Some(rich)) > r.ratio_for(Some(poor)),
            "{key} thins as affluence rises"
        );
        assert_eq!(
            r.reads.map(|read| read.parameter),
            Some(Parameter::Affluence)
        );
    }
    // Rows that read nothing keep their one number.
    for key in [
        "depot_present",
        "council_present",
        "hospital_present",
        "cafe_present",
    ] {
        let r = by_key(key);
        assert_eq!(r.reads, None);
        assert_eq!(r.ratio_for(Some(rich)), r.ratio_for(None));
    }
}
