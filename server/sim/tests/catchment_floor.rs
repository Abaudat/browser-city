//! Story 3.7 (FR112, the scoping amendment): the catchment floor has one
//! source, the `[[distribution]]` row. The generator's per-catchment
//! allocation and `check_rules` both read it from there, so changing the
//! row's number moves both -- the only way to show two readers share one
//! number.

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, GenerationError, plan};
use sim::rules::{DistributionScope, RowRatio, RuleDef, RuleKind, RuleSet, RuleSite};

const SEED: u64 = 7;

/// The committed rows with every ratio of the row named `key` scaled by
/// `num / den` (a row that reads a parameter owes by its two ends; moving
/// the number moves both).
fn rules_scaled(key: &str, num: u32, den: u32) -> Vec<RuleDef> {
    RuleSet::committed()
        .iter()
        .map(|r| {
            let mut r = *r;
            if r.key == key
                && let RuleKind::Distribution { ratio, .. } = &mut r.kind
            {
                let scale = |n: u32| (n * num / den).max(1);
                *ratio = match *ratio {
                    RowRatio::Fixed(n) => RowRatio::Fixed(scale(n)),
                    RowRatio::Read(mut read) => {
                        read.ratio_at_min = scale(read.ratio_at_min);
                        read.ratio_at_max = scale(read.ratio_at_max);
                        RowRatio::Read(read)
                    }
                };
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

/// Changing a row's number moves the generator's allocation and the verdict
/// together. A thicker ratio (`row.ratio / divisor`) makes the generator
/// place more subjects, the thicker row is satisfied by what it produced,
/// and the committed row -- reading its own, unchanged number -- finds the
/// same district over its upper bound.
fn assert_one_source(key: &str, divisor: u32, seed: u64) {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let committed = GenerationContent::committed();
    let row = committed_row(key);

    let before = plan(seed, &cfg, &committed).unwrap();
    assert!(before.check_rules(&committed).is_ok());
    let total_before = subjects_of(&before, &committed, &row);

    let changed_rules = rules_scaled(key, 1, divisor);
    let changed = GenerationContent {
        rules: RuleSet::for_test(&changed_rules),
        building_types: committed.building_types,
    };
    let after = plan(seed, &cfg, &changed).unwrap();

    // The generator's allocation moved with the row...
    let total_after = subjects_of(&after, &changed, &row);
    assert!(
        total_after > total_before,
        "{key}: {total_before} -> {total_after} subjects: the allocation did not follow the row"
    );
    // ...the changed row is satisfied by what it produced...
    assert!(
        after.check_rules(&changed).is_ok(),
        "{key}: {:?}",
        after.check_rules(&changed).err()
    );
    // ...and the committed row, reading its own number, now finds it over.
    match after.check_rules(&committed) {
        Err(e @ GenerationError::RuleViolations { .. }) => {
            let GenerationError::RuleViolations {
                rule_key, first, ..
            } = &e
            else {
                unreachable!()
            };
            assert_eq!(rule_key, key);
            assert_eq!(
                first.catchment.is_some(),
                matches!(row.scope, DistributionScope::Catchment { .. })
            );
            assert!(
                e.to_string().contains(key),
                "the rendering names the rule key: {e}"
            );
        }
        other => {
            panic!("{key}: expected the committed row to reject the thicker district: {other:?}")
        }
    }
}

fn subjects_of(
    d: &sim::generation::District,
    content: &GenerationContent,
    row: &sim::rules::DistributionRow,
) -> usize {
    d.site(content).subjects_in_area(None, row.subject).len()
}

/// A site row and a catchment row both read one number from the row.
#[test]
fn changing_a_site_rows_ratio_moves_the_generators_allocation_and_the_verdict_together() {
    assert_one_source("depot_present", 2, SEED);
}

#[test]
fn changing_a_scoped_rows_ratio_moves_the_generators_allocation_and_the_verdict_together() {
    let row = committed_row("welfare_office_present");
    assert!(matches!(row.scope, DistributionScope::Catchment { .. }));
    assert_one_source("welfare_office_present", 4, SEED);
}
