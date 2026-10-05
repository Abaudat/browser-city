//! Story 3.7 (FR112, the scoping amendment): the catchment floor has one
//! source, the `[[distribution]]` row. The generator's per-catchment
//! allocation and `check_rules` both read it from there, so changing the
//! row's number moves both -- the only way to show two readers share one
//! number.

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, GenerationError, plan};
use sim::rules::{DistributionScope, RuleDef, RuleKind, RuleSet, RuleSite};

const SEED: u64 = 7;

/// The committed rows with every row named `key` given `ratio`.
fn rules_with_ratio(key: &str, new_ratio: u32) -> Vec<RuleDef> {
    RuleSet::committed()
        .iter()
        .map(|r| {
            let mut r = *r;
            if r.key == key
                && let RuleKind::Distribution { ratio, .. } = &mut r.kind
            {
                *ratio = new_ratio;
            }
            r
        })
        .collect()
}

fn committed_row(key: &str) -> sim::rules::DistributionRow {
    RuleSet::committed()
        .iter()
        .filter_map(|r| r.as_distribution())
        .find(|r| r.key == key)
        .unwrap_or_else(|| panic!("committed rules carry '{key}'"))
}

/// Subjects of `row` per catchment of its own extent.
fn placed_by_catchment(
    d: &sim::generation::District,
    content: &GenerationContent,
    row: &sim::rules::DistributionRow,
) -> std::collections::BTreeMap<(i32, i32), usize> {
    let DistributionScope::Catchment { extent_cells } = row.scope else {
        panic!("'{}' must be a catchment row", row.key)
    };
    let site = d.site(content);
    let mut by = std::collections::BTreeMap::new();
    for c in site.subjects_in_area(None, row.subject) {
        *by.entry(sim::rules::catchment_of(c.x, c.y, extent_cells))
            .or_insert(0usize) += 1;
    }
    by
}

#[test]
fn changing_a_scoped_rows_ratio_moves_the_generators_allocation_and_the_verdict_together() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let committed = GenerationContent::committed();
    let row = committed_row("cafe_present");
    assert!(matches!(row.scope, DistributionScope::Catchment { .. }));

    let before = plan(SEED, &cfg, &committed).unwrap();
    assert!(before.check_rules(&committed).is_ok());
    let cafes_before = placed_by_catchment(&before, &committed, &row);

    // Ten times the ratio: each catchment owes a tenth.
    let changed_rules = rules_with_ratio("cafe_present", row.ratio * 10);
    let changed = GenerationContent {
        rules: RuleSet::for_test(&changed_rules),
        building_types: committed.building_types,
    };
    let after = plan(SEED, &cfg, &changed).unwrap();

    // The generator's allocation moved with the row...
    let cafes_after = placed_by_catchment(&after, &changed, &row);
    let (total_before, total_after): (usize, usize) =
        (cafes_before.values().sum(), cafes_after.values().sum());
    assert!(
        total_after < total_before,
        "cafes {total_before} -> {total_after}: the allocation did not follow the row"
    );
    // ...the changed row is satisfied by what it produced...
    assert!(after.check_rules(&changed).is_ok());
    // ...and the committed row, reading the same number, now finds it short.
    match after.check_rules(&committed) {
        Err(GenerationError::RuleViolations { first, .. }) => {
            assert_eq!(committed.rules.key_of(first.rule_id), Some("cafe_present"));
            assert!(
                first.catchment.is_some(),
                "the violation names its catchment"
            );
        }
        other => panic!("expected the committed row to reject the thinned district: {other:?}"),
    }
}
