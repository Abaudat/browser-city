//! Shared helpers for `server/sim/tests/*.rs` (story 2.9, Quentin's
//! direction: one shared selector, never a hand-kept list duplicated
//! across test files). `mod support` is compiled fresh into every
//! `tests/*.rs` binary that declares it, so an item unused by one of
//! them is dead code there -- `#[allow(dead_code)]` throughout.

use sim::generated::defs;
use sim::rules::{RuleDef, RuleKind, RuleSet, RuleSite, TagId, Violation};

// Story 2.12: the rule-examples corpus's own `.grid` reader -- used only
// by `rule_examples.rs`, `#[allow(dead_code)]` throughout like every
// other item here for the test binaries that do not use it.
#[allow(dead_code)]
pub mod grid;

// Story 3.1: `docs/generation.md`'s own five-kind-section table reader --
// used only by `rule_examples.rs`, `#[allow(dead_code)]` throughout like
// every other item here for the test binaries that do not use it.
#[allow(dead_code)]
pub mod generation_doc;

// Story 6.3: the one stock ledger driver, applying a `Write` only.
#[allow(dead_code)]
pub mod stock_ledger;

/// Story 2.11: every `tests/*.rs` call site moved from `evaluate(&rules,
/// ..)` to this one helper (Tim's direction -- "mechanical, no assertion
/// changes") once [`sim::rules::evaluate`] started taking a [`RuleSet`]
/// rather than a bare slice. Wraps `rules` with [`RuleSet::for_test`],
/// which only a `tests/`/`#[cfg(test)]` build can call at all.
#[allow(dead_code)]
pub fn eval(rules: &[RuleDef], site: &impl RuleSite) -> Vec<Violation> {
    sim::rules::evaluate(RuleSet::for_test(rules), site)
}

/// The real committed object's own def id, resolved by key -- object
/// keys are resolved through this module in `tests/validation.rs`
/// exactly like `tag_id`/`rule` resolve a tag or rule key (Tim's
/// direction), never a literal numeric id.
#[allow(dead_code)]
pub fn object_id(key: &str) -> u32 {
    defs::OBJECTS
        .iter()
        .find(|o| o.key == key)
        .unwrap_or_else(|| panic!("defs/objects/*.toml must still declare object '{key}'"))
        .id
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

/// Every tag id a rule kind mentions anywhere -- `Adjacency`'s own
/// alternatives can, and `entrance_opens_onto_pavement` does, name a
/// role tag (`pavement`) without the rule's own subject (`entrance`, a
/// plain qualifier tag, never a role) being one itself. Exhaustively
/// matched (no `_ =>` arm): a sixth kind is a compile error here too,
/// same as `evaluate`'s own match.
#[allow(dead_code)]
fn referenced_tags(kind: &RuleKind) -> Vec<TagId> {
    match *kind {
        RuleKind::Placement { subject, .. } => vec![subject],
        RuleKind::Distribution { subject, per, .. } => vec![subject, per],
        RuleKind::Coherence {
            subject, within, ..
        } => vec![subject, within],
        RuleKind::Adjacency {
            a, alternatives, ..
        } => {
            let mut tags = vec![a];
            for alternative in alternatives {
                tags.extend(alternative.iter().map(|term| term.tag));
            }
            tags
        }
        RuleKind::Requirement {
            container,
            requires,
            ..
        } => vec![container, requires],
    }
}

/// Every committed rule that mentions a role tag anywhere in its own
/// kind -- the taxonomy grammar (AC2/AC3/AC4), selected structurally
/// rather than by a hand-kept key list, so a row added to any
/// `defs/rules/*.toml` that constrains a role tag is included
/// automatically, and nothing can fall silently out of step (Quentin's
/// direction). Broader than "subject tag has a role" alone: a plain
/// qualifier tag can be a rule's own subject while a role tag still
/// appears in its alternatives (`entrance_opens_onto_pavement`'s
/// subject is `entrance`, which carries no role -- `pavement`, named in
/// its one alternative, does). A pre-existing non-grammar row can still
/// qualify if it happens to mention a role tag anywhere (e.g.
/// `building_has_an_entrance`'s `container = "wall"`) -- that is not a
/// bug in the selector, it is a real constraint over that same
/// vocabulary, and fixtures using this selector satisfy it like any
/// other.
#[allow(dead_code)]
pub fn grammar_rules() -> Vec<RuleDef> {
    defs::RULES
        .iter()
        .copied()
        .filter(|r| referenced_tags(&r.kind).iter().any(|&t| tag_has_role(t)))
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

// Story 4.5: the identity tables' model, used by `invariants.rs`.
#[allow(dead_code)]
pub mod identity_model;

/// The proptest config every property file shares: the default (so
/// `PROPTEST_CASES` and `PROPTEST_RNG_SEED` drive the count and the draws)
/// with failures persisted to `path` -- relative to the package root
/// `cargo test` runs integration tests from, the file committed next to the
/// test. Never an explicit `cases`: that would override the env var CI sets.
#[allow(dead_code)]
pub fn persisted(path: &'static str) -> proptest::test_runner::Config {
    proptest::test_runner::Config {
        failure_persistence: Some(Box::new(
            proptest::test_runner::FileFailurePersistence::Direct(path),
        )),
        ..proptest::test_runner::Config::default()
    }
}

/// Asserts the persistence [`persisted`] configures for `path` reads exactly
/// the `cc` cases committed in that file, so it cannot silently regress to
/// a path nothing replays from.
#[allow(dead_code)]
pub fn assert_persistence_reads_committed_file(path: &'static str, source: &'static str) {
    let committed = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
    let text = std::fs::read_to_string(&committed)
        .unwrap_or_else(|e| panic!("{} must exist: {e}", committed.display()));
    let cases = text.lines().filter(|l| l.starts_with("cc ")).count();
    let config = persisted(path);
    let persistence = config
        .failure_persistence
        .expect("every property persists its failures");
    assert_eq!(
        persistence.load_persisted_failures2(Some(source)).len(),
        cases,
        "the configured persistence must read the committed {path}"
    );
}
