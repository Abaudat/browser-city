//! AC1's other half (Tim's direction, PR #294 cycle 1): the *committed*
//! `sim::generated::defs::RULES` table -- the actual artefact `tools/
//! defs-build` emitted from `defs/rules/*.toml` -- fires for real, not
//! only an in-memory translation of it. Looks the row up by key/id;
//! this file lives under `server/sim/tests/`, outside `check-rule-
//! engine-no-content-keys.sh`'s scope (`server/sim/src/rules/` only), so
//! naming `"lighting_ground_floor_only"`/`"lighting"` here is not the
//! hardcoded content-key branch that guard exists to catch -- this test
//! reads the manifest's own vocabulary, it does not special-case it.

use sim::generated::defs;
use sim::rules::testing::SiteBuilder;
use sim::rules::{Cell, evaluate};

#[test]
fn the_committed_ground_floor_only_placement_rule_fires_above_the_cap_and_stays_silent_at_it() {
    let rule = *defs::RULES
        .iter()
        .find(|r| r.key == "lighting_ground_floor_only")
        .expect("defs/rules/city.toml must still declare this row");
    let lighting = defs::TAGS
        .iter()
        .find(|t| t.key == "lighting")
        .expect("defs/tags/city.toml must still declare this tag")
        .id;

    let at_cap = SiteBuilder::new()
        .cell(Cell::new(0, 0, 0), &[lighting])
        .build();
    assert!(evaluate(&[rule], &at_cap).is_empty());

    let above_cap = SiteBuilder::new()
        .cell(Cell::new(0, 0, 1), &[lighting])
        .build();
    let violations = evaluate(&[rule], &above_cap);
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].rule_id, rule.id);
    assert_eq!(violations[0].subject, Cell::new(0, 0, 1));
}
