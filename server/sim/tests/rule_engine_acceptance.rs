//! AC1 ("a row, not code") proven end to end (Quentin's direction): the
//! ticket's own example, "no cafe above floor 2", authored as a real
//! `defs/rules/*.toml` row, parsed and validated by the real
//! `tools/defs-build` pipeline -- never a hand-built `RuleDef` -- then
//! run through the real `sim::rules::evaluate`.
//!
//! `sim` stays pure (NFR28, zero normal/build dependencies -- `check-sim-
//! purity.sh` only inspects those, never `[dev-dependencies]`); `sim` and
//! `defs-build` never depend on each other in the other direction. The
//! translation below from `defs_build::model::RuleDef`/`TagDef` (owned
//! `String` keys, this crate's own validated shape) to
//! `sim::rules::RuleDef` (`&'static str` keys, the shape a real generated
//! `defs.rs` embeds) is a plain structural mapping, field for field --
//! never a second implementation of what a rule *means*. That meaning
//! lives only in `sim::rules::evaluate`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use defs_build::model::{RawAdjacencyRelation, RawCoherenceMode, RawDirection, RuleKindDef};
use sim::rules::testing::SiteBuilder;
use sim::rules::{
    AdjacencyRelation, Cell, CoherenceMode, Direction, RuleDef, RuleKind, TagId, evaluate,
};

fn to_rule_kind(kind: RuleKindDef) -> RuleKind {
    match kind {
        RuleKindDef::Placement {
            subject,
            container,
            floor_min,
            floor_max,
        } => RuleKind::Placement {
            subject,
            container,
            floor_min,
            floor_max,
        },
        RuleKindDef::Distribution {
            subject,
            per,
            ratio,
            tolerance_percent,
            min_spacing,
        } => RuleKind::Distribution {
            subject,
            per,
            ratio,
            tolerance_percent,
            min_spacing,
        },
        RuleKindDef::Coherence {
            subject,
            within,
            mode,
        } => RuleKind::Coherence {
            subject,
            within,
            mode: match mode {
                RawCoherenceMode::Allow => CoherenceMode::Allow,
                RawCoherenceMode::Forbid => CoherenceMode::Forbid,
            },
        },
        RuleKindDef::Adjacency {
            a,
            b,
            relation,
            direction,
        } => RuleKind::Adjacency {
            a,
            b,
            relation: match relation {
                RawAdjacencyRelation::Forbid => AdjacencyRelation::Forbid,
                RawAdjacencyRelation::Require => AdjacencyRelation::Require,
            },
            direction: direction.map(|d| match d {
                RawDirection::North => Direction::North,
                RawDirection::East => Direction::East,
                RawDirection::South => Direction::South,
                RawDirection::West => Direction::West,
            }),
        },
        RuleKindDef::Requirement {
            container,
            requires,
            min,
            max,
        } => RuleKind::Requirement {
            container,
            requires,
            min,
            max,
        },
    }
}

/// Builds a tiny `defs/`-shaped tree in memory (no fixture files on disk
/// -- `defs_build::build` is pure over `(path, text)` pairs) and runs it
/// through the real `parse`/`validate` pipeline, returning every rule
/// row translated into `sim::rules::RuleDef` -- the exact list
/// `sim::generated::defs::RULES` would carry had this row been committed
/// under `defs/rules/`.
fn build_rules(files: &[(&str, &str)]) -> Vec<RuleDef> {
    let files: Vec<(PathBuf, String)> = files
        .iter()
        .map(|(p, t)| (PathBuf::from(*p), t.to_string()))
        .collect();
    let output = defs_build::build(&files, &BTreeMap::new(), &BTreeMap::new(), "", "test").expect(
        "the tree authored in this test is expected to be a valid defs/ tree, by construction",
    );
    // `build` renders text, not `Defs` -- reach the validated tree by
    // calling `parse`/`validate` directly, the same two stages `build`
    // itself calls internally.
    let _ = output; // proves the whole pipeline (including emit) does not error
    let raw = defs_build::parse::parse_all(&files).unwrap();
    let defs =
        defs_build::validate::validate(&raw, &BTreeMap::new(), &BTreeMap::new(), "").unwrap();
    defs.rules
        .into_iter()
        .map(|r| RuleDef {
            id: r.id,
            key: Box::leak(r.key.into_boxed_str()),
            kind: to_rule_kind(r.kind),
        })
        .collect()
}

fn cell(x: i32, y: i32, floor: i8) -> Cell {
    Cell::new(x, y, floor)
}

#[test]
fn ac1_a_placement_row_authored_in_toml_rejects_a_cafe_above_floor_2() {
    let rules = build_rules(&[
        ("defs/tags/city.toml", "[[tag]]\nid = 1\nkey = \"cafe\"\n"),
        (
            "defs/rules/cafes.toml",
            "[[placement]]\nid = 1\nkey = \"no_cafe_above_floor_2\"\nsubject = \"cafe\"\nfloor_max = 2\n",
        ),
    ]);
    assert_eq!(rules.len(), 1);
    let cafe: TagId = match rules[0].kind {
        RuleKind::Placement { subject, .. } => subject,
        _ => panic!("expected a placement rule"),
    };

    let legal = SiteBuilder::new().cell(cell(0, 0, 2), &[cafe]).build();
    assert!(
        evaluate(&rules, &legal).is_empty(),
        "a cafe on floor 2 must not violate 'no cafe above floor 2'"
    );

    let illegal = SiteBuilder::new().cell(cell(0, 0, 3), &[cafe]).build();
    let violations = evaluate(&rules, &illegal);
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].rule_id, 1);
    assert_eq!(violations[0].subject, cell(0, 0, 3));
}
