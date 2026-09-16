//! AC1 ("a row, not code") proven within this crate alone (Tim's
//! direction, PR #294 cycle 1): the ticket's own example, "no cafe above
//! floor 2", authored as a real TOML row and run through the real
//! `parse`/`validate` pipeline, renders the exact `crate::rules::
//! RuleKind::Placement` literal `server/sim/src/generated/defs.rs` would
//! embed. `sim` never depends on this crate (or vice versa): the other
//! half of AC1 -- that the *committed* artefact actually fires -- is
//! proven independently in `server/sim/tests/rule_defs_current.rs`,
//! against `sim::generated::defs::RULES` itself, never a hand
//! translation of this crate's own validated tree.

use std::collections::BTreeMap;
use std::path::PathBuf;

#[test]
fn ac1_no_cafe_above_floor_2_renders_the_exact_rule_kind_literal() {
    let files = vec![
        (
            PathBuf::from("defs/tags/city.toml"),
            "[[tag]]\nid = 1\nkey = \"cafe\"\n".to_string(),
        ),
        (
            PathBuf::from("defs/rules/cafes.toml"),
            "[[placement]]\nid = 1\nkey = \"no_cafe_above_floor_2\"\nsubject = \"cafe\"\nfloor_max = 2\n"
                .to_string(),
        ),
    ];
    let raw = defs_build::parse::parse_all(&files).expect("this tree is valid by construction");
    let defs = defs_build::validate::validate(&raw, &BTreeMap::new(), &BTreeMap::new(), "")
        .expect("this tree is valid by construction");
    let rust = defs_build::emit::emit_rust(&defs, "test");

    assert!(
        rust.contains(
            "crate::rules::RuleDef { id: 1, key: \"no_cafe_above_floor_2\", kind: crate::rules::RuleKind::Placement { subject: 1, container: None, floor_min: None, floor_max: Some(2) } }"
        ),
        "emit_rust did not render the expected rule literal:\n{rust}"
    );
}
