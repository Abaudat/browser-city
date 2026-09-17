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

/// Builds one small `defs/`-shaped tree from `rule_toml` (plus six
/// distinct tags, `a` through `f`, ids 1 through 6) and returns the
/// rendered Rust text -- the shared plumbing every kind-specific test
/// below uses.
fn emit_rust_for(rule_toml: &str) -> String {
    let files = vec![
        (
            PathBuf::from("defs/tags/city.toml"),
            "[[tag]]\nid = 1\nkey = \"a\"\n\
             [[tag]]\nid = 2\nkey = \"b\"\n\
             [[tag]]\nid = 3\nkey = \"c\"\n\
             [[tag]]\nid = 4\nkey = \"d\"\n\
             [[tag]]\nid = 5\nkey = \"e\"\n\
             [[tag]]\nid = 6\nkey = \"f\"\n"
                .to_string(),
        ),
        (PathBuf::from("defs/rules/city.toml"), rule_toml.to_string()),
    ];
    let raw = defs_build::parse::parse_all(&files).expect("this tree is valid by construction");
    let defs = defs_build::validate::validate(&raw, &BTreeMap::new(), &BTreeMap::new(), "")
        .expect("this tree is valid by construction");
    defs_build::emit::emit_rust(&defs, "test")
}

/// One exact-literal assertion per remaining kind (Quentin's direction,
/// PR #294 cycle 2), every numeric field given a distinct value (and
/// every tag field a distinct tag) so a field swap in `emit.rs`'s hand-
/// written `fmt_rule_kind_rust` can never render the same text: a
/// `Distribution` with `ratio`/`tolerance_percent`/`min_spacing`/
/// `max_distance` swapped, or an `Adjacency`/`Requirement` with its two
/// tag fields swapped, fails one of these.
#[test]
fn every_remaining_kind_renders_its_own_exact_rule_kind_literal() {
    let distribution = emit_rust_for(
        "[[distribution]]\nid = 1\nkey = \"d\"\nsubject = \"a\"\nper = \"b\"\nratio = 3\ntolerance_percent = 4\nmin_spacing = 5\nmax_distance = 6\n",
    );
    assert!(
        distribution.contains(
            "kind: crate::rules::RuleKind::Distribution { subject: 1, per: 2, ratio: 3, tolerance_percent: 4, min_spacing: 5, max_distance: 6 }"
        ),
        "distribution literal not found:\n{distribution}"
    );

    let coherence = emit_rust_for(
        "[[coherence]]\nid = 1\nkey = \"c\"\nsubject = \"a\"\nwithin = \"b\"\nmode = \"forbid\"\n",
    );
    assert!(
        coherence.contains(
            "kind: crate::rules::RuleKind::Coherence { subject: 1, within: 2, mode: crate::rules::CoherenceMode::Forbid }"
        ),
        "coherence literal not found:\n{coherence}"
    );

    let adjacency = emit_rust_for(
        "[[adjacency]]\nid = 1\nkey = \"adj\"\na = \"a\"\nb = \"b\"\nrelation = \"require\"\ndirection = \"north\"\n",
    );
    assert!(
        adjacency.contains(
            "kind: crate::rules::RuleKind::Adjacency { a: 1, relation: crate::rules::AdjacencyRelation::Require, alternatives: &[&[crate::rules::NeighbourTerm { direction: crate::rules::Direction::North, tag: 2, present: true }]] }"
        ),
        "adjacency literal not found:\n{adjacency}"
    );

    let requirement = emit_rust_for(
        "[[requirement]]\nid = 1\nkey = \"r\"\ncontainer = \"a\"\nrequires = \"b\"\nmin = 3\nmax = 4\n",
    );
    assert!(
        requirement.contains(
            "kind: crate::rules::RuleKind::Requirement { container: 1, requires: 2, min: 3, max: Some(4) }"
        ),
        "requirement literal not found:\n{requirement}"
    );
}
