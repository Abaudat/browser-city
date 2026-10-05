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
use sim::rules::{Cell, DistributionScope, RuleDef, RuleKind, TagId, Violation, catchment_of};
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

/// Coverage from a neighbouring catchment does not count: a service
/// within `max_distance` of a dwelling still leaves that dwelling's own
/// catchment uncovered.
#[test]
fn coverage_is_judged_from_the_catchments_own_services_only() {
    let site = two_catchments(&[]);
    let violations = eval(&[row(catchment_scope())], &site);
    let uncovered: Vec<Cell> = violations
        .iter()
        .filter(|v| v.subject.y == 9)
        .map(|v| v.subject)
        .collect();
    assert_eq!(
        uncovered.len(),
        EXTENT as usize,
        "all ten east dwellings are uncovered though a west service is within 1000 cells"
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

fn site_of(contents: &[((i32, i32), Vec<(i32, i32)>, Vec<(i32, i32)>)]) -> Site {
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
