//! Shared helpers for `server/sim/tests/*.rs` (story 2.9, Quentin's
//! direction: one shared selector, never a hand-kept list duplicated
//! across test files). `mod support` is compiled fresh into every
//! `tests/*.rs` binary that declares it, so an item unused by one of
//! them is dead code there -- `#[allow(dead_code)]` throughout.

use sim::generated::defs;
use sim::rules::{RuleDef, RuleKind, TagId};

/// The tag a rule kind's own `evaluate` iterates cells by -- `Adjacency`'s
/// `a`, `Requirement`'s `container`, and so on. Exhaustively matched (no
/// `_ =>` arm): a sixth kind is a compile error here too, same as
/// `evaluate`'s own match.
#[allow(dead_code)]
pub fn subject_tag(kind: &RuleKind) -> TagId {
    match *kind {
        RuleKind::Placement { subject, .. } => subject,
        RuleKind::Distribution { subject, .. } => subject,
        RuleKind::Coherence { subject, .. } => subject,
        RuleKind::Adjacency { a, .. } => a,
        RuleKind::Requirement { container, .. } => container,
    }
}

/// Whether `tag` is declared with a `role` table (story 2.9, AC1) --
/// `defs::TAGS` is the one place that answers this, never a hand-copied
/// list of role tag ids.
#[allow(dead_code)]
pub fn tag_has_role(tag: TagId) -> bool {
    defs::TAGS
        .iter()
        .find(|t| t.id == tag)
        .is_some_and(|t| t.role.is_some())
}

/// Every committed rule whose own subject tag has a role -- the taxonomy
/// grammar (AC2/AC3/AC4), selected structurally rather than by a hand-
/// kept key list, so a row added to any `defs/rules/*.toml` that
/// constrains a role tag is included automatically, and nothing can fall
/// silently out of step (Quentin's direction). A pre-existing
/// non-grammar row can still qualify if its own subject happens to be a
/// role tag (e.g. `walled_room_has_waste_bin`'s `container = "wall"`) --
/// that is not a bug in the selector, it is a real constraint over that
/// same vocabulary, and fixtures using this selector satisfy it like any
/// other.
#[allow(dead_code)]
pub fn grammar_rules() -> Vec<RuleDef> {
    defs::RULES
        .iter()
        .copied()
        .filter(|r| tag_has_role(subject_tag(&r.kind)))
        .collect()
}

#[allow(dead_code)]
pub fn tag_id(key: &str) -> TagId {
    defs::TAGS
        .iter()
        .find(|t| t.key == key)
        .unwrap_or_else(|| panic!("defs/tags/*.toml must still declare tag '{key}'"))
        .id
}

#[allow(dead_code)]
pub fn rule(key: &str) -> RuleDef {
    *defs::RULES
        .iter()
        .find(|r| r.key == key)
        .unwrap_or_else(|| panic!("defs/rules/*.toml must still declare rule '{key}'"))
}
