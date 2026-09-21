//! FR112's "one source" seam (story 2.11, Tim's direction): [`RuleSet`]'s
//! own field is private *to this module*, so nothing outside it -- not
//! even the rest of `sim::rules` -- can build one from an arbitrary
//! slice. Only two constructors exist: [`RuleSet::committed`] (wraps the
//! real, generated table) and, gated so it never reaches the published
//! module, [`RuleSet::for_test`]. [`super::evaluate`] accepts only a
//! `RuleSet`, never a bare slice, so "the generator and the harness read
//! one rule source" becomes a property the type system holds, not a
//! convention a reviewer has to keep re-checking.
//!
//! `scripts/ci/check-rule-source.sh` covers the one hole the type system
//! itself cannot see: a manifest enabling `test-fixtures` outside this
//! crate's own self-dependency, or `for_test`/`RuleKind::` reappearing in
//! a `src/` tree outside this module -- the shape a second, independently
//! authored interpreter would have to take.

use super::RuleDef;

/// The only carrier [`super::evaluate`] accepts. Its field is private to
/// this module: a `RuleSet { rules }` struct literal, or a tuple-struct
/// `RuleSet(rules)`, is unreachable from anywhere else, including the
/// rest of `sim::rules`.
///
/// AC4 (FR112): there is no public or crate-visible way to build one from
/// a slice outside [`RuleSet::committed`]/[`RuleSet::for_test`] -- pinned
/// by a `compile_fail` doctest, since a unit test can only prove a
/// *positive* ("this compiles"), never that an alternative path is
/// closed.
///
/// ```compile_fail,E0451
/// let rules: &[sim::rules::RuleDef] = &[];
/// let _ = sim::rules::RuleSet { rules };
/// ```
#[derive(Debug, Clone, Copy)]
pub struct RuleSet<'a> {
    rules: &'a [RuleDef],
}

impl RuleSet<'static> {
    /// The one non-test constructor: wraps the committed, generated rule
    /// table (`sim::generated::defs::RULES`). Epic 3's generator and
    /// story 2.11's harness both reach the same rule set only ever
    /// through this call -- never a parameter, never a second table.
    pub fn committed() -> Self {
        RuleSet {
            rules: crate::generated::defs::RULES,
        }
    }
}

impl<'a> RuleSet<'a> {
    /// A test-only escape hatch: builds a `RuleSet` from an arbitrary
    /// slice, so a unit test can pin one rule's behaviour without the
    /// whole committed table. Gated so it never reaches the published
    /// wasm module -- `check-rule-source.sh` also fails the build if this
    /// name ever appears in a `src/` tree outside this module.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn for_test(rules: &'a [RuleDef]) -> Self {
        RuleSet { rules }
    }

    pub(crate) fn rules(&self) -> &'a [RuleDef] {
        self.rules
    }

    /// A public, read-only view over every row this set carries (story
    /// 3.4, Tim's direction: "reading a row is not judging one") --
    /// [`super::evaluate`] stays the one place that decides whether a row
    /// holds; this is what a constructive placer (Epic 3's generator)
    /// reads a row's own numbers through, via [`RuleDef::as_distribution`]
    /// -- never `RULES` itself, which stays unreachable outside this
    /// module (`check-rule-source.sh`).
    pub fn iter(&self) -> std::slice::Iter<'a, RuleDef> {
        self.rules.iter()
    }

    /// The rule's own `key`, resolved through this `RuleSet` rather than
    /// a caller reading `defs::RULES` directly -- `check-rule-source.sh`
    /// fails the build if any non-generated `src/` file outside this
    /// module reads `RULES` at all, so a rule's key is only ever reached
    /// this way. `None` for an id this `RuleSet` does not carry.
    pub fn key_of(&self, id: u32) -> Option<&'a str> {
        self.rules.iter().find(|r| r.id == id).map(|r| r.key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_wraps_the_real_generated_table() {
        let set = RuleSet::committed();
        assert_eq!(set.rules().len(), crate::generated::defs::RULES.len());
    }

    #[test]
    fn for_test_wraps_exactly_the_given_slice() {
        let rules: &[RuleDef] = &[];
        let set = RuleSet::for_test(rules);
        assert_eq!(set.rules().len(), 0);
    }

    #[test]
    fn key_of_resolves_a_committed_id_and_is_none_for_an_unknown_one() {
        let committed = RuleSet::committed();
        let real_id = crate::generated::defs::RULES[0].id;
        let real_key = crate::generated::defs::RULES[0].key;
        assert_eq!(committed.key_of(real_id), Some(real_key));
        assert_eq!(committed.key_of(u32::MAX), None);
    }
}
